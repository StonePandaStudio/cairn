# Plan

Execution order for what comes after v1. The *why* is in `DESIGN.md`
("The cross-repo context layer", "### Sequencing"); this is the running order and
where we are in it.

Last updated 2026-09-15 — `0.7.0` through `0.8.2` published, synced into all 6
repos, all clean. `0.8.3` (below — the review-feedback-loop gap, found live in
charityiq backend running `CI-8`) not yet published, not yet synced.

**Resume here:** `npm publish 0.8.3` → `cairn sync` in all 6 repos (`architect.md`
changes — expect `fast-forward` there, `unchanged` elsewhere). Then: continue
using `cairn context check` against snap-proof's real `ai/contexts/` (already run
once locally — 34 nodes, 0 `OFF_CONVENTION`, 6 `CANDIDATE` matching the previously-
known entity pairs, 34/34 `MISSING_FRONTMATTER` since nothing has adopted the
convention yet) to decide the next slice: `cairn context adopt` (the interactive
brownfield pass — the thing that would actually let the 34 `MISSING_FRONTMATTER`
findings get resolved) or the `local` tracker provider, both still unbuilt per
DESIGN.md's sequencing.

### Gate skipped, explicitly

The user chose to skip "drive one more ticket through the pipeline" (the gate's
remaining validation step) and move straight to the context layer — "it will be
validated anyway." Recorded here because it's a real, deliberate deviation from the
A → C → B ordering `DESIGN.md`/this file argued for all session, not an oversight.
The gate itself (adopt v1, use it for a sprint) is still technically open —
`PROOF-6` is the only ticket through the full pipeline, and not entirely on current
templates. Worth returning to, just not blocking C anymore.

## Interim policy — propagating decisions/docs/contexts across repos

`cairn context` (below) now resolves and checks — but there is still no `adopt` or
automated write path. `check` only reports drift on `ai/contexts/**` files that
already exist; it does not create or edit anything. So the manual-propagation
policy from before `0.8.0` still holds, just with a real tool alongside it now:

- **charityiq**: decisions made in the `docs/` repo (static HTML briefs + ADRs) need
  to reach `admin`/`backend`/`frontend` as tasks touch them. `docs/` isn't itself one
  of the linked app repos — a 4th, source-only repo — a variant DESIGN.md's own
  examples don't cover directly, and `cairn context build` treats it as just another
  repo in the workspace unless told otherwise (untested — charityiq has no
  `repos.json` yet).
