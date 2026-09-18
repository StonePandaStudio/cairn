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

`[KEY]` is the task folder name. Speculative or un-tracked work uses a `LOCAL-`
prefix so a folder name can never collide with a real issue key.

{{#if tracker.remote}}
## Sync to {{ tracker.providerLabel }}

`ai/tasks/[KEY]/` mirrors to the `{{ tracker.exampleKey }}` project. The folder name
is the parent issue key; each step's child-issue key is stamped into the first line
of its `brief-step-[N].md`:

```
<!-- {{ tracker.subtaskMarker }}: {{ tracker.exampleKey }}-4 -->
```

Issue keys are project-sequential, not per-parent — a parent and child with
unrelated numbers is normal. The parent link is the tracker's own link, not the key.

**In scope:** a folder starting `{{ tracker.exampleKey }}-` whose step file carries
`{{ tracker.subtaskMarker }}` frontmatter. **Not in scope:** a `LOCAL-` folder — work
it locally, mention that once, never sync it.

### Sync points (one-way: local → tracker)

| Command | Tracker actions |
|---|---|
{{#each workflow.steps}}
| `{{ this.fn }}(task, step)` | {{ this.trackerAction }} |
{{/each}}

### What goes to the tracker

The tracker is an index for people scanning a board. `ai/tasks/[KEY]/` is the source
of truth, and the sync is one-way, so a pasted copy of a step file goes stale the
moment the file is edited. Post a digest, never the file:

- **`create_brief`** — the child issue gets the title, 2–3 sentences of what and why,
  and the brief's path (`ai/tasks/[KEY]/brief-step-[N].md`).
- **`enrich_description`** — under about 600 characters: a 1–3 sentence outcome, at most
  5 one-line key decisions, and the path `ai/tasks/[KEY]/description-step-[N].md` as the
  last line. No tables, no file lists, no code, no implementation steps.
- **`plan_task`** — the stage move only. Nothing from the plan is posted.
{{#if workspace}}
- **Exception: `/request-change`.** The receiving repo has no local copy of the request,
  so its issue carries the full What / Why / Acceptance. Keep them tight anyway.
{{/if}}

Later stage moves (`{{ tracker.reviewStage }}` onward) are manual — the tracker UI,
`/{{ tracker.slug }}-status`, or `npx cairn tracker close` (closes the parent and
every subtask together). Assignee changes: `/{{ tracker.slug }}-assign`. Both
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
{{else}}
## No remote tracker

`tracker.provider` is `none` — the workflow steps that would sync are no-ops. A task
is exactly its `ai/tasks/[KEY]/` folder; there is nothing else to update. Pick any
stable `[KEY]` scheme (a sequential id, a sprint slug) and keep it consistent.
{{/if}}
