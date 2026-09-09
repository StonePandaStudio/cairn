# @stonepandastudio/cairn

Shared AI workflow scaffolding, kept in sync across several repos.

Each repo carries an `ai/` folder and a `.claude/commands/` folder holding the same
workflow — brief → description → plan → execute → review → QA, with the steps
mirrored into an issue tracker. Copied between repos by hand, they drift.

A cairn is a stack of stones left to mark a trail. That is what this does: it leaves
markers — a manifest of what it generated, and a report of where the copies stopped
agreeing.

```bash
npm i -D @stonepandastudio/cairn
npx cairn init --stack nestjs,typeorm --tracker jira-server --project-key MYPROJ --story-type Task
```

## What v1 does

| Command | |
|---|---|
| `cairn tracker <cmd>` | Issue tracker client (`jira-server` / `youtrack` / `none`). Replaces the copied `ai/scripts/*.js` clients |
| `cairn doctor` | Cross-repo drift report, plus per-repo generated-file state |
| `cairn init` | Makes a repo cairn-managed: writes `cairn.config.json`, `_cairn/`, and the shim |
| `cairn render` | Scaffolds `ai/` + `.claude/commands/` from the bundled presets, from the repo's stack + workflow |

`cairn render` is **greenfield only**: it writes files that do not exist, records them
in the manifest, and leaves anything already on disk alone (reporting it). The
three-way merge that would re-render over local edits — `cairn sync` — is not built
yet; for a fresh repo there is nothing to merge.

## The two folders

```
repo/
  cairn.config.json      you edit this. cairn only ever reads it.
  _cairn/                cairn writes this. nobody hand-edits it.
    manifest.json        what was generated, from which template, at which hash
    scripts/jira.js      vendored shim
  ai/                    cairn render seeds agents/ + WORKFLOW.md + the command
    agents/  WORKFLOW.md  stubs once; contexts/ tasks/ and your edits are yours,
    contexts/  tasks/     never re-written without `cairn sync`
```

The boundary is the whole design. Hand-edited config living inside a generated
directory is how generated directories acquire state nobody dares regenerate.

Generated files are **committed**, not gitignored. Claude Code discovers
`.claude/commands/` and agent docs from disk, and a prompt change should show up in
`git diff` like any other change.

## Tracker

```bash
cairn tracker list-statuses MYPROJ
cairn tracker create-task "Some task title"
cairn tracker create-subtask MYPROJ-101 "Step 1: first slice"
cairn tracker set-status MYPROJ-102 "In Progress"
cairn tracker append-description MYPROJ-101 ./ai/tasks/MYPROJ-101/brief-step-1.md --markup
cairn tracker close-story MYPROJ-42          # cascades through subtasks first
```

Providers are `jira-server`, `youtrack` and `none`, chosen per repo via
`tracker.provider`. `none` is a real provider, not an error case: a repo with no
tracker makes the workflow steps no-ops rather than every command stub needing an
"if this repo has a tracker" branch written in prose. YouTrack has no Task/Sub-task
type split (a `Subtask` link instead), a `Stage` state field rather than a
transition graph, and markdown-native descriptions.

Three things the copied scripts did that this does not:

- **`process.exit` from library code.** Failures throw `TrackerError`; the CLI layer
  chooses the exit code. That is what makes the client callable from a workflow runner.
- **Fail on a re-run.** Transitioning to a status the issue already holds is a
  successful no-op. `NoTransitionError` exits 0 — re-running a step must be safe.
- **Ask an agent to convert markup by hand.** `ai/JIRA_MARKUP.md` was a prose document
  explaining markdown → Jira wiki conversion. It is `toMarkup()` now, under test,
  reachable via `--markup`.

Credentials come from the repo's `.env` — `JIRA_BASE_URL` / `JIRA_USER` /
`JIRA_PASSWORD` for `jira-server` (Basic auth: Jira Server 8.5.1 predates PATs), or
`YOUTRACK_URL` / `YOUTRACK_TOKEN` / `YOUTRACK_PROJECT` for `youtrack` (Bearer token,
admin-read scope for the project and stage-bundle lookups). Anything already in the
environment wins over the file. If the repo's own app reads those same names, set
`tracker.envPrefix` (`cairn init --env-prefix CAIRN_`) so cairn reads
`CAIRN_YOUTRACK_TOKEN` instead — or point `tracker.env` at a separate file.