- **snap-proof**: backend ↔ frontend need to share entity/feature decisions. This
  *is* DESIGN.md's own worked example almost verbatim (`ai/contexts/entities/
  invoice.md` in both repos, line 962), and is now the repo `cairn context` was
  proven against for real.

**Write the `ai/contexts/**` doc by hand in each repo a decision touches, same as
before. Then run `cairn context check` to see the declared/candidate state** —
useful now even without `adopt`: it tells you when a same-named pair exists in two
repos with no declared link yet (`CANDIDATE`), and once you add `counterpartOf` by
hand, confirms the reverse edge resolved and the pair stopped showing up as a
suggestion. Do not build ad hoc propagation tooling beyond this — `adopt` is next,
not a hand-rolled substitute for it.

## `0.8.3` — a review's blocking issues went nowhere; nothing ever re-opened them

Found live in charityiq backend: `/code-review CI-8 1` wrote `review-step-1.md`
with 10 blocking issues (failing tests, a Nest 12 / Jest ESM incompatibility, a
missing RLS suite). The user asked whether `/plan-task` would pick that up before
re-running it — it wouldn't have. Traced precisely (their own investigation, not
guessed): `architect.md` B.1 reads only `description-step-[step].md`; `developer.md`
never mentions the review at all. `review-step-[N].md` appeared solely in the "File
roles" table — written, never read again by anything. The 0.6.2 fix made review
survive to disk; nothing then closed the loop back into planning.

Fix scoped to `architect.md` only, not `developer.md` — a second "fix-from-review"
mode on the developer would duplicate the real fix: an amended plan that already
states what's done and what's left is something `execute_plan` already knows how to
follow, unchanged. Keeps developer.md's "just follow the plan, decide nothing"
invariant intact.

- `presets/core/agents/architect.md` B.1 — also checks for
  `ai/tasks/[task]/review-step-[step].md`. Present alongside an existing plan means
  this invocation is a re-plan after review: blocking issues are required
  amendments, suggestions are the user's call.
- B.3 — split into "first plan" (write fresh, unchanged behavior) vs "re-plan after
  review" (amend the existing `plan-step-[step].md` — mark completed phases done,
  fold fixes into the remaining ones, record any fact the review surfaced that
  changes later steps, state which phase to resume from). Never rewrite a plan
  whose early phases the developer already executed.
- 1 new test (`test/run.js`): both the B.1 review-check and the B.3 amend language
  render. 87 passing.

## `0.8.2` — tracker command docs pointed at a shim path not guaranteed to exist

Found live: `/create-brief` in charityiq backend (greenfield — `cairn init` there,
never migrated from a hand-written tracker script) worked only because the agent
independently noticed `ai/scripts/` didn't exist and improvised running cairn from
`node_modules` directly, then flagged that `/youtrack-status` and `/youtrack-assign`
"point to that missing helper and will fail as written." Root cause: `lib/init.js`
only ever writes `ai/scripts/<slug>.js` when *replacing* a legacy script that was
already there (`LEGACY_SHIM_TARGETS`, by design — see its own comment, "cairn never
invents one of these paths in a repo that lacked it"); the one file every `cairn
init` unconditionally writes is `_cairn/scripts/jira.js` (that literal name,
regardless of provider — it dispatches on `cairn.config.json`, the filename is just
historical). Every tracker command doc assumed the conditional path instead of the
guaranteed one.

Not a rendering bug — the docs were simply telling agents to trust a file cairn
never promises to create. Fixed the docs, not `init`: writing `ai/scripts/<slug>.js`
into every greenfield repo "just in case" would be an unwanted generated file with
no purpose there (the whole point of that path is migration continuity for repos
that already called it from elsewhere) — `npx cairn tracker <cmd>` is simpler,
always resolves (`cairn` is a devDependency, not global — a bare `cairn tracker …`
only works if something else put it on `PATH`), and needs no generated file at all.

- `presets/core/WORKFLOW.md`, `presets/core/commands/{tracker-status,tracker-assign}.md`
  — lead with `npx cairn tracker <cmd>`; `_cairn/scripts/jira.js` named as the
  always-present equivalent; a legacy `ai/scripts/<slug>.js`, if present, is a third
  option explicitly flagged as not guaranteed.
- Test assertions updated to match, plus 2 new ones (`test/run.js`) guarding the two
  specific claims that regressed here: leads with `npx cairn tracker`, and states
  the legacy shim isn't guaranteed. 86 passing.

## `0.8.1` — every command's slash-picker entry showed raw `**AgentName**` markdown

Found from a screenshot: `/code-review` in the picker showed "You are acting as
**NestjsReviewerAgent**. Read `ai/agents/reviewer.md`..." verbatim, literal
asterisks and all. Root cause confirmed via the claude-code-guide subagent, not
guessed: Claude Code's command picker reads a `description:` YAML-frontmatter field
for its one-line summary; with no frontmatter at all, it falls back to the file's
first body line, unrendered. None of cairn's command presets had ever set one.

- `presets/core/commands/_stub.md` — `description: {{ step.oneLine }}` (a field
  `workflow.json` already carried, previously only used in `AGENTS.md`'s own
  summary table — same data, second consumer, not a new one) +
  `argument-hint: "[task]? [step] [title]"`, conditionally built from the same
  `step.canOmitTask`/`step.createsTask` flags 0.6.1 added.
- `presets/core/commands/{archive-tasks,tracker-status,tracker-assign}.md` and
  `presets/nestjs/commands/{plan-tests,execute-test-plan,run-qa}.md` and
  `presets/angular/commands/add-e2e-tests.md` — each gets a short static
  `description` + `argument-hint`.
- Verified the fence lands on line 1 with no leading blank line ahead of it — the
  `{{! }}` header comment is dropped as its own token during rendering, not by a
  text-level strip, so nothing of its surrounding whitespace survives into the
  frontmatter.
- 1 new test (`test/run.js`): every rendered command file starts with
  `---\ndescription: ...` and its description line carries no leftover `**`. 86
  passing.

## `0.8.0` — `cairn context build/check/counterparts`, the C prototype

Built exactly the scope this file already specced under "C. Prototype the context
resolver" (see below in this file's older sections) — frontmatter parser, declared
`counterpartOf`/`describes` resolved into a graph with inferred reverse edges, the
suggest pass, the 7 `context check` finding types (4 computed, 3 reported as not-
wired-yet, never a hard failure), `--json`, never fails CI unless `--strict`. Not
built: `adopt`, `serve` (MCP), the `local` tracker provider, hub/workspace
integration — deliberately, per DESIGN's own sequencing (those are step B's later
phases, after the workspace layer).

- `lib/context/frontmatter.js` — minimal YAML-frontmatter parser, zero-dependency
  (same stance as everywhere else in cairn): scalars, booleans, inline `[a, b]` and
  block `- a` arrays, no nesting, no multiline scalars. No fence at the top of the
  file is a no-op (`{}`), not an error.
- `lib/context/index.js` — `build(repos)` walks each repo's `ai/contexts/**/*.md`
  (repos in the `doctor.resolveRepos` shape — same `repos.json` workspace doctor
  already reads, reused directly, no new config format). Node id is
  `<repoName>:<path-within-repo>` — the same string a human writes in
  `counterpartOf`. `check(graph)` returns findings; `counterparts(graph, id)`
  returns resolved nodes with content attached, matching DESIGN's "the server
  returns graph + content" (Q3) even though there's no server yet — `serve` will
  be a thin CLI-to-MCP wrapper over this same function later, not a rewrite.
- **Convention, revised against real data mid-build**: first cut required exactly
  `ai/contexts/<category>/<name>.md` (one folder, one file) and flagged 12/34 real
  snap-proof docs `OFF_CONVENTION` — `features/<name>/overview.md`,
  `pages/<page>/<sub>/business-logic.md`. Both are deliberate, sensible nesting by
  feature/page, not violations. Loosened to "at least one category folder, then
  anything" — only a bare `ai/contexts/foo.md` with no category folder is
  `OFF_CONVENTION` now (unless `unmanaged: true`). This is exactly the kind of
  correction "prove the approach on real data" is supposed to produce.
- **Suggest pass**: same relative path or same first-`#`-heading title, across
  different repos, with no declared link and not silenced by `notCounterpartOf`
  (matched by full id or bare relative path, either side). Run against snap-proof's
  real backend/frontend: found the 6 entity pairs this file already knew about
  (`equipment-type`, `image`, `invoice`, `project`, `site-device`, `site`) — a real
  validation against known ground truth, not just a passing test.
