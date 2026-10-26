# Task Workflow

A task lives in `ai/tasks/[KEY]/` as a set of step files:

| File | Written by |
|---|---|
| `brief-step-[N].md` | you — the raw ask, never modified after creation |
| `description-step-[N].md` | NestjsArchitectAgent (Mode A) — the enriched brief |
| `plan-step-[N].md` | NestjsArchitectAgent (Mode B) — the implementation plan |
| `review-step-[N].md` | NestjsReviewerAgent — overwritten on each re-review |
| `test-plan-[target].md` | NestjsQAArchitectAgent — only for the QA pipeline on existing code |
`[KEY]` is the task folder name. Speculative or un-tracked work uses a `LOCAL-`
prefix so a folder name can never collide with a real issue key.

## Sync to YouTrack

`ai/tasks/[KEY]/` mirrors to the `CI` project. The folder name
is the parent issue key; each step's issue key is stamped into the first line
of its `brief-step-[N].md`:

```
<!-- youtrack-subtask: CI-4 -->
```

**Step 1 is the parent issue itself** — its marker carries the folder key, and a
one-step task is one issue. From step 2 on, each step gets a child issue under the
parent and its marker carries the child's key. Nothing is split off or moved when a
task grows a second step: the parent keeps step 1's history and stays step 1's issue,
and `brief-step-1.md`'s marker is never rewritten.

A marker equal to the folder key means the step's issue *is* the parent: do that
step's tracker actions once, on that one issue — no summary to append to the parent,
no second stage move.

Child keys are project-sequential, not per-parent — a parent and child with
unrelated numbers is normal. The parent link is the tracker's own link, not the key.

**In scope:** a folder starting `CI-` whose step file carries
`youtrack-subtask` frontmatter. **Not in scope:** a `LOCAL-` folder — work
it locally, mention that once, never sync it.

### Epics and public refs

Every issue has two names. The **tracker key** (`CI-79`) is what the
folder name, the markers and every API call use. The **public ref** shows where the issue
sits:

| Ref | Means |
|---|---|
| `CI-E1` | epic 1 |
| `CI-1-4` | story 4 of epic 1 |
| `CI-1-4.2` | step 2 of that story (step 1 is the story itself, so `…-1-4.1` is `…-1-4`) |

Every `npx cairn tracker` command and every workflow command accepts either form. A new
issue's ref is printed on stderr (`public ref: …`).

- **The folder and the marker stay the tracker key.** `ai/tasks/CI-79/`,
  never `…-1-4`. A step ref in a command resolves to its story's folder plus a step number.
- **Step 2+ keeps its number.** Create the child with
  `npx cairn tracker create-step <story key or ref> "<title>" <brief path> --step <N>` so
  the ref's `.N` matches `brief-step-<N>.md`.
- **A story in an epic** is created with `--epic <epic key or ref>`. An epic is tracker-only:
  no folder, no step files.
- **Refs never change.** A story moved to another epic keeps its ref; an issue that predates
  `publicRefs` has none.

### Sync points (one-way: local → tracker)

| Command | Tracker actions |
|---|---|
| `create_brief(task, step)` | step 1: create the parent issue if new and use it as the step's issue, no child; step 2+: create a child issue under the parent (short description, see below); write the step's issue key into the brief frontmatter |
| `enrich_description(task, step)` | the step's issue description ← a short digest of the enriched description, never the file (see below); for a child issue, also a 1–2 sentence summary appended to the parent |
| `plan_task(task, step)` | the step's issue (and its parent, for a child issue) → in-progress stage; nothing from the plan is posted |
| `execute_plan(task, step)` | no sync |
| `code_review(task, step)` | no sync — later stage moves are manual |

### What goes to the tracker

The tracker is an index for people scanning a board. `ai/tasks/[KEY]/` is the source
of truth, and the sync is one-way, so a pasted copy of a step file goes stale the
moment the file is edited. Post a digest, never the file:

- **`create_brief`** — the step's issue (the parent for step 1, a child from step 2)
  gets the title, 2–3 sentences of what and why, and the brief's path
  (`ai/tasks/[KEY]/brief-step-[N].md`). The first time a child is created for a task
  whose step 1 sits on the parent, append one line to the parent: it tracks step 1 and
  steps 2+ are its sub-issues.
- **`enrich_description`** — under about 600 characters: a 1–3 sentence outcome, at most
  5 one-line key decisions, and the path `ai/tasks/[KEY]/description-step-[N].md` as the
  last line. No tables, no file lists, no code, no implementation steps.
- **`plan_task`** — the stage move only. Nothing from the plan is posted.

Later stage moves are manual — the tracker UI,
`/youtrack-status`, or `npx cairn tracker close` (closes the parent and
every subtask together). Assignee changes: `/youtrack-assign`. Both
commands are manual-trigger only, never called by a workflow step.

Everything goes through `npx cairn tracker <command> …` — `cairn` is a
devDependency, not a global install, so `npx` (or `node_modules/.bin/cairn`) is
what actually resolves it; a bare `cairn tracker …` only works if something else
put it on `PATH`. `_cairn/scripts/jira.js` is the same client vendored into the
repo (every `cairn init` writes it, regardless of provider — the filename is
historical, it dispatches on this repo's actual `tracker.provider`) and works
identically; a legacy `ai/scripts/*.js` shim, if this repo has one from before it
adopted cairn, is a third equivalent path — but that one is **not** guaranteed to
exist here, only files `cairn init` actually found and replaced are. Credentials
live in `.env` (gitignored).
