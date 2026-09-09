# Local Task ↔ Tracker Workflow

<!-- cairn preset: core. Rendered from workflow.steps[].tracker + tracker.* config.
     snap-proof/backend (YouTrack) and snap-proof/frontend (Jira) carry the same
     document; only the provider block, the stage names, and the sync-points
     actions differ — all of which are config. Project-specific bits (the
     retrofit procedure for pre-sync tasks) stay in the repo, outside this file. -->

How `ai/tasks/` syncs with **{{ tracker.providerLabel }}**. The `{{ tracker.exampleKey }}`
project is shared across the repos of this project — issue keys are
project-sequential, not per-repo, so always confirm via `get [key]` before assuming.

**Terminology note:** "task" means the local `ai/tasks/[KEY]/` folder. "Parent issue"
is the tracker issue matching a task folder; "child issue" is the issue matching a step.

## Mapping

| Local | {{ tracker.providerLabel }} |
|---|---|
| Task (`ai/tasks/[KEY]/`) | {{ tracker.parentTerm }} |
| Step (`brief-step-[N].md` + `description-step-[N].md` + `plan-step-[N].md`) | {{ tracker.childTerm }}, linked to the parent |

Folder name = parent issue key (e.g. `ai/tasks/{{ tracker.exampleKey }}-3/`). Each
step's child-issue key is stored in a frontmatter comment on the first line of that
step's `brief-step-[N].md`:

```
<!-- {{ tracker.subtaskMarker }}: {{ tracker.exampleKey }}-4 -->
```

Issue keys are project-sequential, not per-parent — a parent and child having
unrelated numbers is normal. The parent link is the tracker link, not the key.

## Tracker configuration

| | Value |
|---|---|
| Base URL | `{{ tracker.baseUrlEnv }}` in `.env` |
| Auth | {{ tracker.authNote }} |
| Project | `{{ tracker.exampleKey }}` |
| Workflow field | {{ tracker.statusField }}: {{ tracker.stageList }} |
| Description markup | {{ tracker.markupNote }} |

## Scope: which local tasks sync

- **Any task created from now on via `create_brief`** — synced from creation.
- **`ai/tasks/LOCAL-*`** (and everything under `ai/tasks/archive/**`) — pre-migration
  tasks, **not synced**. The `LOCAL-<n>` number carries no relationship to any tracker
  key of the same number; a folder like `ai/tasks/{{ tracker.exampleKey }}-217/` is a
  genuine tracker-backed task, not an alias for `LOCAL-217-*`. Never redirect a command
  between the two because the numbers match.

**Never name a task folder after a key the tracker did not hand out.** Speculative work
uses the `LOCAL-*` prefix so it can never collide with a future issue key.

**How to tell if a task is in scope:** folder starts with `{{ tracker.exampleKey }}-`
and its step file carries `{{ tracker.subtaskMarker }}` frontmatter → syncing. Folder
starts with `LOCAL-` → local-only, skip sync, mention this to the user once.

## Sync points (one-way: local → tracker)

| Command | Tracker actions |
|---|---|
{{#each workflow.steps}}
| `{{ this.fn }}(task, step)` | {{ this.tracker.action }} |
{{/each}}

Nothing here moves an issue past `{{ tracker.reviewStage }}` — later transitions are
manual (tracker UI, `/{{ tracker.slug }}-status`, or `close-task`).

## Manual-trigger commands

- `/{{ tracker.slug }}-status [KEY] [stage]` — no stage = report current; with stage = set it.
- `/{{ tracker.slug }}-assign [KEY] [login]` — no login = report current; with login = set it.

## Underlying tool

All commands go through `cairn tracker <command> ...` (or the vendored
`ai/scripts/*.js` shim). Commands: `list-projects`, `list-statuses <project>`,
`create-task`, `create-subtask`, `get`, `set-fields`, `append-description`,
`set-status`, `set-assignee`, `close-task`. No delete command — deleting issues is manual.

Credentials live in the repo's `.env` (gitignored). Markup conversion, if any:
`cairn tracker … --markup`.
