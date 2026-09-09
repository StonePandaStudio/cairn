# Plan

Execution order for what comes after v1. The *why* is in `DESIGN.md`
("The cross-repo context layer", "### Sequencing"); this is the running order and
where we are in it.

Last updated 2026-09-09.

## Where we are

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
- [x] `package.json` → `0.3.0`. 13 new tests → 46 total.
- [ ] Commit + `npm publish` `0.3.0`.

Then `cairn init` snap-proof (`--tracker youtrack --project-key PROOF`) swaps
`task-tracker.js` + `jira.js` + `youtrack.js` → one `cairn tracker`.

`local` provider is **not** here — the `LOCAL-*` folders are pre-tracker archive, and
`local`'s real driver is the `partOf` join key. It lands with the context layer
(step 2). `jira-server` stays a provider — other projects (e.g. glossr) may still use it.

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

## Immediate small fixes (not blocking, do when convenient)

- `README.md` claims `cairn init` seeds `ai/`; it does not. Either implement seeding
  for a fresh repo or fix the line. (DESIGN command table already corrected.)
- Tag the published release: `git tag v0.2.1 && git push --tags`
