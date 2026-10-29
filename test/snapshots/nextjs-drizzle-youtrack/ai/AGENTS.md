# `AGENTS.md`

The agents in the **Nextjs Dev Assistant** — a small multi-agent system that
runs nextjs feature work from brief to review.

## High-Level Architecture

`NextjsArchitectAgent` interprets the request, discusses it, and produces the plan.
`NextjsDeveloperAgent` implements the plan. `NextjsReviewerAgent` checks the result
against the plan and the guidelines. Each runs in its own session.

**Workflow Example.** A task moves through these named invocations; you own the
transitions. Dispatch table: `ai/INITIAL_PROMPT.md`.

1. **`/create-brief CI-NNN 1`** — `NextjsArchitectAgent` (Sonnet) — creates the task brief scaffold for you to fill in
2. **`/enrich-description CI-NNN 1`** — `NextjsArchitectAgent` (Sonnet) — iterative discussion, then writes the enriched description
3. **`/plan-task CI-NNN 1`** — `NextjsArchitectAgent` (Sonnet) — produces the implementation plan and any context-doc updates
4. **`/execute-plan CI-NNN 1`** — `NextjsDeveloperAgent` (Haiku) — implements the plan (Haiku recommended)
5. **`/code-review CI-NNN 1`** — `NextjsReviewerAgent` (Sonnet) — checks the result against the plan and the guidelines

Informal engagement on a task defaults to the first step.

**After a review.** `NextjsReviewerAgent` ends by offering the next step: replan and re-review,
fix now without replanning, or stop. Either fix runs as `/fix-review [task] [step] [blockers|all|B1 S2 …] [--replan]`,
which chains the agents as sub-agents (one fix round, then a re-review). Run it by hand to pick
individual findings.

---

## Agent Profiles

### `NextjsArchitectAgent`

Read `ai/agents/architect.md` for the full role, workflow, tools, and instructions.

### `NextjsDeveloperAgent`

Read `ai/agents/developer.md` for the full role, workflow, tools, and instructions.

### `NextjsReviewerAgent`

Read `ai/agents/reviewer.md` for the full role, workflow, tools, and instructions.


---

## Starting on an existing code base

Run once, before the first task, when `ai/contexts/` is empty or thin. Safe to re-run:
it only adds what is missing.

- `/discover [area]` — `NextjsDiscoveryAgent` (`ai/agents/discovery.md`) proposes, then drafts, `ai/contexts/**` docs from the code (`status: draft` until you review them), and writes `ai/discovery-report.md`

---

## Tracker

`create_brief`, `enrich_description` and `plan_task` sync task state to the
`CI` project on YouTrack as a side effect.
Mapping, sync points, stage names, and the `LOCAL-*` rule: `ai/WORKFLOW.md`. Manual:
`/youtrack-status`, `/youtrack-assign`.
