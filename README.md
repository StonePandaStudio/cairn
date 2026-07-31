# @stonepanda/cairn

Shared AI workflow scaffolding for Stone Panda repos.

Five repos — `glossr-api`, `glossr-cli`, `glossr-frontend`, `snap-proof/backend`,
`snap-proof/frontend` — each carry an `ai/` folder and a `.claude/commands/` folder
holding the same workflow: brief → description → plan → execute → review → QA, with
the steps mirrored into Jira. They were copied between repos by hand and drifted.

A cairn is a stack of stones left to mark a trail. That is what this does: it leaves
markers — a manifest of what it generated, and a report of where the copies stopped
agreeing.

```bash
npm i -D @stonepanda/cairn
npx cairn init --stack backend --tracker jira-server --project-key PROOF --story-type Task
```

## What v1 does

| Command | |
|---|---|
| `cairn tracker <cmd>` | Issue tracker client. Replaces the four copied `ai/scripts/jira.js` files |
| `cairn doctor` | Cross-repo drift report, plus per-repo generated-file state |
| `cairn init` | Makes a repo cairn-managed: writes `cairn.config.json`, `_cairn/`, and the shim |

Template rendering — generating the command stubs, `WORKFLOW.md` and the agent role
contracts from one workflow declaration — is v2, and deliberately not in this release.
v1 swaps the Jira client under five repos; bundling prompt changes into the same
release would make any regression impossible to attribute.

## The two folders

```
repo/
  cairn.config.json      you edit this. cairn only ever reads it.
  _cairn/                cairn writes this. nobody hand-edits it.
    manifest.json        what was generated, from which template, at which hash
    scripts/jira.js      vendored shim
  ai/                    project-owned. cairn seeds it at init and never touches it again.
    contexts/  progress/  tasks/  infrastructure/
```

The boundary is the whole design. Hand-edited config living inside a generated
directory is how generated directories acquire state nobody dares regenerate.

Generated files are **committed**, not gitignored. Claude Code discovers
`.claude/commands/` and agent docs from disk, and a prompt change should show up in
`git diff` like any other change.

## Tracker

```bash
cairn tracker list-statuses PROOF
cairn tracker create-task "Protected image fetch API"
cairn tracker create-subtask PROOF-217 "Step 1: signed URL issuing"
cairn tracker set-status PROOF-218 "In Progress"
cairn tracker append-description PROOF-217 ./ai/tasks/PROOF-217/brief-step-1.md --markup
cairn tracker close-story GLO-42          # cascades through subtasks first
```

Providers are `jira-server` and `none`. `none` is a real provider, not an error case:
`glossr-cli` has no tracker, and the workflow steps become no-ops rather than every
command stub needing an "if this repo has Jira" branch written in prose.

Three things the four copied scripts did that this does not:

- **`process.exit` from library code.** Failures throw `TrackerError`; the CLI layer
  chooses the exit code. That is what makes the client callable from a workflow runner.
- **Fail on a re-run.** Transitioning to a status the issue already holds is a
  successful no-op. `NoTransitionError` exits 0 — re-running a step must be safe.
- **Ask an agent to convert markup by hand.** `ai/JIRA_MARKUP.md` was a prose document
  in three variants explaining markdown → Jira wiki conversion. It is `toMarkup()` now,
  under test, reachable via `--markup`.

Credentials come from the repo's `.env` (`JIRA_BASE_URL`, `JIRA_USER`, `JIRA_PASSWORD`).
Jira Server 8.5.1 predates PAT support, so auth is Basic. Anything already in the
environment wins over the file.

### Legacy command names

`create-task`, `create-story`, `close-story` and friends are all still accepted, and
output formats are byte-for-byte what the old scripts printed. Roughly forty prose
references across five repos name these strings, and the agents parse the output.
They get renamed in the v2 pass that regenerates those documents.

## Doctor

```bash
cairn doctor                                     # full table
cairn doctor --diff ai/WORKFLOW.md               # hunks for one file across repos
cairn doctor --json
cairn doctor --strict                            # exit 1 on drift or a hand-edited generated file
```

It reports two independent axes, and keeping them apart is the point:

**Drift** — cross-repo. Do the copies still agree? Raw comparison is noise, so each
file is normalized first: BOM and CRLF stripped, repo paths and names folded,
`GLO-18`/`PROOF-210` folded to `{{ISSUE}}`, and declared vars folded to
`{{placeholder}}`. What survives is drift no template variable explains. Files are
then clustered by normalized content; the largest cluster becomes the reference.

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
| `OUTDATED` | cairn has newer content for it |
| `DELETED` | it is gone; `sync` will restore it |

A file can be perfectly in sync across repos while being hand-edited away from its
template, and vice versa. `MODIFIED` outranks `OUTDATED` in the report because
overwriting a hand edit is the destructive outcome.

### Workspace config (`repos.json`)

- `repos[]` — name, path, stack. Per-repo settings live in each repo's own
  `cairn.config.json`; the inline `vars` blocks are a fallback used only until a repo
  has been through `cairn init`, so migration can happen one repo at a time.
- `pathAliases` — local → canonical. `glossr-cli` calls its stubs `execute-tests.md`
  and `review-code.md`; aliasing folds them onto the cohort's names instead of
  reporting one `MISSING` and one `STRANDED` for what is the same file.
- `shared[]` — glob rules. `cohort: "all"` compares every repo; `cohort: "stack"`
  compares backend-with-backend. `requires: { tracker: true }` skips repos with no
  tracker. A repo with no config has an *unknown* tracker, not an absent one, and is
  never skipped on that basis.
- Anything not matched by a rule — `ai/contexts/`, `ai/progress/`, `ai/tasks/`,
  `DATABASE_SCHEMA.md` — is per-project by design and never inspected.
  `ai/INITIAL_PROMPT.md` is explicitly excluded: four variants at 0% shared content
  make it a per-project document, not a drifted template.

## Layout

```
bin/cairn.js           subcommand router
lib/config.js          cairn.config.json + .env loading
lib/manifest.js        generated-file hashing and state
lib/paint.js           ANSI + table rendering
lib/tracker/           index (registry), cli, jira-server, none
lib/doctor/            index (analysis + report), scan, normalize, diff
lib/init.js            cairn init
templates/shims/       vendored shim source
schema.json            JSON Schema for cairn.config.json
test/run.js            dependency-free test runner
```

No runtime dependencies. Node >= 18. `npm test` runs 34 tests.
