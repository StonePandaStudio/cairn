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

Later stage moves (`{{ tracker.reviewStage }}` onward) are manual — the tracker UI,
`/{{ tracker.slug }}-status`, or `cairn tracker close` (closes the parent and every
subtask together). Assignee changes: `/{{ tracker.slug }}-assign`. Both commands are
manual-trigger only, never called by a workflow step.

Everything goes through `cairn tracker <command> …` (or the vendored
`ai/scripts/*.js` shim). Credentials live in `.env` (gitignored).
{{else}}
## No remote tracker

`tracker.provider` is `none` — the workflow steps that would sync are no-ops. A task
is exactly its `ai/tasks/[KEY]/` folder; there is nothing else to update. Pick any
stable `[KEY]` scheme (a sequential id, a sprint slug) and keep it consistent.
{{/if}}
