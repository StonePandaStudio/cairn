# @stonepandastudio/cairn

Shared AI workflow scaffolding, kept in sync across several repos.

Each repo carries an `ai/` folder and a `.claude/commands/` folder holding the same
workflow — brief → description → plan → execute → review, with the steps optionally
mirrored into an issue tracker. Hand-copied between repos, they drift. cairn renders
them from one set of presets and reports where existing copies disagree.

A cairn is a stack of stones left to mark a trail. That is what this does: it leaves
markers — a manifest of what it generated, and a report of where the copies stopped
agreeing.

```bash
npm i -D @stonepandastudio/cairn
npx cairn init --stack nestjs,typeorm --tracker jira-server --project-key MYPROJ --story-type Task
```

## What it does

| Command | |
|---|---|
| `cairn tracker <cmd>` | Issue tracker client (`jira-server` / `youtrack` / `none`). Replaces the copied `ai/scripts/*.js` clients |
| `cairn doctor` | Cross-repo drift report, per-repo generated-file state (incl. `OUTDATED`), and which cairn version each repo pins, has installed, and was last rendered with |
| `cairn init` | Makes a repo cairn-managed: writes `cairn.config.json`, `_cairn/`, and the shim |
| `cairn render` | Scaffolds `ai/` + `.claude/commands/` from the bundled presets, from the repo's stack + workflow |
| `/request-change` | Not a `cairn` subcommand — a slash command `render` adds to repos that share a workspace and a remote tracker. Files a `[target-repo]` issue in the shared tracker project, linked so the requesting task *depends on* it; the target repo adopts it with `/create-brief <key>` |
| `cairn sync` | Re-renders and three-way merges preset changes into a repo that has already rendered |
| `cairn workspace <cmd>` | Manages the repo list in a workspace `repos.json`: `init`, `add <path>` (stack read from the repo's `cairn.config.json`, or `--stack`), `remove <name>`, `list`. Edits only `repos`; the hand-written `shared` / `normalize` blocks stay as they were |
| `cairn upgrade` | Walks the repos in a `repos.json`: updates the installed cairn through each repo's own package manager (npm / yarn / pnpm), then runs `cairn sync` with that version. Report-only unless `--apply`; never commits, pushes, or edits the pin |
| `cairn preset list` | The bundled presets — kind (framework / orm / styling), what each ships, and which ones this repo's `stack` uses. `render`, `sync` and `init` also check the stack: a name listed twice or `core` as an entry is refused; a name with no preset (a typo) warns with a suggestion — `cli` and `unknown` are the deliberate exceptions |
| `cairn context <cmd>` | **Prototype.** Resolves `ai/contexts/**/*.md` across a `repos.json` workspace into a graph — declared `counterpartOf` links, inferred reverse edges, and a same-path/same-title suggest pass. `build` / `check` / `counterparts <id>`; `check` never fails CI on its own (`--strict` opts in) |

`cairn render` is **greenfield only**: it writes files that do not exist, records them
in the manifest, stores the render in `_cairn/base/`, and leaves anything already on
disk alone (reporting it).

`cairn sync` is the upgrade path. For each managed file it holds three versions —
`base` (the last render, in `_cairn/base/`), `ours` (what is on disk), `theirs` (what
the current presets render) — and runs a 2×2:

| | template unchanged | template changed |
|---|---|---|
| **local unchanged** | no-op | fast-forward — write the new render |
| **local changed** | keep local (`MODIFIED`) | three-way merge |

Three cells are automatic. The merge shells out to `git merge-file`; a clean result
is written, a conflicted one is written **with markers** and the command exits
non-zero (`CONFLICT`, a fifth manifest state). Nothing is ever silently overwritten.
Resolve the markers and run `cairn sync` again — the base has already advanced, so
the second run is a quiet `MODIFIED`.

```bash
cairn sync --dry-run          # show the outcome per file, write nothing
cairn sync                    # apply; exit 3 if any file is left in conflict
cairn sync --adopt-base       # for files rendered before _cairn/base/ existed
```

## The two folders

```
repo/
  cairn.config.json     you edit this. cairn only ever reads it.
  _cairn/               cairn writes this. nobody hand-edits it.
    manifest.json       what was generated, from which template, at which hash
    base/               the last render of every managed file — `cairn sync`'s merge base
    scripts/jira.js     vendored tracker shim
  .claude/commands/     rendered from the workflow — one stub per step (+ QA stubs, see below)
  .claude/agents/       code-scout.md — read-only code-locator subagent
  ai/
    agents/             rendered from presets/core + your stack's slots
                        (architect, developer, reviewer; plus qa-* if the stack ships the QA slots)
    AGENTS.md  WORKFLOW.md   rendered
    infrastructure/code-guidelines.md   rendered once as a seed — then it is yours
    contexts/  tasks/   yours, never written by cairn
```

`cairn render` seeds the rendered files once and records them in the manifest; it
never rewrites a file you have edited. `cairn sync` is what re-renders later preset
changes over your edits, three-way merging where both moved. The boundary is the
whole design: hand-edited config living inside a generated directory is how
generated directories acquire state nobody dares regenerate.

Generated files are **committed**, not gitignored. Claude Code discovers
`.claude/commands/` and agent docs from disk, and a prompt change should show up in
`git diff` like any other change.

## Workflow and agents

Three agents, one step each, rendered from `presets/core` with the stack's slots filled in:

| Step (command) | Agent | Does |
|---|---|---|
| `create_brief` (`/create-brief`) | architect | Scaffolds `brief-step-N.md` for you to fill in. Given a tracker key filed by `/request-change`, seeds it from that issue instead of creating a second parent |
| `enrich_description` (`/enrich-description`) | architect | Discussion, then `description-step-N.md` |
| `plan_task` (`/plan-task`) | architect | `plan-step-N.md` + `ai/contexts/**` updates |
| `execute_plan` (`/execute-plan`) | developer | Implements the plan |
| `code_review` (`/code-review`) | reviewer | Writes `review-step-N.md`; reports only, never edits source |

The architect and developer delegate code search to the `code-scout` subagent
(`.claude/agents/code-scout.md`, Haiku by default; `agents.scout.model` moves it up for a
large or unusual tree).

**Models are recommendations, not gates.** Developer recommends Haiku, reviewer the tier in
`model`. Before the first run in a session the agent states the recommendation and the
active model, then asks once: *Continue on the current model? OK / not OK*. OK proceeds for
the rest of the session; not OK stops so you can switch.

**The plan carries tests.** Plans have a **Tests** section: per test file, a table of named
cases the developer writes verbatim, runs file by file, and the reviewer checks exist (the
reviewer never runs them). "Context Docs to Update" is a table with a *When* column
(`now` / `after implementation`), so the developer knows which docs are left for it.

**Re-plans.** If `plan-step-N.md` already exists, `/plan-task` is a re-plan, sent back by a
review's blocking issues or by a developer stop-report. The architect amends the plan
rather than rewriting it, and adds an **Execution Status** section (`Done: steps 1–4.
Resume from: step 5.`) that the developer and reviewer honor.

**Test-first (`tdd: true`).** The architect orders each step's unit test files before the
code and marks every test file `unit` or `integration`. The developer runs each unit file
red (an assertion or missing symbol — not a broken test), then green, and reports
`RED (<reason>) → GREEN (N)`; the reviewer treats a unit file without a red line as a
blocking finding. Default `false`.

**Build command.** `commands.build` (e.g. `"yarn build"`) is what the developer runs before
reporting completion; without it the agent finds the command in `package.json` or the README.

### QA pipeline for existing code

Separate from the workflow: `/plan-tests [task] [target]`, `/execute-test-plan [task] [target]`
and `/run-qa [task] [target|all]` add tests to code that already exists, via `qa-architect`,
`qa-developer` and `qa-orchestrator`. They are a core contract; a framework preset opts in
by shipping seven `qa-*` slots (`qa-target`, `qa-source`, `qa-plan-rules`, `qa-plan-format`,
`qa-write-steps`, `qa-all-targets`, `qa-mandatory-docs`). `nestjs` fills them for Jest,
`angular` for Playwright e2e; `react` and `nextjs` get no QA agents. Agent names default to
the primary stack (`NestjsQAArchitectAgent`) and can be set with `agents.qaArchitect.name`,
`qaDeveloper`, `qaOrchestrator`. Test-first does not apply here: there is nothing to go red
against. See `presets/README.md` § QA.

> Migrating: the old `/add-e2e-tests` command and `ai/agents/qa.md` (angular) are gone,
> replaced by the pipeline above. Run `cairn sync`; delete the leftover files if you no
> longer want them.

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

### Moving issues between stages

Two workflow steps can move the issue, and only if the repo names the stage:

```json
"tracker": { "provider": "youtrack", "projectKey": "CI",
  "statuses": { "inProgress": "Develop", "review": "Review" } }
```

- `plan_task` moves the step's issue (and its parent, for a child issue) to `inProgress` at the end of the plan (the architect's B.5).
- `code_review` moves it to `review` **at the start** of the review (R.0). The verdict never changes the stage; later moves stay manual.
- Nothing moves without the key: cairn's defaults (`To Do` / `In Progress` / `Done`) are not a promise your board has them. Run `cairn tracker check-statuses` to compare the configured names with the board; `list-statuses` shows the board's.

