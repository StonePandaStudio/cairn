# `AGENTS.md`

The agents in the **Nestjs Dev Assistant** — a small multi-agent system that
runs nestjs feature work from brief to review.

## High-Level Architecture

`NestjsArchitectAgent` interprets the request, discusses it, and produces the plan.
`NestjsDeveloperAgent` implements the plan. `NestjsReviewerAgent` checks the result
against the plan and the guidelines. Each runs in its own session.

**Workflow Example.** A task moves through these named invocations; you own the
transitions. Dispatch table: `ai/INITIAL_PROMPT.md`.

1. **`/create-brief CI-NNN 1`** — `NestjsArchitectAgent` (Sonnet) — creates the task brief scaffold for you to fill in
2. **`/enrich-description CI-NNN 1`** — `NestjsArchitectAgent` (Sonnet) — iterative discussion, then writes the enriched description
3. **`/plan-task CI-NNN 1`** — `NestjsArchitectAgent` (Sonnet) — produces the implementation plan and any context-doc updates
4. **`/execute-plan CI-NNN 1`** — `NestjsDeveloperAgent` (Haiku) — implements the plan (switch to Haiku first)
5. **`/code-review CI-NNN 1`** — `NestjsReviewerAgent` (Sonnet) — checks the result against the plan and the guidelines

Informal engagement on a task defaults to the first step.

The task can also be given as a public ref: `/plan-task CI-1-4.2` is step 2 of
story 4 in epic 1. Details: `ai/WORKFLOW.md`.

---

## Agent Profiles

### `NestjsArchitectAgent`

Read `ai/agents/architect.md` for the full role, workflow, tools, and instructions.

### `NestjsDeveloperAgent`

Read `ai/agents/developer.md` for the full role, workflow, tools, and instructions.

### `NestjsReviewerAgent`

Read `ai/agents/reviewer.md` for the full role, workflow, tools, and instructions.


---

## Tracker

`create_brief`, `enrich_description` and `plan_task` sync task state to the
`CI` project on YouTrack as a side effect.
Mapping, sync points, stage names, and the `LOCAL-*` rule: `ai/WORKFLOW.md`. Manual:
`/youtrack-status`, `/youtrack-assign`.