- `lib/context/cli.js` + `bin/cairn.js context` — `build` / `check` / `counterparts
  <id>`, `--config repos.json` (default), `--json`, `--strict` (check only — exit 1
  if findings exist; plain `check` always exits 0, per DESIGN's "never fails CI").
- `D:\projects\snap-proof\repos.json` created (outside this repo — snap-proof
  itself is not a git repo, just the two clones side by side) — closes a pending
  TODO from the gate-adoption section below ("update the cairn workspace so `cairn
  doctor` sees the youtrack provider"), and is what made the real-data run above
  possible without an ad hoc script.
- 7 new tests (`test/run.js`): frontmatter edge cases, declared-link reverse
  inference + CANDIDATE suppression, `notCounterpartOf` silencing, DANGLING,
  OFF_CONVENTION with the nested-path fix and the `unmanaged` override, `check`
  never throwing, and a full CLI round-trip through a real `repos.json` workspace
  with `--strict`. 85 passing.

## `0.7.0` — adopt the legacy backlog: tracker commands, archive-tasks, the QA subsystem

Audited every legacy (non-cairn) `.claude/commands/` and `ai/agents/` file in
snap-proof backend/frontend (a subagent fork read all ~21 files against the current
presets — see the session for the full triage). Three verdicts: pure duplicates
(same role, pre-cairn naming — deleted), functionality already fully covered by
cairn's tracker CLI but never wrapped in a command doc (adopted, cheap), and a
genuinely uncovered QA/test-generation subsystem (adopted, real design work).

**Removed — 7 files, `git rm`'d in snap-proof (staged, not yet committed):**
backend's `node-architect.md`/`node-developer.md`/`node-reviewer.md`/
`.claude/commands/review-plan.md` (the file behind the `/review-plan` vs
`/code-review` mixup earlier), frontend's `angular-developer.md`/
`angular-reviewer.md`/`architect-lead.md` (the last one orphaned — no command even
referenced it).

**New — tracker-assign/status, always paired with a remote tracker:**
- `presets/core/commands/tracker-status.md` / `tracker-assign.md` — renders as
  `.claude/commands/{{ tracker.slug }}-status.md` / `-assign.md` (e.g.
  `youtrack-status.md`), matching the exact filenames snap-proof already had.
  1-token arg reports the current value, 2-token sets it — proven pattern lifted
  from the legacy files almost verbatim, since the underlying `get`/`set-status`/
  `set-assignee`/`close` already exist in `lib/tracker/cli.js`.
- Fixed a real bug surfaced while writing these: `presets/core/WORKFLOW.md`
  referenced `cairn tracker close-task`, which has never existed as a CLI
  subcommand (only `close`, which already fans out to every subtask). Now says
  `close` and names the new `-assign` command too.
- `lib/render/index.js` — these two render only when `tracker.remote`; unlike every
  other target they're not part of `workflow.steps`, so they're a separate
  unconditional-then-gated block in `renderTargets`, not a new step type.

**New — `archive-tasks`, universal (no tracker dependency):**
`presets/core/commands/archive-tasks.md` — 2-week-old `ai/tasks/[KEY]/` folders to
`ai/tasks/archive/<year>/<month>/`, git-log creation date with an mtime fallback,
collision-suffix handling. Renders unconditionally (works for `tracker: none` too,
archiving `LOCAL-*` folders same as tracker ones).

**New — the QA subsystem, the real work:**
Turned out to be two unrelated systems under one legacy label, not one:
- **NestJS**: a 3-agent unit/integration-test pipeline — `qa-architect`
  (`plan_tests(task, feature)`, named Jest cases, service/controller/integration
  split) → `qa-developer` (`execute_test_plan`, Haiku, follows the plan verbatim,
  one correction attempt per file, scoped runs only) → `qa-orchestrator`
  (`run_qa(task, feature|all)`, Sonnet-or-higher, sequential Developers — never
  parallel, two features can race a shared factory file — batch fan-in in `all`
  mode, continue-on-failure per feature).
- **Angular**: unrelated in shape — a single standalone Playwright e2e agent
  (`qa.md`, `add_e2e_tests(path)`, `data-testid`-only-when-needed, page objects,
  accessible-locator-first) invoked ad hoc via `/add-e2e-tests`, outside the task
  workflow entirely.
- Both **generified**: the legacy source had snap-proof-backend's exact API-module
  name irregularities hardcoded into `qa-architect` (a table nobody else's codebase
  would match), exact `yarn` script names and helper function names baked into
  `qa-developer`, and a stale monorepo-era `frontend/e2e/` path prefix throughout
  `angular-qa` (the actual path is `e2e/` at repo root — confirmed, the repo *is*
  "frontend" now, post-split). All replaced with "read `ai/contexts/testing/
  conventions.md` for this project's specifics" — same tier pattern as
  `code-guidelines.md` — rather than copied verbatim.
- `presets/nestjs/agents/qa-{architect,developer,orchestrator}.md` +
  `presets/nestjs/commands/{plan-tests,execute-test-plan,run-qa}.md`;
  `presets/angular/agents/qa.md` + `presets/angular/commands/add-e2e-tests.md`.
- `lib/render/index.js` — new mechanism, not hardcoded to QA: for each stack entry,
  glob `presets/<entry>/agents/*.md` and `presets/<entry>/commands/*.md` and render
  every file found. Generic on purpose — the next stack-specific addon (any stack,
  any shape) needs no render-code change, just files in the right folder.
  `{{ model }}` in these resolves exactly like `reviewer.md`'s (the top-level tier);
  `qa-developer.md` states Haiku as plain text instead, matching `developer.md`'s
  own convention rather than introducing a second model-variable scheme.
- 3 new tests (`test/run.js`): tracker-status/assign gate on `tracker.remote` and
  are named after the slug; `close-task` is asserted absent (regression guard for
  the WORKFLOW.md fix); QA files render only for the stack that ships them (nestjs
  gets QA-pipeline docs, angular gets `qa.md`, react gets neither). 78 passing.
- Verified: real render of both `nestjs,typeorm` and `angular` configs, spot-checked
  `{{ tracker.exampleKey }}`/`{{ model }}` substitution by hand.

Not extended to charityiq — none of backend/frontend/admin had this legacy
functionality to begin with, so there's nothing to adopt there; `cairn sync` will
just pick up the version bump.

## `0.6.4` — `cairn sync` silently orphaned any preset target a pre-cairn file already occupied

Found chasing why `/code-review` on `PROOF-6` still showed the pre-0.6.2 reviewer
doc after two syncs: the user had actually run the repo's legacy `/review-plan`
command (which reads `ai/agents/node-reviewer.md`, untouched pre-cairn content), not
cairn's own `/code-review`. Real bug underneath that mix-up: `planSync`'s loop over
brand-new preset targets (`lib/sync/index.js`, the block after the manifest loop)
skipped any target whose path already had a file on it —
`if (fs.existsSync(...)) continue;` — with no record, no report, and no
`--adopt-base` rescue path (that flag only wired into the loop over
*already-manifested* entries). `cairn init` on a repo with pre-existing same-named
files left them all in exactly this state. In snap-proof backend that was 7 files:
4 command stubs + `ai/AGENTS.md` + `ai/infrastructure/code-guidelines.md` (+196
lines behind) + `ai/WORKFLOW.md`; frontend had all 5 command stubs + the same three
docs. None of it was visible in `cairn sync`'s output, `cairn doctor`, or the
manifest — indistinguishable from "nothing to do here."

- `lib/sync/index.js` — new `OUTCOME.UNTRACKED`. A preset target with no manifest
  entry and an existing file at that path now reports `UNTRACKED` (needs
  `--adopt-base`) instead of vanishing; with `--adopt-base` it's routed through
  `planFile` the same way an already-tracked no-base entry is (adopt current
  content as base, then the normal 2x2 — quiet if template already matches,
  fast-forward/merge/conflict otherwise). `planFile`'s no-op/local-edit branch
  doesn't set `source`/`write` for an already-managed file (nothing to do) — since
  this file has never been recorded at all, both are forced so this run always
  creates its manifest entry.
- `lib/sync/cli.js` — `UNTRACKED` colored red, folded into the same non-zero-exit
  and "re-run with --adopt-base" reporting as `NO_BASE`; help text and the
  `--adopt-base` description updated to name the squatter case explicitly.
- 2 tests changed/added (`test/run.js`): the old "squatter is left alone,
  invisibly" assertion now asserts `UNTRACKED`, plus a new adopt-base round-trip
  test (quiet adopt when content already matches → manifest entry created →
  a later template change fast-forwards normally). 76 passing.
- Verified against the real repos before publishing: dry-run on snap-proof
  backend/frontend both show clean `fast-forward` for all 7/8 previously-stuck
  files, no conflicts; charityiq (greenfield, no pre-cairn collisions) shows no
  new `UNTRACKED`/`CREATED` at all — only the expected `code-guidelines.md` local
  edit already tracked in the gate TODO.

Separate from the code fix: this surfaces a real cleanup backlog in snap-proof —
pre-cairn `.claude/commands/{review-plan,plan-tests,run-qa,task-assign,task-status,
youtrack-assign,youtrack-status,execute-test-plan,archive-tasks}.md` and
`ai/agents/{node,angular}-*.md` are either duplicate-by-different-name (dangerous —
`/review-plan` vs `/code-review` is exactly what caused the confusion this session)
or genuinely orphaned (the QA workflow track cairn has no equivalent for yet). Not
addressed here — needs the user to decide archive vs. keep per file, not something
to silently delete.

## `0.6.3` — developer/reviewer model gates blocked going *up* a tier

Found discussing model selection for the pipeline: `developer.md` told the user to
switch down to Haiku even if already running Sonnet/Opus, and `reviewer.md` hard-
blocked anything but exact-match Sonnet — so reviewing with Opus (strictly more
capable, same cost shape — a bounded diff, not open-ended generation) required
fighting the agent doc instead of just doing it. Changed both to a direction-aware
check: a higher tier than required proceeds after a one-time confirmation (cost
tradeoff, not a correctness one); a lower tier still hard-blocks (defeats the point
of the gate). Prose-only, no render/`lib/` changes:

- `presets/core/agents/developer.md` — Model line: Sonnet/Opus/Fable active →
  confirm once, continue; anything else → prompt `/model haiku` as before.
- `presets/core/agents/reviewer.md` — Model Check: `{{ model }}` or higher → confirm
  once, continue; lower than `{{ model }}` → stop and notify, as before.
- 75 passing (unchanged).

## `0.6.2` — reviewer's report was never written to disk

Found running the gate sprint on snap-proof: `code_review` on `PROOF-6` (Opus) flagged
the class-2 orphan-image definition as wrong, but the report only ever existed as a
chat message — the terminal scrollback cleared before it was captured, and there was
no `ai/tasks/PROOF-6/review-step-1.md` to fall back on. Every other step
(`brief`/`description`/`plan`) writes its output to `ai/tasks/[task]/`; review was the
one step that didn't, so its findings can vanish with no way to recover them or diff
across re-reviews. Fixed by templating (`code_review` is an agent instruction, not a
function):

- `presets/core/agents/reviewer.md` — Report format section now says to write
  `ai/tasks/[task]/review-step-[step].md` in addition to printing the report in
  chat; principle 4 ("Report only. Do not edit files") narrowed to source files,
  carving out the exception for its own report file.
- `presets/core/agents/architect.md` — `review-step-[N].md` added to the "File roles
  at a glance" table (written by Reviewer, not immutable — overwritten on re-review,
  same as `description`/`plan`).
- No render/`lib/` changes — pure prose in two rendered agent docs. 75 passing
  (unchanged; nothing here is render-logic).

Whether the class-2 finding itself was a real bug or a false positive is still open —
lost with the chat output. Re-running review after this ships is also how we find out.

## `0.6.1` — `/create-brief` didn't support a new, ID-less task

Found using charityiq: with a remote tracker you can't predict the next issue key
(YouTrack assigns it), so `/create-brief <key> <step>`'s stub gave no way to start
a task without guessing one — a user tried passing a title instead of a key,
malformed the call, got a parse error. Fixed by templating, not code (`create_brief`
is an agent instruction, not a function):

- `presets/core/commands/_stub.md` — `create_brief`'s stub now says, when the
  tracker is remote, that omitting the task ID is valid (`{{ tracker.provider }}`
  mints the key) — never guess/increment one yourself.
- Same stub — for every tracker, leftover free text past the ID/step is now
  documented as the brief's title, not an error, so `/create-brief Add CSV export`
  seeds `## What` instead of erroring.
- `presets/core/agents/architect.md` — `create_brief(task, step, title?)` Step 0
  spec updated to match (title seeds `## What`; task-omitted path unchanged, now
  explicit about never guessing a key).
- `lib/render/index.js` — two new per-step context flags: `step.createsTask`
  (`fn === 'create_brief'`) and `step.canOmitTask` (`createsTask && tracker.remote`).
  Both branches templated in the stub; every other step (`enrich-description`,
  `plan-task`, `execute-plan`, `code-review`) renders unchanged.
- 1 new test (`test/run.js`) — remote vs `none` tracker render differs correctly,
  other steps untouched. 75 passing.

Propagation is the real test of `cairn sync`: publish, then `cairn sync` in
backend/frontend/admin should fast-forward `.claude/commands/create-brief.md`
cleanly (none of the three have hand-edited it).

## Where we are (0.6.0)

- **Published through 0.5.0.** `youtrack` provider, list-`stack`, safe shim swap,
  `tracker.envPrefix`, per-provider env hints, **`cairn render`** (template engine +
  preset library) — all live. **snap-proof adopted** (backend + frontend on
  YouTrack, smoke-tested, branch `install-cairn`).
- **`cairn sync` built** (0.6.0, awaiting publish) — `lib/sync/`. Re-renders the
  presets and reconciles each managed file against `_cairn/base/` (the last render,
  now stored by `render` + `init`) via the 2×2: no-op / fast-forward / keep-local
  (`MODIFIED`) / three-way merge. The merge shells out to `git merge-file --diff3`;
  a conflict writes markers, exits 3, and shows as `CONFLICT` (fifth manifest
  state, wired into `doctor` + `doctor --strict`). Base advances on every
  fast-forward, clean merge, **and conflict**, so a resolve + re-run converges to a
  quiet `MODIFIED`. `--adopt-base` for files rendered before 0.6.0.
- **Preset library** — `core` + framework (`nestjs`, `react`, `nextjs`) + ORM
  (`typeorm`, `drizzle`) + styling (`tailwind`) + `angular`. Slots split
  framework/ORM, concatenate per `stack[]` entry. See `presets/EXTRACTION.md`.
- **Deferred still:** workspace layer, hub, context layer, `local` provider,
  `cairn workspace sync` (walk all repos from the hub), section-level merge (only
  if line-level `diff3` proves too noisy — not speculatively), `OUTDATED` in the
  doctor (needs template hashes threaded through).

## Where we were

- **v1 published** — `@stonepandastudio/cairn@0.2.1`, npm public. `tracker` +
  `doctor` + `init`. 35 tests.
- **Target reframed** — the cross-repo authored-context layer is the point; tracker
  and doctor are substrate. See `DESIGN.md`.
- **snap-proof surveyed** — 2 repos (backend + frontend), both **on YouTrack now**
  (`TASK_TRACKER=youtrack`, folders carry `<!-- youtrack-subtask: PROOF-N -->`).
  Migrating off Jira. `PROOF` project is **shared across both repos**, keys
  project-sequential — a real projects-layer case. `LOCAL-*` folders are pre-tracker
  archive (confirmed), handled as orphaned task folders. `1/` deleted;
  `translations-creator/` is an old tool replaced by Glossr — out of family.
  Context folders: 6 entity pairs, `mappers.md` pair, stack-shaped `features/`↔
  `pages/`, **no YAML frontmatter anywhere** (~40 files).
- **Not started:** `youtrack` provider, the gate, workspace layer, hub, context
  layer (`local` provider lands with it).

## The gate

DESIGN rule: nothing new starts before v1 has run across the repos for a sprint.
Not optional. But `cairn init` on snap-proof is itself blocked on 0.3.0 (below).

## Step 0 — `youtrack` provider, ship 0.3.0

Before `cairn init` on snap-proof. See DESIGN "### Sequencing" step 0.

- [x] `lib/tracker/youtrack.js` — ported from `snap-proof/backend/ai/scripts/youtrack.js`.
  Same interface as `jira-server.js`; no `process.exit`, throws `TrackerError`.
  `get()` gained `parent` + `subtasks` via the `Subtask` link. `setStatus` on an
  unknown Stage → `TrackerError` with valid names (not `NoTransitionError` — YouTrack
  has no transition graph). `toMarkup` passthrough.
- [x] Registry (`lib/tracker/index.js`), `schema.json` enum, `lib/init.js`
  (`issueTypes` block skipped for youtrack).
- [x] **Markup audit** — `jira-server.toMarkup()` checked against
  `snap-proof/backend/ai/JIRA_MARKUP.md` + `ai/TASK_TRACKER_MARKUP.md`. Gaps found
  and fixed: `*italic*`→`_italic_` (was left as Jira bold), `~~strike~~`→`-strike-`,
  `> quote`→`bq.`, and Markdown pipe tables → `||header||` / `|body|` with the
  separator row dropped. Not done (deliberate): literal `{` escaping (risky to
  auto-apply), `{noformat}` vs `{code}` choice (a judgment call).
- [x] `package.json` → `0.3.0`. Published.
- [x] `cairn init` now replaces every legacy client the repo carries
  (`jira.js` + `youtrack.js` + `task-tracker.js`), not just `jira.js` — `0.3.1`.
- [x] `cairn init`'s "Next: ensure .env has …" line was hard-coded to `JIRA_*`
  regardless of provider — now per-provider via `tracker.providerEnv()`.
- [x] `tracker.envPrefix` — opt-in (`cairn init --env-prefix CAIRN_`) so a repo whose
  app also reads `JIRA_*`/`YOUTRACK_*` can isolate cairn's credential var names.
  Unprefixed stays the default.
- [x] Both fixes → `0.4.1` (published).
- [x] `cairn init` shim swap is no longer a blind overwrite: a file already holding
  the shim is skipped silently, a hand-edited shim is **kept + reported** unless
  `--force-shims`, and a first-time swap prints the line count being replaced.
  → `0.4.2`, 56 tests. Awaiting publish.
- [x] **`stack` is a list now** (`0.4.0`). `presets/node` → `presets/nestjs`.
  `--stack nestjs,typeorm` writes `"stack": ["nestjs", "typeorm"]`. Doctor
  `cohort: "stack"` groups by `stack[0]`. `presets/typeorm` composes on top; a
  Prisma backend would be `["nestjs", "prisma"]`. Downstream `ai/agents/node-*.md`
  rename deferred to the v2 regen. 51 tests.
- [ ] Commit + `npm publish` `0.4.0`.

## Adopt in snap-proof (the gate)

Both repos use **yarn**. Per repo:

1. `yarn add -D @stonepandastudio/cairn`
2. `.env` already has `YOUTRACK_URL` / `YOUTRACK_TOKEN` / `YOUTRACK_PROJECT` — nothing to add.
3. **backend:** `npx cairn init --dry-run --stack nestjs,typeorm --tracker youtrack --project-key PROOF`
   **frontend:** `npx cairn init --dry-run --stack angular --tracker youtrack --project-key PROOF`
4. review, then run without `--dry-run`
5. `npx cairn tracker get PROOF-1` — smoke test against real YouTrack
6. commit `cairn.config.json`, `_cairn/`, the swapped `ai/scripts/*.js`
7. `TASK_TRACKER` env var and `ai/scripts/{jira.js,youtrack.js}` are now dead —
   remove `TASK_TRACKER` from `.env`, leave the shimmed files (docs still name them)
8. use the workflow for a sprint; watch the YouTrack sync

Then update the cairn workspace (`repos.json`) so `cairn doctor` sees the youtrack
provider, and read both `ai/contexts/` trees for the context-convention design.

`local` provider is **not** here — the `LOCAL-*` folders are pre-tracker archive, and
`local`'s real driver is the `partOf` join key. It lands with the context layer
(step 2). `jira-server` stays a provider — other projects (e.g. glossr) may still use it.

## charityiq-app — on cairn's workflow (Phase 2)

Plan changed shape mid-flight: not a single Next.js+Drizzle+Supabase repo — split
into `D:\projects\charityiq-app\{backend,frontend,admin}` (+ `docs/`, `legacy/` —
untouched), each its own repo. cairn's cross-repo value *does* apply now, sooner
than expected.

- [x] `0.6.0` published, all three on it.
- [x] **backend** — `cairn init --stack nestjs,typeorm --tracker youtrack
  --project-key CI --render` (postgres is typeorm's driver, not a separate preset).
- [x] **admin** (react admin frontend) — `cairn init --stack react,tailwind
  --tracker youtrack --project-key CI --render`.
- [x] **frontend** (react client) — same as admin, initialized after.
- [x] Root `repos.json` — `backend`/`frontend`/`admin` (docs/legacy excluded),
  rules for command stubs, `AGENTS.md`/`WORKFLOW.md`, agent docs,
  `code-guidelines.md`, all `cohort: "stack"` — cross-stack `cohort: "all"` was
  pure agent-name noise (`NestjsXAgent` vs `ReactXAgent`) that the doctor's
  normalizer can't fold, since v2 render derives names rather than reading them
  from a `vars` block. `cairn doctor` clean: 11 `IDENTICAL`, backend alone in the
  nestjs cohort (nothing to compare against yet).
- [x] Stale root `cairn.config.json` (from before the split) deleted.
- [ ] Reconcile each repo's `CLAUDE.md` — one line: `@ai/AGENTS.md`
- [ ] Fork each repo's `ai/infrastructure/code-guidelines.md` — fold in the
  charityiq hard rules (`requireTier`+`audit.log`, RAG-grounding) which stay tier-3
- [ ] Drive development through `/create-brief` → `/enrich-description` →
  `/plan-task` → `/execute-plan` → `/code-review`

Known rough edges in the render (iterate as charityiq uses it): the "read mandatory
guidelines" lists in the agent docs still name `mappers.md` (snap-specific, no-ops
for a repo without it); `INITIAL_PROMPT.md` is not rendered (per-project).

Once charityiq has real `ai/contexts/` across backend/frontend/admin, it becomes a
second data point for the context-convention design alongside snap-proof (step A) —
worth reading when C (context-resolver prototype) starts.

## Order after 0: A → C → B

### A. Run the gate — adopt v1 in the real repos

1. Per repo: `npm i -D @stonepandastudio/cairn`
2. Per repo: `.env` gets `JIRA_BASE_URL`, `JIRA_USER`, `JIRA_PASSWORD` (skip the
   no-tracker repo)
3. Per repo: `npx cairn init --dry-run --stack <backend|frontend|cli> --tracker
   <jira-server|youtrack|none> --project-key <KEY>` → review → run for real
4. Per repo: commit `_cairn/` + the swapped `ai/scripts/*.js` shim(s)
5. From the workspace: `cairn doctor` → record the baseline
6. Use `cairn tracker` in the actual workflow for a sprint
7. **While there:** read every repo's `ai/contexts/` — raw material for the context
   convention. The convention cannot be designed well without it.

Cheap, mandatory, feeds the design.

### C. Prototype the context resolver

The riskiest unknown, built against the current flat `repos.json` — no
`workspace.json` or hub yet.

- frontmatter parser for `ai/contexts/*.md`
- resolve declared links (`counterpartOf`, `describes`) into a graph, infer reverse edges
- the 7 `context check` findings: `OFF_CONVENTION`, `DANGLING`, `MISSING_FRONTMATTER`,
  `BROKEN_ANCHOR`, `CONTENT_MISMATCH`, `TRACKER_DESYNC`, `CANDIDATE`
- the suggest pass (filename / entity-name / task-folder heuristics) → `CANDIDATE`
- `cairn context check --json`, never fails CI

Goal: prove the approach on real context data before building infra to host it.

### B. Build the workspace layer (DESIGN Sequencing step 1)

The safe part — known engineering. Do it once C has shaped what the schema needs.

- `workspace.json` schema + `layout` field
- `preset → workspace → repo` inheritance (tracker/vars stop repeating per repo)
- `cairn workspace init`
- `cohort: "project"` = the workspace itself
- three doctor checks: task span, orphaned task folders (the `LOCAL-*` cruft),
  project-level progress rollup

Then, in sequence, per DESIGN: **1b** hub → **2** context layer proper (convention
preset, `cairn context adopt`, `build`, **the `local` tracker provider**) → **3**
`cairn context serve` (MCP) → **4** agent presets → **5** guidelines import → **6**
portable workflows.

## `cairn sync` — template propagation — **BUILT (0.6.0)**

Turns `cairn render` from one-shot greenfield into an upgrade path. Full spec in
`DESIGN.md` ("### The upgrade algorithm is a 2×2" … "### What to build").

**Shipped:**

- **`_cairn/base/<rel>`** — verbatim copy of the last render, written by `render`
  and `init` alongside the real file. `cairn sync`'s merge base. Committed like the
  rest of `_cairn/`.
- **The 2×2** (`lib/sync/index.js` `planFile`), diffing `base` / `ours` (disk) /
  `theirs` (fresh render): no-op · fast-forward · keep-local (`MODIFIED`) ·
  three-way merge. Plus `RESTORED` (deleted locally), `ORPHANED` (preset dropped
  the path — never touched), `NO_BASE` (rendered pre-0.6.0 and edited since —
  needs `--adopt-base`).
- **Conflict cell** shells out to `git merge-file -p --diff3`. Clean → written;
  conflicted → markers written in place, `cairn sync` exits 3. `CONFLICT` is a
  fifth manifest state, wired into `doctor` + `doctor --strict`.
- **Convergence:** base advances to `theirs` on fast-forward, clean merge, *and*
  conflict — so resolve-markers + re-run lands on a quiet `MODIFIED`, not a second
  merge of the same change. Flag clears once the markers are gone.
- **Not auto-triggered** — nothing re-renders on `npm update`; `cairn sync` is
  explicit, per repo.
- 13 tests (`test/run.js`, "--- sync" block).

**Deliberately not built (add only when the need is real):**

- **Section-level merge** (document as ordered map of `##` sections). DESIGN:
  build only if line-level `diff3` proves too noisy on the 400-line agent docs.
- **Per-mechanism routing** (slot fill never merges, section-replace merges only
  its named section, `fork` vs `link`). Needs the preset extension mechanism to
  exist first — today every managed file is line-merged.
- **`cairn workspace sync`** — walk every repo from the hub. Needs the workspace
  layer.
- **Health metric** — "after a preset update, how many repos need human
  attention". Wire in once >1 repo actually renders.

**Prior art if the above gets built:** [copier](https://copier.readthedocs.io/)
(`.copier-answers.yml`, three-way update), cruft, RN `rn-diff-purge`, k8s
server-side apply (per-section provenance).

## Immediate small fixes (not blocking, do when convenient)

- `README.md` claims `cairn init` seeds `ai/`; it does not. Either implement seeding
  for a fresh repo or fix the line. (DESIGN command table already corrected.)
- Tag the published release: `git tag v0.2.1 && git push --tags`
