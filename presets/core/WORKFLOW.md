# Task Workflow

<!-- cairn preset: core. Rendered from workflow.steps[] + the repo's tracker config.
     With a remote tracker (jira-server / youtrack) the sync half renders; with
     `tracker: none` only the local half does. Project-specific bits (a retrofit
     procedure for pre-sync tasks, say) stay in the repo, outside this file. -->

A task lives in `ai/tasks/[KEY]/` as a set of step files:

| File | Written by |
|---|---|
| `brief-step-[N].md` | you — the raw ask, never modified after creation |
| `description-step-[N].md` | {{ architectAgent }} (Mode A) — the enriched brief |
| `plan-step-[N].md` | {{ architectAgent }} (Mode B) — the implementation plan |
| `review-step-[N].md` | {{ reviewerAgent }} — overwritten on each re-review |
{{#if qa}}| `test-plan-[target].md` | {{ qaArchitectAgent }} — only for the QA pipeline on existing code |
{{/if}}
`[KEY]` is the task folder name. Speculative or un-tracked work uses a `LOCAL-`
prefix so a folder name can never collide with a real issue key.

{{#if tracker.remote}}
## Sync to {{ tracker.providerLabel }}

`ai/tasks/[KEY]/` mirrors to the `{{ tracker.exampleKey }}` project. The folder name
is the parent issue key; each step's issue key is stamped into the first line
of its `brief-step-[N].md`:

```
<!-- {{ tracker.subtaskMarker }}: {{ tracker.exampleKey }}-4 -->
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

**In scope:** a folder starting `{{ tracker.exampleKey }}-` whose step file carries
`{{ tracker.subtaskMarker }}` frontmatter. **Not in scope:** a `LOCAL-` folder — work
it locally, mention that once, never sync it.

{{#if tracker.publicRefs}}
### Epics and public refs

Every issue has two names. The **tracker key** (`{{ tracker.exampleKey }}-79`) is what the
folder name, the markers and every API call use. The **public ref** shows where the issue
sits:

| Ref | Means |
|---|---|
| `{{ tracker.exampleKey }}-E1` | epic 1 |
| `{{ tracker.exampleKey }}-1-4` | story 4 of epic 1 |
| `{{ tracker.exampleKey }}-1-4.2` | step 2 of that story (step 1 is the story itself, so `…-1-4.1` is `…-1-4`) |

Every `npx cairn tracker` command and every workflow command accepts either form. A new
issue's ref is printed on stderr (`public ref: …`).

- **The folder and the marker stay the tracker key.** `ai/tasks/{{ tracker.exampleKey }}-79/`,
  never `…-1-4`. A step ref in a command resolves to its story's folder plus a step number.
- **Step 2+ keeps its number.** Create the child with
  `npx cairn tracker create-step <story key or ref> "<title>" <brief path> --step <N>` so
  the ref's `.N` matches `brief-step-<N>.md`.
- **A story in an epic** is created with `--epic <epic key or ref>`. An epic is tracker-only:
  no folder, no step files.
- **Refs never change.** A story moved to another epic keeps its ref; an issue that predates
  `publicRefs` has none.

### Sync points (one-way: local → tracker)
{{else}}
### Sync points (one-way: local → tracker)
{{/if}}

| Command | Tracker actions |
|---|---|
{{#each workflow.steps}}
| `{{ this.fn }}(task, step)` | {{ this.trackerAction }} |
{{/each}}

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
{{#if workspace}}
- **Exception: `/request-change`.** The receiving repo has no local copy of the request,
  so its issue carries the full What / Why / Acceptance. Keep them tight anyway.
{{/if}}

{{#if tracker.moveToReview}}Stage moves after `{{ tracker.reviewStageName }}` are manual{{else}}Later stage moves are manual{{/if}} — the tracker UI,
`/{{ tracker.slug }}-status`, or `npx cairn tracker close` (closes the parent and
every subtask together). Assignee changes: `/{{ tracker.slug }}-assign`. Both
commands are manual-trigger only, never called by a workflow step.

{{#if tracker.movesStage}}
**Stage names** come from `tracker.statuses` in `cairn.config.json`; a step moves an issue
only to a stage named there. Every move uses `--if-exists`: if the board has no such
stage, the command prints `skipped: stage "…" does not exist on this board` and exits 0.
Say so once in your reply and carry on; never move the issue to a different stage in its
place. `npx cairn tracker check-statuses` compares the configured names with the board.

{{/if}}
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
{{else}}
## No remote tracker

`tracker.provider` is `none` — the workflow steps that would sync are no-ops. A task
is exactly its `ai/tasks/[KEY]/` folder; there is nothing else to update. Pick any
stable `[KEY]` scheme (a sequential id, a sprint slug) and keep it consistent.
{{/if}}
