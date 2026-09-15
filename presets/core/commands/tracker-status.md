---
description: Report or set a {{ tracker.providerLabel }} issue's Stage
argument-hint: "[key] [stage?]"
---
Manage the `Stage` of a {{ tracker.providerLabel }} issue (parent or child) in the
`{{ tracker.exampleKey }}` project.

Run everything via `npx cairn tracker <cmd>` — `_cairn/scripts/jira.js` (present in
every cairn-managed repo, whatever the provider) works identically if `npx` isn't
available. A legacy `ai/scripts/{{ tracker.slug }}.js`, if this repo has one, is a
third equivalent — but unlike the other two, it's **not guaranteed to exist**; only
check for it, never assume it.

Parse `$ARGUMENTS`:
- **One token** (e.g. `{{ tracker.exampleKey }}-3`) — report the issue's current
  stage only. Run `npx cairn tracker get [key]` and tell the user the `status`
  value.
- **Two tokens** (e.g. `{{ tracker.exampleKey }}-3 Develop`) — set the stage. Run
  `npx cairn tracker set-status [key] [stage]`.

Valid stages: see `ai/WORKFLOW.md`; re-verify with `npx cairn tracker list-statuses
{{ tracker.exampleKey }}` if this may have changed. If the command prints
`already X`, the issue was already at that stage — report that, no retry. If it
errors with an unknown stage name, list the valid stages to the user — do not
guess.

To close a whole task (parent + all children) use `npx cairn tracker close [key]`
instead — it moves every subtask along with the parent, not just one issue.

This command is manual-trigger only — it is not called automatically by
`create_brief`, `enrich_description`, `plan_task`, `execute_plan`, or `code_review`.
