# `AGENTS.md`

The agents in the **React Dev Assistant** — a small multi-agent system that
runs react feature work from brief to review.

## High-Level Architecture

`ReactArchitectAgent` interprets the request, discusses it, and produces the plan.
`ReactDeveloperAgent` implements the plan. `ReactReviewerAgent` checks the result
against the plan and the guidelines. Each runs in its own session.

**Workflow Example.** A task moves through these named invocations; you own the
transitions. Dispatch table: `ai/INITIAL_PROMPT.md`.

1. **`/create-brief TASK-NNN 1`** — `ReactArchitectAgent` (Sonnet) — creates the task brief scaffold for you to fill in
2. **`/enrich-description TASK-NNN 1`** — `ReactArchitectAgent` (Sonnet) — iterative discussion, then writes the enriched description
3. **`/plan-task TASK-NNN 1`** — `ReactArchitectAgent` (Sonnet) — produces the implementation plan and any context-doc updates
4. **`/execute-plan TASK-NNN 1`** — `ReactDeveloperAgent` (Haiku) — implements the plan (Haiku recommended)
5. **`/code-review TASK-NNN 1`** — `ReactReviewerAgent` (Sonnet) — checks the result against the plan and the guidelines

Informal engagement on a task defaults to the first step.

**After a review.** `ReactReviewerAgent` ends by offering the next step: replan and re-review,
fix now without replanning, or stop. Either fix runs as `/fix-review [task] [step] [blockers|all|B1 S2 …] [--replan]`,
which chains the agents as sub-agents (one fix round, then a re-review). Run it by hand to pick
individual findings.

---

## Agent Profiles

### `ReactArchitectAgent`

Read `ai/agents/architect.md` for the full role, workflow, tools, and instructions.

### `ReactDeveloperAgent`

Read `ai/agents/developer.md` for the full role, workflow, tools, and instructions.

### `ReactReviewerAgent`

Read `ai/agents/reviewer.md` for the full role, workflow, tools, and instructions.


---

## Starting on an existing code base

Run once, before the first task, when `ai/contexts/` is empty or thin. Safe to re-run:
it only adds what is missing.

- `/discover [area]` — `ReactDiscoveryAgent` (`ai/agents/discovery.md`) proposes, then drafts, `ai/contexts/**` docs from the code (`status: draft` until you review them), and writes `ai/discovery-report.md`

---

## Code lookups

When the `cairn` MCP server is connected (`/mcp` lists it), "who uses X", "where is X defined"
and "is it safe to change X" questions have a better tool than text search. Its tools are
deferred in Claude Code: load `mcp__cairn__code_references` and `mcp__cairn__code_symbol` with
ToolSearch first, or hand the question to the `code-scout` sub-agent, which already has them.
They cover every repo of the workspace.

- A unique, private name in one file does not need them; one Grep is enough.
- A `missing` or empty answer is not proof of absence: names used as strings, DI tokens,
  reflection, templates, and generated files are invisible to them. Read `notes` in the reply.
- A symbol lookup matches by name, so check the file and label of the match before relying on it.
- Before a delete, rename or signature change, run one Grep as well and compare the two.

---

## Tracker

No remote tracker (`tracker.provider` is `none`). A task is its `ai/tasks/[KEY]/`
folder; the sync steps are no-ops. See `ai/WORKFLOW.md`.
