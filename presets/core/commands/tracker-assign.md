---
description: Report or set a {{ tracker.providerLabel }} issue's assignee
argument-hint: "[key] [login?]"
---
Manage the assignee of a {{ tracker.providerLabel }} issue (parent or child) in the
`{{ tracker.exampleKey }}` project.

Parse `$ARGUMENTS`:
- **One token** (e.g. `{{ tracker.exampleKey }}-3`) — report the issue's current
  assignee only. Run `node ai/scripts/{{ tracker.slug }}.js get [key]` (or `cairn
  tracker get [key]`) and tell the user who's assigned (or that it's unassigned).
- **Two tokens** (e.g. `{{ tracker.exampleKey }}-3 mikhail.ziankevich`) — set the
  assignee. Run `node ai/scripts/{{ tracker.slug }}.js set-assignee [key] [login]`.
  The value is the {{ tracker.providerLabel }} account login, not a display name or
  email.

This command is manual-trigger only — it is not called automatically by
`create_brief`, `enrich_description`, `plan_task`, `execute_plan`, or `code_review`.
