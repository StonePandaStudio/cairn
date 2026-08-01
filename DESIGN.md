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
core (role contracts, tracker)
  └─ preset-node / preset-angular / preset-cli   (persona bodies, guideline seeds)
       └─ project (workflow, tracker config, repo set)
            └─ repo config (vars, slot fills, overrides)
```

Evidence it works: reviewer contracts 85–92% same across stacks. Evidence of the
limit: qa-developer 33% same — that one is preset-level, not core.

The project layer between preset and repo was added after the fact; see the
multi-repo roadmap below for why it is not optional. Presets stay an in-repo
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

The workspace is flat today — five repos, cohorts by stack. Reality has a level in
between: a **project** is a set of repos.

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

- `cohort: "stack"` → a backend pair, a frontend pair, and **cli alone**
- `cohort: "project"` → snap-proof with 2 repos, glossr with 3

The empty cell has a consequence worth stating plainly, because it limits what the
doctor can promise. `glossr-cli` is a stack of one, so it never forms a stack
cohort — the analyzer skips groups with fewer than two members, which is why no
`stack:cli` section appears in the output. Its only cross-repo comparison is
project-level, against a backend and a frontend, where agent-doc similarity is
meaningless.

**So `preset-cli` has no peer and cannot be validated by comparison.** `preset-node`
and `preset-angular` each get checked against a second repo; the cli preset will
only ever be validated by hand, or by a second CLI repo appearing. Any claim that
"the doctor validates the presets" is true for two of three.

### The resolution chain

Everything below is detail on this order:

```
@stonepanda/cairn                     engine
  presets/node | angular | cli        content — an in-repo folder, package-shaped
      ↓ extends
  workspace projects[]                glossr, snap-proof — workflow + tracker live here
      ↓ extends
  repo cairn.config.json              vars, slot fills, overrides
      ↓ renders
  .claude/commands/, ai/agents/       generated + manifested
  ai/contexts, ai/progress, ai/tasks  never touched
```

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
`@stonepanda`**. Versioning, install and semver come free; `cairn export
--as-package` writes the tarball, `npm i` plus one line in the extends chain is the
import. No registry code, ever.

**Decision: internal only for now.** Presets live in a `presets/` folder in this
repo. No packaging, no semver, no support obligations. Keep the folder layout
package-shaped so that promotion is adding a `package.json`, not a refactor.

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

1. **Projects layer.** `projects[]` in the workspace, tracker config inherited
   instead of repeated per repo, `cohort: "project"` as a third comparison axis
   alongside `all` and `stack`. Both axes earn their keep: role contracts want
   stack, shared entities and conventions want project. Adds three doctor checks —
   task span (which repos hold a folder for `GLO-33`), orphaned local tasks, and
   project-level progress rollup. About a week, useful immediately.
2. **Agent presets + the three extension mechanisms**, and the upgrade path in the
   same step — see the merge section below. Presets that cannot be updated without
   destroying local edits are worse than no presets, so `_cairn/base/` and the 2×2
   ship together with the first preset, not after it. The real work.
3. **Guidelines import/export** with fork/link modes. Not before 2 has survived a
   sprint.
4. **Portable workflows between project groups.** A quarter, and only once 2 and 3
   are stable.

Nothing starts before v1 has run across the five repos.

### The standing risk

**Requirements 2 and 4 together are BMAD.** Shared agent presets plus portable
workflows is exactly their product, with far more iteration behind it. What keeps
this differentiated is requirements 1 and 3 — project-level inheritance across
repos, and guidelines with fork semantics. Neither exists in BMAD or Spec Kit. If
the build drifts toward "our own persona library", it has picked the fight it
cannot win.

## Upgrades: merging incoming template changes with local edits

The question that decides whether any of the above survives contact with the five
repos. A preset's Node.js developer template gets updated; each repo has its own
edits; something has to reconcile them without destroying either side.

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

## Deferred: the cross-repo context graph

Surveyed 2026-07-31, before the projects layer was identified as the near-term
shape. Kept because the research stands and this is what the projects layer grows
into if it starts to strain.

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

### The gap is narrower than it first looks

Three of the four parts have prior art worth consuming rather than rebuilding:

- **Links (code)** — Riftmap or Sourcegraph. Derived data: cheap to buy, expensive
  to maintain.
- **Plans** — the tracker, once the projects layer exists. The cross-repo join key
  already exists and cairn already abstracts it.
- **Contracts** — OpenAPI between `glossr-api` and `glossr-frontend`.

What is genuinely unserved is the **authored** layer.
`ai/contexts/entities/invoice.md` exists in `glossr-api` *and* in
`glossr-frontend`, describing the same entity from two sides. No parser can derive
that. Backstage does not model prose. Riftmap models imports, not intent. Spec Kit
and BMAD are single-repo.

### Why this is not a random pivot

Riftmap's own writeup names the failure mode: Mabl hand-maintains an 850-line
"Repo Coordination Graph" across 79 repos, and the stated gap is that *manual
registries decay without dedicated maintenance*.

That is precisely what happened to our `ai/` folders. Any declared cross-repo link
layer will drift the same way — and drift detection on declared-versus-actual is
the one thing cairn already does. Same machinery, new artifact:

```
cairn today   does ai/AGENTS.md still agree across five repos?
cairn next    does glossr-api's invoice.md still agree with glossr-frontend's?
              does the entity a backend context describes still exist in the API contract?
```

### If it gets built

- **Do not build a code graph.** Point at Sourcegraph or Riftmap over MCP.
- **Do model declared doc-level relations.** Steal Backstage's typed-relation idea
  but at document granularity rather than service granularity: `counterpartOf`,
  `describedBy`, `consumedBy`. Small vocabulary, declared in `cairn.config.json` or
  in per-doc frontmatter.
- **Use the tracker as the spine.** A `PROOF-217` spanning two repos is the natural
  join. Nothing in the landscape connects an issue tracker to prose contexts across
  repos.
- **Serve it over MCP, not as generated files.** Where the field converged in 2026,
  and it sidesteps the "generated files fight the agent" risk listed above.

Sequencing: this is downstream of the entire roadmap above, not an alternative to
it. The projects layer answers most of what it would answer, with a config array
instead of a graph database.

Sources: [Riftmap on cross-repo context](https://riftmap.dev/blog/ai-coding-agents-need-cross-repo-context/) ·
[Sourcegraph MCP](https://sourcegraph.com/mcp) ·
[Backstage well-known relations](https://backstage.io/docs/features/software-catalog/well-known-relations/) ·
[Nx: enhance your AI coding agent](https://nx.dev/docs/features/enhance-ai) ·
[mcp-context-graph](https://github.com/padobrik/mcp-context-graph) ·
[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)

## Open questions

- **Build the v2 renderer, or wrap BMAD / Spec Kit?** See the prior-art section.
  Deferred until v1 has run across the five repos for a sprint.
- **Does `cohort: "project"` replace `cohort: "stack"` or join it?** Provisionally
  join — role contracts want stack, shared entities want project — but that is
  asserted, not measured. Measure it once `projects[]` exists.
- **When do presets leave this repo?** Internal `presets/` folder for now. The
  trigger for packaging them is a third organisation needing them, not a third
  project.
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
