# Design notes

Why cairn is shaped the way it is, what was measured to decide it, and what is
deliberately left undone. The README says what the tool does; this says why.

Written 2026-07-31, at the v0.2.0 rename.

---

## The problem

Five repos each carry an `ai/` folder and a `.claude/commands/` folder holding the
same workflow — brief → description → plan → execute → review → QA, mirrored into
Jira. They were copied between repos by hand and kept in sync by hand.

```
D:/projects/snap-proof/backend       backend    PROOF
D:/projects/snap-proof/frontend      frontend   PROOF
D:/projects/glossr/glossr-api        backend    GLO
D:/projects/glossr/glossr-frontend   frontend   GLO
D:/projects/glossr/glossr-cli        cli        —      (no tracker)
```

The ask was one framework covering: npm package, init, code guidelines, project
description, task/step workflow, Jira sync, progress tracking, contexts, agents,
backend/frontend agnostic.

## What the survey found

Before designing anything, the doctor was run across all five. The numbers are the
whole basis for the design, so they are recorded here rather than re-derived:

| Layer | Measurement | Reading |
|---|---|---|
| `.claude/commands/*.md` | 13 stubs, 3 COSMETIC, 2 STRANDED, rest DRIFT | thin, mergeable, high-value |
| `ai/scripts/jira.js` | 4 copies, 3 variants, 72 ln drift, 80% same | pure code, should never have been copied |
| `ai/WORKFLOW.md` | 4 variants, 43% same | generic state machine tangled with project trivia |
| `ai/INITIAL_PROMPT.md` | 4 variants, **0% same** | not one document. Do not unify |
| `ai/agents/*reviewer.md` | 92% / 85% same | role contract genuinely is shared |
| `ai/agents/*qa-developer.md` | 33% same, 367 ln | not shared; don't pretend |
| `ai/infrastructure/code-guidelines.md` | backend 43% same, 520 ln | drift here is *correct* — different codebases |
| `glossr-cli` | absent from the workspace entirely | 5th repo, own command vocabulary |

Two conclusions that shaped everything after:

1. **The "sync problem" is three different problems.** Duplicated code, duplicated
   prompt templates, and legitimately-divergent project content were all being
   hand-synced the same way. They need three different mechanisms.
2. **Not all drift is bad.** `code-guidelines.md` at 43% same is two genuinely
   different codebases (snap has no Zod, glossr does). Unifying it would make the
   agents *worse*. Any design that treats every difference as a defect is wrong.

## Three tiers

The core structural decision. Content is separated by **what varies**, not by what
folder it happens to sit in:

```
TIER 1  CODE          jira client, doctor, renderer, stats
        → npm package. Zero copies in repos.

TIER 2  GENERATED     command stubs, WORKFLOW.md, JIRA_MARKUP.md, agent role contracts
        → rendered from config into real paths, checksummed in a manifest.
        → never hand-edited.

TIER 3  PROJECT-OWNED contexts/, progress/, tasks/, code-guidelines.md,
                      DATABASE_SCHEMA.md, INITIAL_PROMPT.md, PROJECT_SUMMARY.md
        → seeded once at init, then never touched. Ever.
```

Most framework-extraction attempts die by dragging tier 3 into tier 2. The 520-line
`code-guidelines.md` gap is the standing warning sign.

## Decisions taken

### Scoped package name

Every bare candidate was checked against the npm registry — `cairn`, `quarry`,
`chisel`, `flint`, `cobble`, `plinth`, `keystone`, `slate`, `geode`, `grove`,
`masonry`, `bedrock`, `lodestone` — **all taken**. The `@stonepanda` scope is
unused. Since scoping is required regardless, the name could be picked for meaning.

`cairn`: a stack of stones marking a trail for whoever follows. The tool leaves
markers — manifest hashes, task folders, progress files. Stone-themed for Stone
Panda, five characters, types cleanly.

Rejected: `bamboo` (Atlassian's CI product — actively confusing in repos that sync
to Jira), `obsidian`, `slate`, `masonry` (all famous JS projects).

### Vendor + commit + manifest

Generated files are written to their real paths, committed, and recorded in
`_cairn/manifest.json`.

The alternative — resolving templates at runtime from `node_modules` — fails on a
hard constraint: Claude Code discovers `.claude/commands/` and agent docs from
disk. It would need a symlink or postinstall shim, and prompt changes would stop
appearing in `git diff`.

The manifest is what makes "generated" auditable. Without it, a hand-edited
generated file is indistinguishable from one cairn wrote — which is exactly the
failure mode that produced the drift the tool exists to report.

### `cairn.config.json` at root, `_cairn/` for output

**The boundary rule: you edit the root config, cairn writes `_cairn/`.**

Putting the hand-edited config inside the generated directory is how generated
directories acquire state nobody dares regenerate. Keeping them apart means
`_cairn/` can always be deleted and rebuilt.

`ai/` keeps its name. Renaming it would touch every doc, every command stub, and
every path reference in five repos for zero functional gain.

### Two report axes, not one

The doctor reports drift (cross-repo: do the copies agree?) and managed state
(per-repo: does disk match what cairn wrote?) as separate axes. A file can be
perfectly in sync across repos while being hand-edited away from its template, and
vice versa. Collapsing them into one status column hides both signals.

`MODIFIED` outranks `OUTDATED` because overwriting a hand edit is the destructive
outcome, so it is the one that must surface.

### `none` is a real tracker provider

`glossr-cli` has no issue tracker. Making that a first-class provider — rather than
an error case — means workflow steps become no-ops instead of every command stub
needing an "if this repo has Jira" branch written in prose.

It also forced the abstraction to be honest: a null tracker that threw would just
push the branching back into the callers.

### Path aliases over renaming

