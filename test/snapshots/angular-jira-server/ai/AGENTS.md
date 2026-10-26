# `AGENTS.md`

The agents in the **Angular Dev Assistant** — a small multi-agent system that
runs angular feature work from brief to review.

## High-Level Architecture

`AngularArchitectAgent` interprets the request, discusses it, and produces the plan.
`AngularDeveloperAgent` implements the plan. `AngularReviewerAgent` checks the result
against the plan and the guidelines. Each runs in its own session.

**Workflow Example.** A task moves through these named invocations; you own the
transitions. Dispatch table: `ai/INITIAL_PROMPT.md`.

1. **`/create-brief PROOF-NNN 1`** — `AngularArchitectAgent` (Sonnet) — creates the task brief scaffold for you to fill in
2. **`/enrich-description PROOF-NNN 1`** — `AngularArchitectAgent` (Sonnet) — iterative discussion, then writes the enriched description
3. **`/plan-task PROOF-NNN 1`** — `AngularArchitectAgent` (Sonnet) — produces the implementation plan and any context-doc updates
4. **`/execute-plan PROOF-NNN 1`** — `AngularDeveloperAgent` (Haiku) — implements the plan (switch to Haiku first)
5. **`/code-review PROOF-NNN 1`** — `AngularReviewerAgent` (Sonnet) — checks the result against the plan and the guidelines

Informal engagement on a task defaults to the first step.

---

## Agent Profiles

### `AngularArchitectAgent`

Read `ai/agents/architect.md` for the full role, workflow, tools, and instructions.

### `AngularDeveloperAgent`

Read `ai/agents/developer.md` for the full role, workflow, tools, and instructions.

### `AngularReviewerAgent`

Read `ai/agents/reviewer.md` for the full role, workflow, tools, and instructions.


---

## Tracker

`create_brief`, `enrich_description` and `plan_task` sync task state to the
`PROOF` project on Jira as a side effect.
Mapping, sync points, stage names, and the `LOCAL-*` rule: `ai/WORKFLOW.md`. Manual:
`/jira-status`, `/jira-assign`.