**A stage the board does not have is skipped, not fatal.** The agents run `cairn tracker set-status <key> "<stage>" --if-exists`. If the board has no such stage the command prints `skipped: stage "Review" does not exist on this board, so CI-5 was not moved. Valid stages: …` and exits 0; the agent mentions it once and carries on, and never substitutes another stage. Without `--if-exists` the same call fails (exit 1) and names the valid stages. On Jira, a stage that exists but cannot be reached from the issue's current state is still the old "no transition" message (exit 0): only a stage the project never defined counts as missing.

### Epics and public refs (both optional)

Nothing here changes a repo that doesn't use it: no config, no extra requests, and
`get` prints the same JSON as before.

```bash
cairn tracker create-epic "Onboarding rework"
cairn tracker create-story "Invite flow" ./brief.md --epic MYPROJ-50
cairn tracker set-epic MYPROJ-61 MYPROJ-50      # or `none` to detach
cairn tracker epic-children MYPROJ-50
cairn tracker close-epic MYPROJ-50              # refuses while stories are open; --force cascades
```

Jira Server stores the link in the "Epic Link" custom field (id differs per instance,
looked up by name the first time an epic command needs it; set `tracker.epicLinkField`
to skip the lookup and let `get` report `epic`). YouTrack uses Type = Epic and the same
`Subtask` link stories use for their subtasks. `none` skips every epic command.

