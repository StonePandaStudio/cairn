Manage the `Stage` of a {{ tracker.providerLabel }} issue (parent or child) in the
`{{ tracker.exampleKey }}` project.

Parse `$ARGUMENTS`:
- **One token** (e.g. `{{ tracker.exampleKey }}-3`) — report the issue's current
  stage only. Run `node ai/scripts/{{ tracker.slug }}.js get [key]` (or `cairn
  tracker get [key]`) and tell the user the `status` value.
- **Two tokens** (e.g. `{{ tracker.exampleKey }}-3 Develop`) — set the stage. Run
  `node ai/scripts/{{ tracker.slug }}.js set-status [key] [stage]`.

Valid stages: see `ai/WORKFLOW.md`; re-verify with `node ai/scripts/{{ tracker.slug }}.js
list-statuses {{ tracker.exampleKey }}` if this may have changed. If the script
prints `already X`, the issue was already at that stage — report that, no retry. If
it errors with an unknown stage name, list the valid stages to the user — do not
guess.

To close a whole task (parent + all children) use `node ai/scripts/{{ tracker.slug }}.js
close [key]` instead — it moves every subtask along with the parent, not just one issue.

This command is manual-trigger only — it is not called automatically by
`create_brief`, `enrich_description`, `plan_task`, `execute_plan`, or `code_review`.