### Legacy command names

`create-task`, `create-story`, `close-story` and friends are all still accepted, and
output formats are byte-for-byte what the old scripts printed. Existing prose
references name these strings and the agents parse the output, so they are kept
until the v2 pass regenerates those documents.

## Doctor

```bash
cairn doctor                                     # full table
cairn doctor --diff ai/WORKFLOW.md               # hunks for one file across repos
cairn doctor --json
cairn doctor --strict                            # exit 1 on drift or a hand-edited generated file
```

Run it from the directory holding `repos.json`, or pass `--config <file>`.

It reports two independent axes, and keeping them apart is the point:

**Drift** — cross-repo. Do the copies still agree? Raw comparison is noise, so each
file is normalized first: BOM and CRLF stripped, repo paths and names folded, issue
keys folded to `{{ISSUE}}`, and declared vars folded to `{{placeholder}}`. What
survives is drift no template variable explains. Files are then clustered by
normalized content; the largest cluster becomes the reference.

| Status | Meaning |
|---|---|
| `IDENTICAL` | byte-identical everywhere |
| `COSMETIC` | differs only in declared vars — extract as a template, zero merge cost |
| `DRIFT` | two or more genuinely different variants, with a similarity score |
| `MISSING` | some repos in the cohort lack it |
| `STRANDED` | exactly one repo has it — promotion candidate |

**Managed** — per-repo, read from `_cairn/manifest.json`. Does what cairn wrote still
match what is on disk?

| State | Meaning |
|---|---|
| `MANAGED` | on-disk hash matches what cairn wrote |
| `MODIFIED` | someone hand-edited a generated file |
| `OUTDATED` | cairn has newer content for it — needs template hashes, wired in v2 |
| `DELETED` | it is gone; a future `cairn sync` will restore it |

v1 reports `MANAGED`, `MODIFIED` and `DELETED`. `OUTDATED` and the `sync` that acts
on these states arrive with the v2 renderer.

A file can be perfectly in sync across repos while being hand-edited away from its
template, and vice versa. `MODIFIED` outranks `OUTDATED` in the report because
overwriting a hand edit is the destructive outcome.

### Workspace config (`repos.json`)

- `repos[]` — name, path, stack (`"angular"` or a list `["nestjs", "typeorm"]` —
  framework first). Per-repo settings live in each repo's own `cairn.config.json`;
  the inline `vars` blocks are a fallback used only until a repo has been through
  `cairn init`, so migration can happen one repo at a time.
- `pathAliases` — local → canonical. When one repo names a stub `execute-tests.md`
  where the others use `execute-test-plan.md`, aliasing folds them onto the cohort's
  names instead of reporting one `MISSING` and one `STRANDED` for the same file.
- `shared[]` — glob rules. `cohort: "all"` compares every repo; `cohort: "stack"`
  groups by the first stack entry (all `nestjs` repos together, whatever the ORM).
  `requires: { tracker: true }` skips repos with no tracker. A repo with no config
  has an *unknown* tracker, not an absent one, and is never skipped on that basis.
- Anything not matched by a rule — `ai/contexts/`, `ai/progress/`, `ai/tasks/`,
  `DATABASE_SCHEMA.md` — is per-project by design and never inspected.
  `ai/INITIAL_PROMPT.md` is explicitly excluded: variants at ~0% shared content make
  it a per-project document, not a drifted template.

v2 splits this flat file into a per-project `workspace.json` plus an opt-in hub that
references the projects for cross-project comparison. See `DESIGN.md`.

## Layout

```
bin/cairn.js           subcommand router
lib/config.js          cairn.config.json + .env loading
lib/manifest.js        generated-file hashing and state
lib/paint.js           ANSI + table rendering
lib/tracker/           index (registry), cli, jira-server, youtrack, none
lib/doctor/            index (analysis + report), scan, normalize, diff
lib/render/            engine (a small template engine), index (driver), cli
lib/init.js            cairn init
templates/shims/       vendored shim source
presets/               core/ + framework/ORM/styling presets rendered by `cairn render`
schema.json            JSON Schema for cairn.config.json
test/run.js            dependency-free test runner
```

No runtime dependencies. Node >= 18. `npm test` runs 61 tests.
