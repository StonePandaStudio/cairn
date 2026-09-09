# Plan

Execution order for what comes after v1. The *why* is in `DESIGN.md`
("The cross-repo context layer", "### Sequencing"); this is the running order and
where we are in it.

Last updated 2026-09-09 (evening — `cairn render` + preset library committed + pushed,
`0.5.0`, 61 tests).

**Resume here:** verify `npm view @stonepandastudio/cairn version`, `npm publish 0.5.0`
if needed → charityiq Phase 2 (below). Then back to the roadmap: snap-proof gate
sprint → context-resolver prototype → workspace layer → `cairn sync`.

## Where we are (0.5.0)

- **Published through 0.4.2.** `youtrack` provider, list-`stack`, safe shim swap,
  `tracker.envPrefix`, per-provider env hints — all live. **snap-proof adopted**
  (backend + frontend on YouTrack, smoke-tested, branch `install-cairn`).
- **`cairn render` built** (0.5.0, awaiting publish) — a small template engine
  (`lib/render/engine.js`) + driver + `presets/core/workflow.json`. Turns the
  bundled presets into a repo's `ai/` + `.claude/commands/`. **Greenfield only** —
  writes absent files, manifests them, keeps anything on disk; `cairn sync` (the
  three-way merge) is still deferred. `presets/` now ships in the tarball.
- **Preset library** — `core` + framework (`nestjs`, `react`, `nextjs`) + ORM
  (`typeorm`, `drizzle`) + styling (`tailwind`) + `angular`. Slots split
  framework/ORM, concatenate per `stack[]` entry. See `presets/EXTRACTION.md`.
- **Deferred still:** workspace layer, hub, context layer, `cairn sync`, `local`
  provider.

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

## charityiq-app — on cairn's workflow (Phase 2, after 0.5.0 publish)

Separate product, Next.js 16 + Drizzle + Supabase, Sprint 0, own governance
(`CLAUDE.md` hard rules, `docs/adr/`, versioned prompts). Single repo — cairn's
cross-repo value doesn't apply yet, but the founder wants the brief→plan→execute
workflow. Nothing in charityiq is touched until 0.5.0 is on npm.

1. `git push` + `npm publish` `0.5.0`
2. In charityiq: `pnpm add -D @stonepandastudio/cairn`
3. `npx cairn init --stack nextjs,react,tailwind,drizzle --tracker none --render`
   → creates `cairn.config.json`, `_cairn/`, `.claude/commands/*.md`, `ai/agents/*`,
   `ai/AGENTS.md`, `ai/WORKFLOW.md`, `ai/infrastructure/code-guidelines.md` (seed —
   fork it). Nothing pre-existing is overwritten.
4. Reconcile `CLAUDE.md` — one line: `@ai/AGENTS.md` (or leave the workflow opt-in)
5. Fork `ai/infrastructure/code-guidelines.md` — fold in the charityiq hard rules
   (`requireTier`+`audit.log`, RAG-grounding) which stay tier-3
6. Drive development through `/create-brief` → `/enrich-description` → `/plan-task` →
   `/execute-plan` → `/code-review`

Known rough edges in the render (iterate as charityiq uses it): the "read mandatory
guidelines" lists in the agent docs still name `mappers.md` (snap-specific, no-ops
for a repo without it); `INITIAL_PROMPT.md` is not rendered (per-project).

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
