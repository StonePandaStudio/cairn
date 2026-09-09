# Design notes

Why cairn is shaped the way it is, what was measured to decide it, and what is
deliberately left undone. The README says what the tool does; this says why.

Written 2026-07-31, at the v0.2.0 rename. The near-term target was reframed
2026-09-09 — see "The cross-repo context layer". The tracker and the drift doctor
are substrate for it, not the point.

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
`masonry`, `bedrock`, `lodestone` — **all taken**. The `@stonepandastudio` scope is
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

The same interface later takes `youtrack` and `local` providers — the roster becomes
a per-repo choice (`tracker.provider`), which is what the `snap-proof` repos
hand-built as `task-tracker.js`. See "The tracker becomes a choice of provider".

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
anymore." Read the prior-art section below before building it — BMAD already ships
something very close, and whether to build or wrap is an open question.

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
core (role contracts, tracker)
  └─ preset-nestjs / preset-angular / preset-typeorm / preset-cli   (persona bodies, guideline seeds)
       └─ workspace.json  (one project — workflow, tracker config, repo set)
            └─ repo config (vars, slot fills, overrides)
```

`stack` is a **list**, framework first: `["nestjs", "typeorm"]`, declared as
`--stack nestjs,typeorm`. The renderer layers one preset per entry, in order, so a
backend on Prisma takes `["nestjs", "prisma"]` and never touches `preset-typeorm`.
`presets/nestjs` and `presets/typeorm` are already split on this basis
(`presets/EXTRACTION.md`). The doctor's `cohort: "stack"` groups by the first entry —
comparison is at framework granularity, where the shared contracts live; ORM and
add-on differences are resolved by composing presets, not by the cohort.

Evidence it works: reviewer contracts 85–92% same across stacks. Evidence of the
limit: qa-developer 33% same — that one is preset-level, not core.

The downstream agent docs are still named `node-*.md` (the preset became `nestjs`
2026-09-09, the docs follow in the v2 regeneration pass — the same pass that renames
the legacy tracker command names).

The workspace layer between preset and repo was added after the fact; see the
multi-repo roadmap below for why it is not optional, and "Layout" for where each
file sits. Presets stay an in-repo
`presets/` folder — internal only — until a third organisation needs them.

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

## Prior art: BMAD-METHOD and GitHub Spec Kit

Surveyed 2026-07-31. Both are mature, widely used, and solve a *different* problem —
which is the useful finding, because it says what cairn should and should not build.

(Checked because "Speccy" is ambiguous: `wework/speccy` is an unrelated OpenAPI
linter. The relevant tool is `github/spec-kit`.)

| | BMAD-METHOD | Spec Kit | cairn |
|---|---|---|---|
| Unit of concern | one project | one feature in one project | **N repos** |
| Stance | prescriptive method | prescriptive method (SDD) | descriptive — your method, kept in sync |
| Install | `npx bmad-method install` | `specify init` (Python/uv) | `npx cairn init` |
| Ships content | 12+ personas, 34+ workflows, 5 modules | templates, checklists, constitution | **zero** |
| Artifacts | `_bmad-output/`, `SPEC.md`, `stories.yaml`, `sprint-status.yaml` | `.specify/`, spec→plan→tasks | `_cairn/` + the existing `ai/` |
| Agent coupling | own personas | agent-agnostic, 35 integrations | the repos' existing agent docs |
| Tracker sync | none found | `/speckit.taskstoissues` → GitHub Issues | Jira Server, behind a provider interface |
| Post-install drift | not addressed | not addressed¹ | the entire point |
| Multi-repo | no | no | yes — cohorts, aliases, normalized diff |
| Brownfield | greenfield-oriented | greenfield-oriented | brownfield-only by construction |

¹ `specify self upgrade` upgrades the CLI, not templates already written into a project.

Both answer *"what process should I run?"* Cairn answers *"how do five repos stop
disagreeing about the process they already run?"* Neither has the second thing.

### What they have that cairn does not

- **BMAD**: a real content library — 12+ personas, 34+ YAML workflow blueprints,
  expansion packs (Test Architect, game dev). One maintained persona set against
  our five hand-written ones sitting at 33–92% similarity.
- **Spec Kit**: `.specify/templates/overrides/` — a layered override directory,
  which is the "slots, not file overrides" idea above, already shipped and
  validated by GitHub. Read it before designing ours. Also `/speckit.analyze` for
  cross-artifact consistency, and `constitution.md` for project principles.

### What cairn has that neither does

- **Cross-repo drift measurement.** Genuinely absent from both. Neither has a
  concept of "these two copies disagree by 72 lines."
- **Hand-edit detection.** Spec Kit sidesteps it via the overrides directory
  (nothing to hand-edit); BMAD, nothing found. No equivalent of `MODIFIED`.
- **Jira Server 8.5.1 Basic auth.** Spec Kit does GitHub Issues; our board is
  on-prem and predates PATs.
- **Not owning the method.** `code-guidelines.md` at 43% divergence encodes real
  per-codebase truth. Adopting either framework means discarding it.

### Convergences worth stealing

1. **BMAD's workflows are YAML blueprints** — prior art for the workflow-as-config
   sketch above. Read their schema before inventing one.
2. **`constitution.md` / `project-context.md`** — both frameworks treat project
   principles as explicitly non-generated. Independent confirmation of tier 3.
3. **`sprint-status.yaml` / `stories.yaml`** — BMAD keeps progress machine-readable.
   Our `ai/progress/*.md` + `PROGRESS.md` rollup is hand-maintained markdown tables.
   Migration step 5 gets much easier if that state moves to YAML first.
4. **`/speckit.taskstoissues`** is our `create-subtask` sync point under another name.
5. Spec→Plan→Tasks→Implement vs our brief→description→plan→execute→review→QA.
   Near-identical. Two independent teams landing on the same pipeline is decent
   evidence the pipeline is right.

### The uncomfortable conclusion

**v2 as sketched rebuilds what BMAD already ships.** Rendering command stubs and
agent contracts from a workflow declaration is squarely BMAD's territory, with far
more iteration behind it. v1 — tracker abstraction plus multi-repo drift — is the
part neither framework touches.

So the v2 fork is not "which template syntax":

- **cairn as engine** — render our own templates. Full control, keeps five repos'
  accumulated conventions, but means maintaining a template library forever.
- **cairn as sync layer over BMAD or Spec Kit** — let them own method and content;
  cairn keeps their output consistent across five repos and bridges Jira Server.
  Much smaller surface, and it plays to the gap actually found.

The doctor's own numbers argue for the second: the files cheapest to unify (command
stubs, 3 COSMETIC) are exactly the ones BMAD would supply, while the ones that must
be kept (`code-guidelines.md`, `INITIAL_PROMPT.md`) are ones neither framework wants
to own anyway.

Not decided. The tracker migration does not depend on it either way, so the sane
order is to run v1 across the five repos and live with it for a sprint first.

Sources: [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) ·
[BMAD workflow map](https://docs.bmad-method.org/reference/workflow-map/) ·
[github/spec-kit](https://github.com/github/spec-kit) ·
[Spec Kit docs](https://github.github.com/spec-kit/) ·
[GitHub blog: spec-driven development](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)

## Multi-repo projects: the roadmap after v1

Revised 2026-09-08: workspace-per-project plus an opt-in hub replaces the earlier
single-workspace `projects[]` sketch. The reasoning is below; the file trees are
under "Layout".

The workspace is flat today — one `repos.json` listing all five repos, cohorts by
stack. Reality has a level in between: a **project** is a set of repos, and the two
projects here (`glossr`, `snap-proof`) have separate teams, lifecycles, and Jira
keys. They should not share one config file.

**Decision: one workspace per project, plus an opt-in hub.**

- `cairn.config.json` — per repo. Unchanged.
- `workspace.json` — one per project. Its repos, stacks, tracker defaults, and
  intra-project `shared[]` rules. Lives in a dedicated coordination repo
  (`glossr/cairn/`) for multi-repo, or at the git root for a monorepo. A project
  "lives its own life" — it can change its guidelines or even swap to BMAD without
  touching anything else.
- hub `projects.json` — one per org, optional. References each project's
  `workspace.json` by path and holds sync metadata (version pins, fork/link policy,
  a sync log). Picked up only when you want cross-project drift analysis, put down
  after. It is cairn's actual differentiator — cross-repo drift — isolated into one
  tool.

The hub is an **analysis lens, not a config layer**: it never injects config
downward. Inheritance stays `preset → workspace → repo`. Live drift is recomputed
from the referenced repos every run, never cached authoritatively; only pins,
policy, and the log are hub-owned state.

```
glossr      GLO    glossr-api        GLO-5, 11, 17, 30, 33, 35, 42
                   glossr-cli        GLO-1, 2, 3
                   glossr-frontend   GLO-33, 37, 39, 44
snap-proof  PROOF  snap-backend      PROOF-217
                   snap-frontend     PROOF-207, 209, 210, 212, 215
```

Three things in that data are already load-bearing and already unmodelled:

- **`GLO-33` has a task folder in both `glossr-api` and `glossr-frontend`.** A
  cross-repo task exists in the working data right now. `ai/WORKFLOW.md` handles it
  with prose — *"always confirm via `get [key]` before assuming"* — because there is
  nowhere to declare it.
- **Thirteen `ai/progress/*.md` filenames are identical** across glossr-api and
  glossr-frontend: `auth`, `export`, `gdpr`, `import`, `invoices`, `projects`,
  `subscriptions`, `translations`, `users`, `waitlist` and three more. One feature
  list, maintained twice. `PROGRESS.md` already carries Backend/Frontend columns, so
  the rollup is trying to be project-level while living separately in each repo.
- **Contexts pair up by naming convention only.**
  `features/users/registration.md` exists on both sides with the same path;
  `waitlist-signup.md` (api) pairs with `waitlist-frontend.md` (frontend) with no
  shared name at all.

### Two projects, three stacks, one hole

|  | backend | frontend | cli |
|---|---|---|---|
| **snap-proof** | snap-backend | snap-frontend | — |
| **glossr** | glossr-api | glossr-frontend | glossr-cli |

The two comparison axes are genuinely orthogonal and both have data:

- `cohort: "project"` → the workspace itself. snap-proof with 2 repos, glossr with 3.
  Runs from a project's own `workspace.json`, in that project's CI.
- `cohort: "stack"` → grouped by `stack[0]`: a `nestjs` pair, an `angular` pair, and
  **`cli` alone**. The pairs are cross-project, so this axis lives in the **hub**, not
  in any one workspace.

Splitting the axes this way is what lets `cairn doctor --strict` run in a single
project's CI — the intra-project checks need only that project checked out. The
cross-project (`stack`) checks need every project on disk and run from the hub, on a
maintainer's machine.

The empty cell has a consequence worth stating plainly, because it limits what the
doctor can promise. `glossr-cli` is a stack of one, so it never forms a stack
cohort — the analyzer skips groups with fewer than two members, which is why no
`stack:cli` section appears in the hub output. Its only cross-repo comparison is
project-level, against a `nestjs` and an `angular` repo, where agent-doc similarity
is meaningless.

**So `preset-cli` has no peer and cannot be validated by comparison.** `preset-nestjs`
and `preset-angular` each get checked against a second repo; the cli preset will
only ever be validated by hand, or by a second CLI repo appearing. Any claim that
"the doctor validates the presets" is true for two of three.

### The resolution chain

Everything below is detail on this order:

```
  hub projects.json                   org — references projects, holds sync metadata
      │                                (pins, fork/link policy, sync log). opt-in.
      ↓ references — no config flows down
@stonepandastudio/cairn               engine
  presets/nestjs | angular | typeorm | cli   content — an in-repo folder, package-shaped
      ↓ extends
  workspace.json                      ONE project — key, repos[], tracker defaults,
      │                                intra-project shared[]. glossr/cairn/workspace.json
      ↓ extends
  repo cairn.config.json              vars, slot fills, overrides
      ↓ renders
  .claude/commands/, ai/agents/       generated + manifested
  ai/contexts, ai/progress, ai/tasks  never touched
```

### Layout: where every file lives

Three topologies, one `workspace.json` schema. A `layout` field selects path
resolution; nothing else in the schema changes.

#### Monorepo — `layout: "monorepo"`

One `.git`, one `.claude/commands/`, one `ai/`. Packages are code only, so nothing
can drift internally. `cairn init` at the root is the whole setup; no
`workspace.json` unless the monorepo joins a hub.

```
glossr/
├── .git/
├── cairn.config.json              HAND-EDITED · layout:"monorepo", stacks, tracker, vars
├── _cairn/                        GENERATED · safe to delete + rebuild
│   ├── manifest.json              what cairn wrote + sha
│   ├── base/                      merge bases — three-way merge on upgrade
│   │   ├── .claude/commands/create-brief.md
│   │   └── ai/agents/nestjs-developer.md
│   └── scripts/jira.js            vendored tracker shim
├── .claude/commands/             GENERATED (v2), committed
│   ├── create-brief.md
│   ├── plan-task.md
│   ├── execute-plan.md
│   └── code-review.md
├── ai/                           PROJECT-OWNED · seeded once at init
│   ├── AGENTS.md
│   ├── WORKFLOW.md                GENERATED (v2)
│   ├── JIRA_MARKUP.md             GENERATED (v2)
│   ├── INITIAL_PROMPT.md          per-project, never compared
│   ├── PROJECT_SUMMARY.md
│   ├── agents/                    GENERATED (v2): core contract + preset persona
│   │   ├── nestjs-architect.md
│   │   ├── nestjs-developer.md
│   │   ├── nestjs-reviewer.md
│   │   ├── angular-developer.md
│   │   └── angular-reviewer.md
│   ├── infrastructure/
│   │   ├── code-guidelines.md     project-owned, fork mode, never generated
│   │   └── project-structure.md
│   ├── contexts/                  never touched
│   ├── progress/                  never touched (v1) → cairn progress (v2)
│   └── tasks/GLO-42/              never touched
├── backend/                      code · optional backend/ai/code-guidelines.md
├── frontend/                     code
└── infra/                        code
```

A standalone single repo is this tree minus the package dirs, `layout: "single"`.

#### Multi-repo — `layout: "multi-repo"`

`PROJECT_FOLDER` is a plain dir. A dedicated `cairn/` repo holds coordination state;
each code repo keeps its own manifest.

```
glossr/                            PROJECT_FOLDER — plain dir, not a repo
│
├── cairn/                         dedicated coordination repo
│   ├── .git/
│   ├── workspace.json             HAND-EDITED · layout:"multi-repo", project key,
│   │                              repos[] (path + stack), tracker defaults,
│   │                              intra-project shared[], normalize
│   ├── _cairn/
│   │   ├── base/                  merge bases for every managed file, per repo
│   │   │   ├── glossr-api/.claude/commands/create-brief.md
│   │   │   └── glossr-frontend/ai/agents/angular-developer.md
│   │   ├── tracker/              local issue store · <KEY>-33.md, one file per issue
│   │   ├── context-graph.json    intra-project context graph (backend↔frontend edges)
│   │   └── doctor-cache.json      optional · last computed drift snapshot
│   └── presets/                   project-local presets until promoted
│
├── glossr-api/                    code repo — own git
│   ├── .git/
│   ├── cairn.config.json          stack:["nestjs","typeorm"], tracker, vars,
│   │                              workspace:"../cairn/workspace.json"
│   ├── _cairn/
│   │   ├── manifest.json          what cairn wrote INTO this repo + sha
│   │   └── scripts/jira.js        vendored shim
│   ├── .claude/commands/          GENERATED, committed here
│   ├── ai/
│   │   ├── agents/nestjs-*.md
│   │   ├── infrastructure/code-guidelines.md
│   │   ├── contexts/  progress/
│   │   └── tasks/GLO-33/          same issue folder also in frontend = cross-repo task
│   └── src/
│
├── glossr-frontend/              code repo — own git
│   ├── cairn.config.json          stack:"angular"
│   ├── _cairn/{manifest.json, scripts/jira.js}
│   ├── .claude/commands/
│   ├── ai/{agents/angular-*.md, infrastructure/, contexts/, tasks/GLO-33/}
│   └── src/
│
└── glossr-cli/                   code repo — own git
    ├── cairn.config.json          stack:"cli", tracker:{provider:"none"}
    ├── _cairn/manifest.json       no jira.js — no tracker
    ├── .claude/commands/          renamed stubs, folded via pathAliases
    └── ai/
```

Two `_cairn/` directories with distinct jobs: `cairn/_cairn/` holds workspace-level
state (merge bases, the local issue store, the intra-project context graph); each
`<repo>/_cairn/manifest.json` is the ground truth for what is on disk in that repo
and survives a fresh clone.

#### Hub — `projects.json`

Org-level, opt-in. `PROJECT_N/` dirs are references plus sync metadata, never copies
of project content.

```
stonepanda-hub/                    org coordination repo
├── .git/
├── projects.json                  HAND-EDITED · project list + reference paths
├── _cairn/
│   ├── manifest.json              hub's own generated state
│   └── context-graph.json         full cross-project context graph · `cairn context build`
├── normalize.json                 cross-project · jiraKey folding union, aliases
│
├── glossr/                        per-project hub metadata — NOT project content
│   ├── link.json                  reference · ../glossr/cairn/workspace.json, layout
│   ├── pins.json                  glossr tracks reviewer-contract v3, workflow v2
│   ├── policy.json                fork/link mode per artifact for glossr
│   └── sync-state.json            WRITTEN by `cairn workspace sync` · when, what
│                                  merged, conflicts. git history = audit trail
├── snap-proof/
│   └── {link.json, pins.json, policy.json, sync-state.json}
│
└── shared/                        OPTIONAL / future · versioned cross-project standards
    ├── agents/reviewer.contract.md    the 85–92%-same core contract
    └── commands/*.md
```

`shared/` is held for now: cross-project drift is computed by comparing the
referenced projects directly, or against `presets/` in the cairn package. It earns
its place only when the org wants standards versioned separately from the package.

#### Commands

| command | writes | run from |
|---|---|---|
| `cairn init` | `cairn.config.json`, `_cairn/`, the shim | a repo — monorepo root, or each code repo |
| `cairn workspace init` | `cairn/workspace.json`, `cairn/_cairn/` | `PROJECT_FOLDER` — scans siblings for `.git` |
| `cairn workspace init --meta` | hub `projects.json`, per-project dirs | org dir — scans for `workspace.json` |
| `cairn context adopt` | frontmatter links, file moves, an adopt record | a repo — one-time brownfield pass |
| `cairn context build` | `_cairn/context-graph.json` | the hub (or a `PROJECT_FOLDER` for the intra-project graph) |
| `cairn context serve` | nothing — MCP server over the graph | the hub |

### Inheritance and distribution are different products

The four requirements split cleanly, and conflating them is the main risk:

| | Inheritance | Distribution |
|---|---|---|
| Requirement | same workflow per project; shared agent presets | import/export guidelines; portable workflows across project groups |
| Question | which layer wins for this file? | where did this content come from, at what version? |
| Inputs | all local, deterministic | remote, versioned, someone else's |
| Engineering | layered config resolution at sync time | versioning, provenance, conflict resolution, a registry |
| Cairn has | the manifest, the doctor, the tiers | nothing |

Inheritance is the part worth building — nobody does it multi-repo. Distribution is
solved: when content needs to travel, **ship it as npm packages under
`@stonepandastudio`**. Versioning, install and semver come free; `cairn export
--as-package` writes the tarball, `npm i` plus one line in the extends chain is the
import. No registry code, ever.

**Decision: internal only for now.** Presets live in a `presets/` folder in this
repo. No packaging, no semver, no support obligations. Keep the folder layout
package-shaped so that promotion is adding a `package.json`, not a refactor.

The hub adds a third point between "nothing" and "npm packages": **distribution via
local file reference**. `projects.json` records which standard version each project
is pinned to and a per-artifact fork/link policy, giving provenance and an audit
trail without a publish step. Keep it to reference + pin + policy + log — no
dependency resolution, no semver ranges. If pins start needing ranges and conflict
trees, that is the signal to actually publish `@stonepandastudio` packages, not to build a
package manager inside the hub.

### Agent presets need three extension mechanisms, not one

Extension is a hard requirement, and the measurements say it is not merely
convenient — it is the only way sharing is possible at all:

```
node-reviewer.md        92% same   → share the body, fill two slots
architect-lead.md       73% same   → share the spine, replace a section
node-qa-developer.md    33% same   → share the contract only, body is local
```

No single mechanism spans 92% → 33%. Three, declared explicitly in config rather
than emerging by accident:

- **slot fill** — template declares `{{> stack.testing }}`; the repo supplies a
  string or a partial
- **section replace** — the repo swaps one named `##` block and keeps the rest
- **full override** — escape hatch; the repo owns the file and cairn stops managing it

Then **the doctor reports override usage per repo**. Heavy override on a file means
the preset is wrong, not that the repo is deviant. That feedback loop is what keeps
presets honest, and it is precisely what BMAD lacks — BMAD assumes its personas are
correct.

The loop only closes where a preset has more than one consumer, so it covers node
and angular but not cli (see the stack table above). For `preset-cli`, override
volume is a single repo's opinion rather than a signal — read it as a prompt to
look, not as evidence.

### Guidelines import: fork or link, decided per artifact

"Import guidelines" is two incompatible operations:

- **fork** — copy once, it becomes the repo's, cairn never touches it again
- **link** — stays synced, cairn rewrites it on upgrade

The answer is per-artifact, not global, and the numbers already say which:

```
code-guidelines.md   43% same   → fork. The divergence is correct (snap has no Zod).
role contracts       92% same   → link. Divergence there is rot.
```

So it belongs in config as `"mode": "fork" | "linked"` per import, with guidelines
defaulting to `fork`. Defaulting them to `linked` would report every legitimate
project difference as `MODIFIED` forever, everyone would stop reading the report,
and the tool would be dead. That is the single most likely way this fails.

### Sequencing

0. **Tracker provider — `youtrack`.** Not hypothetical: the `snap-proof` repos run a
   `task-tracker.js` dispatcher over Jira and YouTrack. `lib/tracker/youtrack.js` is
   done (ported from their `youtrack.js`, same interface, no `process.exit`);
   registry / schema / init wired. The markdown→wiki-markup audit against those
   repos' `JIRA_MARKUP.md` / `TASK_TRACKER_MARKUP.md` closed four gaps in
   `jira-server.toMarkup()` — italic, strikethrough, blockquote, pipe tables. 0.3.0,
   46 tests, awaiting publish. (`local` is *not* here — the `LOCAL-` folders in those
   repos are a pre-tracker archive, not a practice; the real driver for `local` is
   the `partOf` join key, so it lands with the context layer.)
1. **Workspace layer.** Per-project `workspace.json` — schema, a `layout` field, and
   `preset → workspace → repo` inheritance so tracker/vars stop being repeated per
   repo — plus `cairn workspace init` and `cohort: "project"` meaning the workspace
   itself. Adds three doctor checks: task span (which repos hold a folder for
   `GLO-33`), orphaned task folders (an `ai/tasks/<ID>/` with no issue in any
   tracker — the `LOCAL-*` cruft), and project-level progress rollup. Cross-project
   (`stack`) comparison stays on the current flat `repos.json` until 1b. About a
   week, useful immediately.
1b. **Hub.** `projects.json` referencing the workspaces, `cairn workspace init
   --meta`, `cohort: "stack"` computed across referenced projects, and the sync
   metadata files (pins, policy, log) as advisory-only state. Retires the flat
   `repos.json`.
2. **The context layer.** The convention (layout + frontmatter + relation
   vocabulary) as a distributable preset; `cairn context adopt` for the brownfield
   pass; `cairn context build` / `check` / `counterparts`; the `local` tracker
   provider and its index over `ai/tasks/`. This is the target — see its section.
3. **`cairn context serve`.** The MCP server over the resolver — graph + content.
4. **Agent presets + the three extension mechanisms**, and the upgrade path in the
   same step — see the merge section below. Presets that cannot be updated without
   destroying local edits are worse than no presets, so `_cairn/base/` and the 2×2
   ship together with the first preset, not after it. Shares the `cairn sync`
   machinery with the context layer but not its critical path — can run in parallel.
5. **Guidelines import/export** with fork/link modes. Not before 4 has survived a
   sprint.
6. **Portable workflows between project groups.** A quarter, and only once 4 and 5
   are stable.

Nothing starts before v1 has run across the repos.

### The standing risk

**Requirements 2 and 4 together are BMAD.** Shared agent presets plus portable
workflows is exactly their product, with far more iteration behind it. What keeps
this differentiated is, first, the cross-repo context layer — nobody builds it — and
then requirements 1 and 3: project-level inheritance across repos, and guidelines
with fork semantics. None exists in BMAD or Spec Kit. If the build drifts toward
"our own persona library", it has picked the fight it cannot win.

## Upgrades: merging incoming template changes with local edits

The question that decides whether any of the above survives contact with the five
repos. A preset's Node.js developer template gets updated; each repo has its own
edits; something has to reconcile them without destroying either side.

### The authoring loop

The mechanism below is what runs; this is the loop a maintainer actually performs.
The trigger is almost always the same: mid-project, an agent behaves wrong or a
guideline needs a line changed, and the fix is made *in the repo that surfaced it*.

**v1 — cairn reports, `git` propagates.** There is no renderer. Agent docs, command
stubs and `WORKFLOW.md` are hand-maintained copies. The loop:

1. Edit the file in the repo you are in.
2. Decide repo-specific or shared (see the routing table). Repo-specific: done —
   it is tier 3, cairn never looks at it.
3. Shared: copy the change to the other repos by hand.
4. `cairn doctor` from the workspace → `DRIFT` / `COSMETIC` / `STRANDED` shows what
   is now out of sync; `cairn doctor --diff <path>` shows the hunks.
5. Park the canonical version in `presets/` so there is one reference copy, even
   though nothing renders from it yet.

v1 gives visibility, not propagation. This is deliberate — see "v1 scope".

**v2 — `cairn sync` propagates.** Once the renderer, `_cairn/base/` and `cairn sync`
exist:

1. Edit the source — `presets/nestjs/agents/developer.md`, or a project-local
   `cairn/presets/` copy.
2. Commit. The consuming repos do not move yet: each pins a version, and the pin is
   bumped explicitly. Nothing re-renders on `npm update`, so a prompt change never
   lands mid-sprint by surprise.
3. Bump the pin, then `cairn sync` in each repo — or `cairn workspace sync` from the
   hub to walk all of them.
4. `cairn sync` runs the 2×2 per file (below). Three cells are automatic; only a
   hand-edited `linked` file whose template also moved stops for a human.
5. Commit the re-rendered files. They are committed, not gitignored, so the prompt
   change shows up in `git diff` like any other.
6. `cairn doctor` → everything `MANAGED`, no `CONFLICT`.

### Routing: where an edit goes

The actual skill. Getting this wrong is what produces tier-3 leakage, so it is a
decision made per edit, not per file:

| the change is true for… | it goes in |
|---|---|
| every repo on this stack | preset body |
| the stack, but one decision varies | preset **slot** + a variant in `variants/` |
| one project's repos | `workspace.json` override, or a section-replace |
| one repo only | repo `cairn.config.json` slot fill, or **fork** the file |

`cairn doctor` reports override usage per repo (v2). Heavy override on a file means
the preset is wrong, not that the repo is deviant — that is the feedback loop that
keeps presets honest, and the routing table is only a first guess against it.

### The manifest is already the merge base

Three-way merge needs base, ours, theirs. The manifest records what cairn *wrote*,
which is precisely the base:

```
base    what cairn wrote last time       (manifest)
ours    what is on disk now              (the repo's edits)
theirs  what the updated template renders
```

One gap: the manifest stores the hash, not the content, and merging needs bytes. So
store them, in `_cairn/base/`. These are kilobytes of markdown and it is the only
option that survives a fresh clone — recovering base from git history works right up
until someone squashes.

### The upgrade algorithm is a 2×2

| | template unchanged | template changed |
|---|---|---|
| **local unchanged** | no-op | **fast-forward** — write the new render |
| **local changed** | keep local, report `MODIFIED` | **conflict** — merge |

Three of the four cells are automatic. That is the whole answer to "I don't want to
sync manually anymore": only the bottom-right cell needs a human. The existing
`MANAGED` / `MODIFIED` / `OUTDATED` states are this matrix with the fourth cell
missing; `CONFLICT` becomes the fifth doctor state.

### Most updates must never reach the merge

How often the conflict cell is hit is determined by the extension mechanism, which
is the real reason those three exist:

| Mechanism | On template update |
|---|---|
| slot fill | no merge, ever — template changes, slots re-fill, deterministic |
| section replace | merge only if the template touched *that named section* |
| full override | no merge; the repo owns it, report `OUTDATED`, human decides |
| hand-edit of a `linked` file | the only true conflict |

The merge machinery therefore exists to handle the case the doctor already flags as
the thing that should not be happening. Design accordingly: make it correct rather
than fast, and treat frequent conflicts on a file as evidence that a slot is
missing from the template, not that the repo is misbehaving.

This is also why `fork` versus `link` matters: forked files never merge at all.

### Merge at section level, not line level

The agent docs are structured markdown — `## When to stop and ask`, `## Reference`.
Treat a document as an ordered map of sections rather than a line sequence:

- upstream changed a section, local did not → take upstream
- local changed it, upstream did not → keep local
- both changed → conflict, **scoped to that section alone**
- upstream added a section → insert, positioned relative to its neighbours
- upstream deleted a section the repo had modified → conflict, ask

Line-level `diff3` on a 400-line agent doc yields conflicts spanning unrelated
prose. Section-level conflicts are readable and usually resolvable in seconds.

The sophisticated version is per-section provenance: record in the manifest which
sections came from the template and which the repo authored, the way Kubernetes
server-side apply tracks field managers. Most merges then reduce to a lookup.

### Do not write the merge algorithm

For the conflict cell, shell out:

```
git merge-file --diff3 -L ours -L base -L theirs \
  ai/agents/node-developer.md \
  _cairn/base/ai/agents/node-developer.md \
  <rendered-new>
```

Standard conflict markers — a format every developer and every agent already reads.
Exit non-zero, mark the file, stop.

**Never silently overwrite.** That is the failure that makes people permanently
distrust generated files, and it cannot be walked back once it has happened once.

For the interactive case, Debian's conffile handling has the proven UX: keep /
replace / show diff / drop to a shell. Thirty years of production says those four
options suffice.

### Prior art to read first

- **[copier](https://copier.readthedocs.io/)** — the closest existing tool. Project
  templates with real update support, a `.copier-answers.yml` recording what was
  rendered, three-way merges on upgrade. It has already made most of these
  decisions; read it before designing ours.
- **[cruft](https://cruft.github.io/cruft/)** — cookiecutter plus update. Same
  problem, simpler model.
- **React Native's `rn-diff-purge`** — publishes version-to-version diffs so
  consumers apply a patch rather than re-rendering. Relevant if presets are ever
  versioned.
- **Kubernetes server-side apply** — field ownership as a first-class concept; the
  model behind per-section provenance.

### What to build

1. Store base content in `_cairn/base/`. Small change, unlocks everything else.
2. Implement the 2×2 in `cairn sync`. Three cells automatic, one stops.
3. Conflicts via `git merge-file`, markers left in place, non-zero exit, `CONFLICT`
   as a fifth doctor state.
4. Section-aware merge **only if** line-level proves too noisy in practice. Do not
   build it speculatively.

The measurable goal: after a preset update, how many of the five repos need human
attention? Routinely more than one means the preset is wrong. That number is worth
reporting explicitly — it is the health metric for the whole idea.

## The cross-repo context layer

Reframed 2026-09-09. This was filed as a deferred v3 idea. It is the actual target —
the one thing in the space with no prior art. Everything shipped so far is substrate:
the tracker is the spine cross-repo links hang on, the doctor's normalize/diff engine
is the "declared vs actual" machinery, the workspace layer is the container. None of
those was the point.

### The landscape is fragmented

Modelling the links, plans, docs and contexts spanning repos lands in six different
prior-art buckets, and nothing covers all six:

| Layer | What exists | Maturity |
|---|---|---|
| Repo graph, code-derived | Riftmap (parsers across 12 ecosystems, `/impact` API), Sourcegraph MCP, GitLab Orbit (property graph of symbols + SDLC objects over MCP), `repo-graph`, `mcp-context-graph`, `codebase-memory-mcp` | crowded, solved |
| Declared entity relations | Backstage catalog — `catalog-info.yaml` per repo, typed relations (`dependsOn`, `providesApi`, `consumesApi`, `partOf`), TechDocs for cross-repo docs. Port / Roadie / Cortex commercially | mature, heavyweight |
| Monorepo graph for agents | Nx project graph + Nx MCP — best in class, monorepo only | mature, wrong shape |
| Repo fan-out / manifest | Google `repo` + `manifest.xml`, `meta`, `garden`, `mu-repo`, `gita`, `myrepos` | old, dumb, durable |
| Cross-repo contract | OpenAPI + generators, Buf Schema Registry, Pact, GraphQL federation | mature |
| Cross-repo plans | **Jira already does this** — parent issue, subtasks in different repos | already in place |
| Cross-repo *authored* docs and contexts | — | **nothing** |

Every row but the last has mature prior art. `ai/contexts/entities/invoice.md` exists
in the backend repo *and* the frontend repo, describing the same entity from two
sides. No parser derives that. Backstage does not model prose. Riftmap models
imports, not intent. Spec Kit and BMAD are single-repo. **That last row is the
target.**

### Why it will drift, and why cairn is the tool for it

Riftmap's own writeup names the failure mode: Mabl hand-maintains an 850-line "Repo
Coordination Graph" across 79 repos, and *manual registries decay without dedicated
maintenance*. That is exactly what happened to the `ai/` folders. Any declared
cross-repo link layer drifts the same way — and drift detection on
declared-versus-actual is the one thing cairn already does.

```
cairn today   does ai/AGENTS.md still agree across repos?
cairn next    does the backend's invoice.md still point at a real frontend counterpart?
              does the entity a context describes still exist in the API contract?
```

### The convention is enforced, not discovered

cairn defines the context layout — `ai/contexts/entities/<name>.md`,
`ai/contexts/features/<name>.md`, the required frontmatter fields, the relation
vocabulary. This lives in a preset, is versioned, and distributes via `cairn sync`
like any other template. Consequence: `ai/contexts/` leaves tier 3. The *content* of
`invoice.md` stays project-owned; its *path, frontmatter schema and counterpart
declaration* become cairn-managed — call it tier 2.5. A doc that genuinely does not
fit is marked `unmanaged` and cairn ignores its structure.

### Learning the links — declared, with a suggest pass (Q1)

Intent cannot be derived: only a human knows the backend and frontend `invoice.md`
are counterparts, and `waitlist-signup.md` ↔ `waitlist-frontend.md` share neither
name nor text. So the relation is **declared**, in the frontmatter of one side;
cairn infers the reverse edge.

Pure declared decays (the Mabl case). So cairn runs a **suggest pass** — identical
filename on the same relative path in two repos, an entity name appearing in two
repos' contexts, a tracker issue with task folders in two repos — surfacing each as
`CANDIDATE`: reported, never auto-linked, same shelf as `STRANDED`. A false
candidate is silenced once with `notCounterpartOf` or an ignore entry.

**`cairn context adopt`** — a one-time interactive brownfield pass per repo,
`--dry-run` first. Per off-convention file: move / rename / mark unmanaged / skip.
Per inferred pair: confirm / reject / not-a-counterpart. Per path collision: pick the
winner. Per orphaned task folder (an `ai/tasks/<ID>/` with no issue in any tracker —
the `LOCAL-*` cruft): **archive** (default — move to `ai/tasks/archive/`) / adopt
into the `local` store / relink to a real issue. UX is Debian conffile — keep /
rename / show diff / shell / skip. Decisions are recorded so a re-run does not
re-ask; `--report` is the non-interactive form. cairn never migrates automatically.

### What "drift" means for prose (Q2)

Not textual similarity — counterparts are *not* copies; the two `invoice.md` are
near-0% alike and correctly so. Drift is **referential integrity** against the
convention and the declared links:

| finding | |
|---|---|
| `OFF_CONVENTION` | file in `ai/contexts/` not matching the layout |
| `DANGLING` | `counterpartOf` / `describes` points at a path that is gone |
| `MISSING_FRONTMATTER` | a required field is absent |
| `BROKEN_ANCHOR` | `describes: entity Invoice` and no source confirms `Invoice` — `unknown` when no source is wired |
| `CONTENT_MISMATCH` | the shape a context claims disagrees with its counterpart or the API contract |
| `TRACKER_DESYNC` | `partOf ISSUE` where the issue is closed or its folders were removed in one repo |
| `CANDIDATE` | a plausible counterpart with no declared link |

`cairn context check` **never fails CI** — always exits 0. Prose integrity is fuzzy;
false positives would train everyone to ignore it, the way `INITIAL_PROMPT.md` as
permanent drift would. The pressure to fix moves off the CI gate: a broken link
shows up as `unavailable` / `unknown` in what the MCP server hands the agent, so the
agent visibly answers worse and the report says why. Dropped: any mtime/hash
staleness heuristic for an "asymmetric pair" — too noisy.

### Serve it — CLI first, MCP second (Q3)

1. **`cairn context`** — no server. `build` resolves all frontmatter into a graph;
   `counterparts <file>`, `check`, `adopt`, `--json`. Resolver and checks are
   testable without a protocol and useful in the manual loop immediately.
2. **`cairn context serve`** — an MCP server over the same resolver, part of
   `@stonepandastudio/cairn`, not a separate package. MCP stdio is newline-delimited
   JSON-RPC — about a hundred lines by hand, so the zero-dependency stance holds; do
   not pull the MCP SDK.

The server returns **graph + content**: asked for the counterpart of `invoice.md` it
hands back the edge *and* the resolved counterpart doc, so the agent never opens a
file in a repo it may not have checked out. No checkout → the edge is returned,
content is `unavailable`. Generated context files in every repo are rejected — they
stale between syncs, duplicate into each repo, and the agent hits the "do not edit"
header when it wants to change one.

### The index lives in the hub

`cairn context build` runs from the hub and writes
`stonepanda-hub/_cairn/context-graph.json`. Issue state is snapshotted into the graph
at build time so the server does not call Jira per query. Without the hub,
`cairn context` still works on the intra-project graph in `cairn/_cairn/` — the
backend↔frontend edges inside one project do not need the hub; the full
cross-project graph does. Counterpart content resolves live from the referenced repo
checkouts (the hub machine holds them all); caching content into the index is a
later option for detached use.

### The boundary (Q4)

**cairn owns:**

- authored prose relations in `ai/contexts/`
- the tracker spine — now literally, see the local provider below, not contingent on Jira
- the workspace container
- **OpenAPI schema-existence and shape checks.** A contract file is a declared
  artifact, not a running system or an AST. cairn parses the spec and checks that a
  named schema exists and that the fields a frontend context claims are present.
  This is the single highest-value edge — backend produces, frontend consumes — and
  deliberately narrow: not full contract conformance, which is Pact's job.

**cairn delegates:**

- code-symbol facts ("does `Invoice` still exist as a type") → an optional MCP
  `codeSource` configured in `workspace.json`. Wired → cairn queries it; not wired →
  the check is `unknown`, with a hint. **No code parser ships with cairn, ever** —
  drifting toward one is the fight cairn cannot win (see "the standing risk").

**cairn does not emit:**

- a Backstage `catalog-info.yaml` or a service graph. Backstage models services, not
  docs, and emitting it would pull cairn toward being a catalogue. A one-way
  `cairn context export --format backstage` is a possible bridge later, not an output
  now.

Hard line: cairn reads `ai/`, the tracker store, and declared spec files. Running
systems and source code are delegated or `unknown`.

### The tracker becomes a choice of provider

The `snap-proof` repos already hand-built this: `ai/scripts/task-tracker.js` — "a
unified client that dispatches to Jira or YouTrack based on `TASK_TRACKER`". Three
copied clients (`jira.js`, `youtrack.js`, `task-tracker.js`) doing what cairn's
registry already does. Those repos are migrating *off* Jira onto YouTrack —
`jira-server` stays a provider because other projects still use it. The point is a
per-repo choice, not one blessed tracker.

So the roster grows to four peer providers, selected by `tracker.provider` in
`cairn.config.json`, all on the same `Tracker` interface so every `cairn tracker`
command is provider-agnostic:

| provider | |
|---|---|
| `jira-server` | shipped in v1. Basic auth, Jira Server 8.5.1, Task/Sub-task types, wiki markup |
| `youtrack` | port of the repos' `youtrack.js` — step 0, ships 0.3.0 |
| `local` | file-backed store, below — lands with the context layer |
| `none` | every command a successful no-op |

**YouTrack differs from Jira in three ways the port must absorb:** no Task/Sub-task
type hierarchy — a sub-issue is a plain issue joined by a `Subtask` link; status is a
`Stage` bundle field, not a transition graph; and the description is markdown-native,
so `youtrack`'s `toMarkup()` is a passthrough. cairn's `issueTypes` config becomes
Jira-only; `statuses` still maps. The Jira wiki-markup rules stay the interesting
half of `toMarkup()` — `ai/JIRA_MARKUP.md` and `ai/TASK_TRACKER_MARKUP.md` in those
repos are its spec, worth diffing against the current implementation.

`task-tracker.js`'s `TASK_TRACKER` env var *is* `tracker.provider`. When cairn adopts
these repos the shim replaces all three clients — `task-tracker.js`, `jira.js`,
`youtrack.js` — and the `.claude/commands/` `youtrack-*` / `jira` / `task-*` split
collapses into one provider-agnostic stub set.

#### The `local` provider

A real store, not a no-op. **Its driver is not the `LOCAL-*` folders** in the
`snap-proof` repos — those are a pre-tracker archive (`LOCAL-201..217`, dated
2025/12–2026/05, mostly under `tasks/archive/YYYY/MM/`, a per-repo namespace),
caught by the "orphaned task folders" doctor check, not a practice to preserve.
`local` exists because `partOf <issue>` in the context layer needs *some* issue
store when a repo has no remote tracker, and because local-only tracking is a stated
need for some future repo. It therefore lands with the context layer, not in step 0.

- **Where:** workspace level, `cairn/_cairn/tracker/` — one ID namespace per project,
  mirroring "one Jira project key per project".
- **Shape:** one file per issue, `cairn/_cairn/tracker/<KEY>-33.md`, frontmatter
  (`status` / `type` / `parent` / `spans`), body is the description. Diffable,
  greppable, committed. Written through `cairn tracker`; hand-editing is tolerated,
  like `commit --amend`.
- **Relation to `ai/tasks/`:** the `ai/tasks/<ISSUE>/` folders stay project-owned.
  The local store is an **index over them** — status, type, parent, which repos hold
  a folder. Not a parallel store. The remote providers keep the same index and mirror
  to Jira / YouTrack as well.
- **`TRACKER_DESYNC` splits by provider:** `local` — cairn owns store and folders, so
  it keeps them consistent and a break degrades to `DANGLING`. `jira-server` /
  `youtrack` — a delegated check that tolerates `unknown` on API failure.
- **Migration:** `cairn tracker export` / `import` moves open issues between providers
  when a remote is gained or lost. Not the first cut, but the interface allows it.

### Prior art still to read

- Backstage well-known relations — the typed-relation vocabulary, at service
  granularity; cairn wants the same idea at document granularity.
- Kubernetes server-side apply — field ownership, the model behind "which side
  declared this edge" and behind per-section provenance.
- copier / cruft — update semantics for the convention-distribution half.

Sources: [Riftmap on cross-repo context](https://riftmap.dev/blog/ai-coding-agents-need-cross-repo-context/) ·
[Sourcegraph MCP](https://sourcegraph.com/mcp) ·
[Backstage well-known relations](https://backstage.io/docs/features/software-catalog/well-known-relations/) ·
[Nx: enhance your AI coding agent](https://nx.dev/docs/features/enhance-ai) ·
[mcp-context-graph](https://github.com/padobrik/mcp-context-graph) ·
[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)

## Open questions

- **Build the v2 renderer, or wrap BMAD / Spec Kit?** See the prior-art section.
  Deferred until v1 has run across the five repos for a sprint.
- ~~**Does `cohort: "project"` replace `cohort: "stack"` or join it?**~~ Resolved by
  the workspace/hub split: `cohort: "project"` *is* the per-project `workspace.json`
  and runs in that project's CI; `cohort: "stack"` is cross-project and runs from the
  hub. Different tiers, not competing axes.
- **Where does `workspace.json` physically live, and how portable are its paths?**
  A dedicated `glossr/cairn/` repo for multi-repo, git root for monorepo — but the
  `repos[]` paths still assume a sibling-directory checkout layout. Needs a
  configurable path map with sibling as the default; not designed yet.
- **Are the hub's `PROJECT_N/` dirs reference-only, or do they cache?** Reference
  for now — the hub needs every project on disk to do anything. A `cairn workspace
  sync` that vendors normalized snapshots for offline analysis is possible later.
- **When do presets leave this repo?** Internal `presets/` folder for now. The
  trigger for packaging them is a third organisation needing them, not a third
  project.
- **The relation vocabulary — final set?** Start with `counterpartOf` and
  `describes`; add `consumes` / `partOf` when a real case needs them. Resist a large
  ontology. Not fixed.
- **Where does the context convention live — core or its own preset?** Leaning its
  own `presets/context/` so a project can adopt the context layer without taking a
  stack persona set. Not decided.
- **OpenAPI: which spec versions, and one contract per project or several?** The
  check needs a resolver for `$ref` and a way to name "the contract for this edge".
  Unspecified.
- **`codeSource` MCP — a concrete first integration, or interface-only?** Ship the
  `workspace.json` hook and leave every code anchor `unknown` until someone wires
  Sourcegraph or Riftmap. First real integration is not scheduled.
- Rename the working directory `D:/projects/ai-kit` → `cairn`? Git remote and
  `.idea/` implications; not done.
- Run `cairn init` against the five real repos — deletes 237 lines from each and
  rewrites `ai/scripts/jira.js`. Not done without explicit go-ahead. `--dry-run`
  first.
- Claim the `@stonepandastudio` npm org (matches the GitHub org `StonePandaStudio`).
  Verify with `npm org ls stonepandastudio` while logged in; `npm org create` if absent.
- `.claude/agents/` native subagents vs `ai/agents/*.md` docs — currently the docs;
  worth revisiting when presets land.
