---
description: Report or set a YouTrack issue's assignee
argument-hint: "[key] [login?]"
---
Manage the assignee of a YouTrack issue (parent or child) in the
`CI` project.

Run everything via `npx cairn tracker <cmd>` — `_cairn/scripts/jira.js` (present in
every cairn-managed repo, whatever the provider) works identically if `npx` isn't
available. A legacy `ai/scripts/youtrack.js`, if this repo has one, is a
third equivalent — but unlike the other two, it's **not guaranteed to exist**; only
check for it, never assume it.

Parse `$ARGUMENTS`:
- **One token** (e.g. `CI-3`) — report the issue's current
  assignee only. Run `npx cairn tracker get [key]` and tell the user who's assigned
  (or that it's unassigned).
- **Two tokens** (e.g. `CI-3 mikhail.ziankevich`) — set the
  assignee. Run `npx cairn tracker set-assignee [key] [login]`. The value is the
  YouTrack account login, not a display name or email.

This command is manual-trigger only — it is not called automatically by
`create_brief`, `enrich_description`, `plan_task`, `execute_plan`, or `code_review`.
