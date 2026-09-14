# Plan

Execution order for what comes after v1. The *why* is in `DESIGN.md`
("The cross-repo context layer", "### Sequencing"); this is the running order and
where we are in it.

Last updated 2026-09-14 — `0.6.4` published and synced into all 6 repos (snap-proof
backend/frontend via yarn, charityiq backend/frontend/admin/docs via npm), all clean
fast-forwards, no conflicts. **Verified.** `PROOF-6` fully closed: re-reviewed after the B1 fix,
0 blocking issues, 45 unit tests passing. First real ticket through the whole
pipeline end to end — though `create_brief`/`enrich_description`/`plan_task`/
`execute_plan` ran on it *before* 0.6.4 rescued backend/frontend's stuck command
stubs, so it doesn't count as a clean run on current templates for those steps; only
the two `code_review` passes ran on current `reviewer.md`.

**Resume here:** the gate ("use it for a sprint") isn't done — one ticket, and not
even fully on current templates. Two threads, either order:
1. Drive one more real snap-proof ticket through the full pipeline now that every
   repo is on current templates end to end, as the actual clean validation.
2. Decide what to do with the still-unaddressed legacy-command backlog flagged
   earlier (`review-plan.md`, `node-*.md`/`angular-*.md`, the QA-track files with no
   cairn equivalent) — the `/review-plan` vs `/code-review` mixup is exactly the
   failure mode this would prevent from recurring.

Then the roadmap: finish the snap-proof gate sprint → context-resolver
prototype → workspace layer.

## Interim policy — propagating decisions/docs/contexts across repos, until C

No tooling for this exists yet (`cairn context` is unbuilt — see DESIGN.md "The
cross-repo context layer"). Two live cases surfaced doing charityiq/snap-proof work:

- **charityiq**: decisions made in the `docs/` repo (static HTML briefs + ADRs) need
  to reach `admin`/`backend`/`frontend` as tasks touch them. `docs/` isn't itself one
  of the linked app repos — a 4th, source-only repo — a variant DESIGN.md's own
  examples don't cover directly.
- **snap-proof**: backend ↔ frontend need to share entity/feature decisions. This
  *is* DESIGN.md's own worked example almost verbatim (`ai/contexts/entities/
  invoice.md` in both repos, line 962) — the simpler, intra-project half of the
  problem; per DESIGN.md line 1058-1060 it needs no hub, unlike the cross-project
  graph.

**Until C (context-resolver prototype) starts, propagate manually via each repo's
`ai/contexts/**`** — the convention architect.md already points agents at. When a
decision spans repos, write/update the corresponding `ai/contexts/**` doc in each
repo it touches, by hand. This isn't a placeholder to route around — per the gate's
step A item 7 ("read every repo's `ai/contexts/` — raw material for the context
convention"), doing this manually *is* the gate work, and every case handled this
way becomes real input to C's design (declared counterpart links, what "drift"
looks like in practice, whether the charityiq docs-as-source shape needs its own
handling). Do not build ad hoc propagation tooling or start C early to solve this
faster — see the gate ordering above.

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