**Public refs** (`tracker.publicRefs: true`): the tracker's own key stays the internal
one (`CI-79`); epics also get `CI-E1` and stories created or moved under an epic get
`CI-<epic>-<n>` (`CI-1-4` = story 4 of epic 1). The ref is a `ref-CI-1-4` label (Jira)
or tag (YouTrack), so it is searchable in the tracker and needs no custom field. Every
tracker command accepts either form (`cairn tracker get CI-1-4`). Rules:

- Steps get refs too. `CI-1-4.2` is step 2 of story 4 in epic 1; step 1 is the story
  itself, so `CI-1-4.1` resolves to `CI-1-4`. To add a step by ref:

  ```bash
  cairn tracker create-step CI-1-4 "Add the rollback path" ./brief-step-2.md          # next free number
  cairn tracker create-step CI-1-4 "Add the rollback path" ./brief-step-2.md --step 2 # match brief-step-2.md
  ```

  Pass `--step` to keep the ref in line with the workflow's `brief-step-N` file. A number
  a sibling step already holds is refused; step numbers start at 2.
- Refs are immutable: a story moved to another epic keeps the ref it was born with.
- Only new issues are numbered. An epic created before `publicRefs` has no ref, and
  stories added to it get none.
- Numbers are max+1, so two people creating at the same moment can collide.
  `cairn tracker check-refs` lists any ref carried by more than one issue; nothing is
  renumbered automatically, since refs get quoted in commits.
- The ref is printed on stderr (`public ref: CI-1-4`); stdout stays the bare tracker key.

### Legacy command names

`create-task`, `create-story`, `close-story` and friends are all still accepted, and
output formats are byte-for-byte what the old scripts printed. Existing prose
references name these strings and the agents parse the output, so they are kept
until a render pass regenerates those documents from the presets.

## Customizing agent docs: `ai/local/`

`ai/agents/*.md` are generated. Don't edit them: a project's changes live next to them
in `ai/local/`, which cairn reads and never writes, and `cairn sync` rebuilds the agent
from the template plus those files. There is nothing to merge, so a template update
can't conflict with your edits.

```
ai/local/
├── slots/<slot>.md      change one stack slot (implementation-reference, review-checklist, …)
└── agents/<name>.md     add to the end of one agent doc
```

**A slot file holds only the sections that differ.** A heading the preset also has
replaces that section (and anything nested under it); every section the file doesn't
mention keeps following the preset.

```markdown
<!-- ai/local/slots/implementation-reference.md -->

### Controllers
- Bind inputs with `@Body({ schema })`, `@Param({ schema })`, `@Query({ schema })`
- Return the response DTO class; there is no `@ZodResponse`

### Billing
- Money is integer minor units. Use `Ledger`, never a raw repository.

### Testing
<!-- remove -->
```

- `### Controllers` replaces the preset's Controllers section.
- `### Billing` isn't in the preset, so it is added at the end of the slot.
- `<!-- remove -->` as a section's body deletes that section.
- A file with no headings is appended to the slot. A first line `<!-- replace -->` makes
  the file the whole slot; that is the one form where you restate the preset's text.
- The `architect-mandatory-docs` slot is now `mandatory-docs`, because the developer and
  reviewer read the same list. An `ai/local/slots/architect-mandatory-docs.md` still
  applies, but rename it; `cairn override status` flags the old name.
- Headings inside code fences are text. Other leading `<!-- … -->` comments are yours and
  are dropped. The files are templates, so `{{ tracker.exampleKey }}` and friends work.

`ai/local/agents/<name>.md` is appended to `ai/agents/<name>.md` under a "Project-specific"
heading, for rules that belong to no slot. `key-patterns` feeds both the architect and the
developer, so overriding it changes both.

