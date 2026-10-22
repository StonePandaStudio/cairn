{{! cairn preset: core. Rendered only when the repo is in a workspace (repos.json
    lists siblings) AND has a remote tracker — a request is a tracker issue in the
    shared project, so with no tracker there is no channel. Standalone command, not
    a workflow.steps[] entry: no task/step shape of its own. }}
---
description: Ask a sibling repo for a change (a field, an endpoint) via a linked {{ tracker.providerLabel }} issue
argument-hint: "[target-repo] [source-task?]"
---
You are acting as **{{ architectAgent }}**. Read `ai/agents/architect.md` for your role.

A sibling repo owns something this task needs and it isn't there yet — a response field,
an endpoint, a screen spec. Ask for it; never build it in the sibling yourself. Parse
`$ARGUMENTS`: the first token is the **target repo** (a name from the Workspace table in
`ai/AGENTS.md`), the optional second is the **source task** (e.g. {{ tracker.exampleKey }}-14). If the
target isn't in that table, stop and say so. If the source task is omitted, ask which
task this serves; if there is none, say the request will be unlinked.

1. **Verify the gap.** Read the target repo (read-only) at the file that owns the
   contract — its `CLAUDE.md`, `ai/contexts/**`, then the code — and confirm the thing is
   really missing or really different. If it already exists, stop and tell the user where.
2. **Draft the request** with the user, and write it to
   `ai/tasks/[source-task]/requests/[target]-[slug].md` (a local record; commit it with the
   task). Sections: `## What` (the exact shape wanted — field name, type, nullability,
   endpoint), `## Why` (the screen or flow, and the source task), `## Acceptance`,
   `## References` (the target file that owns it, the source files that need it). Be
   specific enough that the target's architect needs no follow-up question.
3. **Wait for the user to confirm the draft.** Creating the issue is visible to others.
4. **File it.** Run everything via `npx cairn tracker <cmd>`:
   - `create-task "[backend] Return avatarUrl from GET /auth/me" ai/tasks/[source-task]/requests/[target]-[slug].md`
     — the summary starts with the target repo's name in square brackets (shown here for
     `backend`), which marks who owns the request. Start the description file with a
     `Requested by: [source-task] ([this repo])` line. It prints the new key.
   - `link [source-task] [new-key]` — the source task now *depends on* the request.
     Skip it if the source is a `LOCAL-*` task. If it fails with `Unknown command: link`,
     the installed cairn predates it: tell the user to update cairn, don't give up on the
     link. Fall back to `append-description [source-task] "Depends on [new-key] ([target repo])"`
     and `append-description [new-key] "Blocks [source-task] ([this repo])"` so the
     relation is at least visible on both issues. If `link` itself errors (e.g. jira-server,
     not implemented), use the same fallback.
5. **Record the dependency** under `## Open dependencies` in
   `ai/tasks/[source-task]/description-step-[N].md` (create the section if absent):
   the new key, the repo, and what it unblocks. `plan_task` must treat it as a blocker
   or an explicit assumption.
6. **Tell the user** the new key and that the target repo picks it up with
   `/create-brief [new-key] 1` — that seeds its brief from this issue.

Do not edit anything in the target repo. Do not mock the missing contract in this repo
without saying so in the plan.