`glossr-cli` calls its stubs `execute-tests.md` and `review-code.md` where the
others use `execute-test-plan.md` and `code-review.md`. Aliasing folds them onto
the cohort's canonical names.

Without this the doctor reported one `MISSING` and one `STRANDED` for what is the
same file — a false signal someone would act on wrongly.

### `INITIAL_PROMPT.md` excluded from comparison

Four variants at 0% shared content. It is a per-project document, not a drifted
template, and reporting it as drift forever would train everyone to ignore the
report.

## v1 scope, and what was held back

v1 shipped tracker + doctor + init. **Template rendering was deliberately excluded.**

v1 swaps the Jira client under five repos. Bundling prompt changes into the same
release would make any regression unattributable — was it the new client, or the
new prompt? Splitting them keeps each release's blast radius legible.

Three v1 details that exist purely to keep the blast radius small:

- **The shim.** Roughly forty prose references across five repos say
  `node ai/scripts/jira.js <command>`. Replacing that file with a 3-line shim means
  zero doc churn while 237 lines of duplicated client leave each repo. It also
  exercises the manifest mechanism on a file where a bad hash costs nothing.
- **Legacy command names kept.** `create-task`, `create-story`, `close-story` are
  aliases now, but the names and output formats are byte-for-byte preserved. The
  agents parse that output.
- **`repos.json` vars fallback.** The doctor reads each repo's `cairn.config.json`
  when present and falls back to inline vars otherwise, so repos migrate one at a
  time instead of in a flag day.

## The v2 idea: workflow as config

The largest remaining win, and the actual answer to "I don't want to sync manually
anymore."

The pipeline currently exists **three times** — in `.claude/commands/*.md`, in
`ai/WORKFLOW.md`, and in each agent doc. Three copies is why it drifts. Declare it
once:

```jsonc
{
  "workflow": {
    "steps": [
      { "id": "brief",    "command": "create-brief",  "agent": "architect",
        "tracker": { "createIssue": "onMissing", "createSubIssue": true } },
      { "id": "describe", "command": "enrich-description", "agent": "architect",
        "tracker": { "subIssueStatus": "To Do", "appendParentSummary": true } },
      { "id": "plan",     "command": "plan-task",    "agent": "architect",
        "tracker": { "issueStatus": "In Progress", "subIssueStatus": "In Progress" } },
      { "id": "execute",  "command": "execute-plan", "agent": "developer", "tracker": null },
      { "id": "review",   "command": "code-review",  "agent": "reviewer",  "tracker": null }
    ]
  }
}
```

Command stubs and `WORKFLOW.md` become render targets of this. Drift stops being
policed and becomes structurally impossible. glossr-cli's renamed commands become a
`commandAlias` field instead of a divergent file — the alias mechanism already in
the doctor moves up into the renderer.

### Slots, not file overrides

Templates should declare named blocks (`{{> stack.testing }}`) that projects fill,
rather than offering whole-file override. Full-file override is the escape hatch you
use twice, not the mechanism. Local modification of a generated file should read as
a signal that a slot is missing, not as routine.

### Presets

Layered like eslint `extends`:

```
core (role contracts, workflow, tracker)
  └─ preset-node / preset-angular / preset-cli   (persona bodies, guideline seeds)
       └─ project config (vars, overrides, slots)
```

Evidence it works: reviewer contracts 85–92% same across stacks. Evidence of the
limit: qa-developer 33% same — that one is preset-level, not core.

Published later as `@stonepanda/cairn-preset-node` etc. The scope makes that free.

## Migration order

Each step independently valuable; stop anywhere.

1. ~~`jira.js` → package + tracker interface~~ — **done in v1**. Mechanical, best
   ratio, zero prompt risk.
2. Workflow config + rendered command stubs. Kills the 13-file drift.
3. Render `WORKFLOW.md` / `JIRA_MARKUP.md` from the same config; split the project
   trivia out into tier 3. (`WORKFLOW.md` today mixes the generic state machine with
   things like "retrofit PROOF-201, PROOF-207" — that half is project state.)
4. Agent role contracts → core, persona bodies → presets. Hardest merge, do last.
5. `progress/` rollup and `STATS.md` → generated (`cairn progress`, `cairn stats`).
   Promotes glossr-frontend's stranded `stats/task-stats.csv`.
6. `contexts/`, `tasks/`, guidelines — never touched.

## Known risks

- **Tier 3 leakage.** The permanent failure mode. Guidelines and contexts must stay
  project-owned even when they look almost-shareable.
- **Generated files fight the agent.** An agent mid-task wants to edit a command
  stub; the header says don't. Slots reduce this, don't eliminate it.
- **No prompt tests.** A regression in a template silently degrades five repos.
  `cairn doctor --strict` in CI is the floor; rendered-output snapshots are the real
  fix and don't exist yet.
- **Version churn.** Bumping cairn changes prompts in every repo at once, which can
  change agent behaviour mid-sprint. Repos pin a version; upgrades are explicit,
  never automatic.
- **Payoff timing.** Five repos, one developer. The value is real but arrives via
  repo #7 or via churn rate, not on day one. Migrating incrementally is what makes
  that acceptable.

## Open questions

- Rename the working directory `D:/projects/ai-kit` → `cairn`? Git remote and
  `.idea/` implications; not done.
- Run `cairn init` against the five real repos — deletes 237 lines from each and
  rewrites `ai/scripts/jira.js`. Not done without explicit go-ahead. `--dry-run`
  first.
- Claim the `@stonepanda` npm org. Registry search shows zero published packages
  under it, but that proves nothing is published there, not that the scope is
  unclaimed. Verify with `npm org create` while logged in.
- `.claude/agents/` native subagents vs `ai/agents/*.md` docs — currently the docs;
  worth revisiting when presets land.