```bash
cairn sync                                   # rebuilds the agents from template + ai/local
cairn override status                        # what is in ai/local, and what needs a look
cairn override extract ai/agents/developer.md   # turn a hand-edited agent doc into overrides
cairn sync --reset ai/agents/developer.md    # then take the generated file
cairn override ack implementation-reference  # "I've reviewed the preset's change"
```

**If an agent doc was edited by hand** while the template moved, `cairn sync` leaves it
alone, prints your edit as a diff, and exits 3. `cairn override extract` writes that diff
out as override files (only the changed sections), checks that they reproduce your edit,
and leaves what it can't place for you to decide. Then `--reset` takes the generated file.
If the template didn't move, a hand edit is only noted.

**Staying current.** An override replaces a section for good, so the preset's later
improvements to it won't reach you. Sync records each override the first time it sees it
and says so when the preset's slot changes underneath it, or when a section you replaced
no longer exists in the preset (it would otherwise be added as a second section).
`cairn doctor` lists the same warnings across the workspace; `cairn override ack` clears
one once you've looked.

Only agent docs work this way. Command stubs, `WORKFLOW.md`, `AGENTS.md` and
`code-guidelines.md` keep the three-way merge on `cairn sync`, since they have no
`ai/local/` hook.

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
| `OUTDATED` | cairn has newer content for it — needs template hashes threaded through |
| `DELETED` | it is gone; `cairn sync` restores it from the current render |
| `CONFLICT` | `cairn sync` left git merge markers in it — resolve, then sync again |

The doctor reports all five. `OUTDATED` means the current presets render something
different from the last render stored in `_cairn/base/` — `cairn sync` would move it.
A `MODIFIED` file whose template also moved stays `MODIFIED`. Acting on drift between
the render and the working tree is `cairn sync`.

A separate **cairn versions** table lists, per repo, the `package.json` pin, the version
in `node_modules`, and the cairn that last wrote `_cairn/manifest.json`. It flags a repo
whose install is behind the running cairn, one whose files were rendered by an older cairn
than it now has installed (update done, `cairn sync` not), and one whose cairn is a link
to a checkout rather than a published version. Not part of `--strict`.

A file can be perfectly in sync across repos while being hand-edited away from its
template, and vice versa. `MODIFIED` outranks `OUTDATED` in the report because
overwriting a hand edit is the destructive outcome.

### Workspace config (`repos.json`)

- `repos[]` — name, path, stack (`"angular"` or a list `["nestjs", "typeorm"]` —
  framework first), and an optional one-line `role` (`"REST API, source of truth for the
  contract"`). Per-repo settings live in each repo's own `cairn.config.json`;
  the inline `vars` blocks are a fallback used only until a repo has been through
  `cairn init`, so migration can happen one repo at a time.
- **The workspace reaches the agents too.** `cairn render` / `cairn sync` look for this
  file at `../repos.json` (or `workspace` in the repo's `cairn.config.json`). If the repo
  is listed in it alongside others, the rendered `ai/AGENTS.md` gains a **Workspace**
  table (sibling name, relative path, stack, `role`), and the architect's mandatory
  checklist and description format require it to name which siblings the task touches.
  Without this, a repo's agents know nothing of the other repos in the project. Adding a
  repo or a `role` changes the render; `cairn sync` carries it in.
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

A later release splits this flat file into a per-project `workspace.json` plus an
opt-in hub that references the projects for cross-project comparison. See `DESIGN.md`.

## Layout

```
bin/cairn.js           subcommand router
lib/config.js          cairn.config.json + .env loading
lib/workspace.js       sibling repos from repos.json, for the renderer
lib/presets.js         preset catalogue + stack validation; lib/preset/ is `cairn preset`
lib/manifest.js        generated-file hashing and state
lib/paint.js           ANSI + table rendering
lib/tracker/           index (registry), cli, jira-server, youtrack, none
lib/doctor/            index (analysis + report), scan, normalize, diff, versions
lib/render/            engine (a small template engine), index (driver), cli
lib/sync/              index (the 2x2 + git merge-file, outdatedRels), cli
lib/upgrade/           cairn upgrade — update + sync across a workspace
lib/init.js            cairn init
templates/shims/       vendored shim source
presets/               core/ + framework/ORM/styling presets rendered by `cairn render`
schema.json            JSON Schema for cairn.config.json
test/run.js            dependency-free test runner
```

No runtime dependencies (`cairn sync` shells out to `git`). Node >= 18. `npm test`
runs the whole suite, including snapshot tests: every file the presets render for four
representative stacks is committed under `test/snapshots/`, so a template change shows up as
a diff. After an intended change, `UPDATE_SNAPSHOTS=1 npm test` and review `git diff test/snapshots`.
