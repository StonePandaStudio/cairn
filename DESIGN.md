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

## Open questions

- **Build the v2 renderer, or wrap BMAD / Spec Kit?** See the prior-art section.
  Deferred until v1 has run across the five repos for a sprint.
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
