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
4. **`/execute-plan CI-NNN 1`** — `NestjsDeveloperAgent` (Haiku) — implements the plan (Haiku recommended)
5. **`/code-review CI-NNN 1`** — `NestjsReviewerAgent` (Sonnet) — checks the result against the plan and the guidelines

Informal engagement on a task defaults to the first step.

**After a review.** `NestjsReviewerAgent` ends by offering the next step: replan and re-review,
fix now without replanning, or stop. Either fix runs as `/fix-review [task] [step] [blockers|all|B1 S2 …] [--replan]`,
which chains the agents as sub-agents (one fix round, then a re-review). Run it by hand to pick
individual findings.

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

## Starting on an existing code base

Run once, before the first task, when `ai/contexts/` is empty or thin. Safe to re-run:
it only adds what is missing.

- `/discover [area]` — `NestjsDiscoveryAgent` (`ai/agents/discovery.md`) proposes, then drafts, `ai/contexts/**` docs from the code (`status: draft` until you review them), and writes `ai/discovery-report.md`

---

## QA for existing code

Separate from the workflow above, which gets its tests from the plan's **Tests**
section. These add tests to code that already exists:

- `/plan-tests [task] [target]` — `NestjsQAArchitectAgent` (`ai/agents/qa-architect.md`) writes `ai/tasks/[task]/test-plan-[target].md`
- `/execute-test-plan [task] [target]` — `NestjsQADeveloperAgent` (`ai/agents/qa-developer.md`) writes and verifies the tests
- `/run-qa [task] [target|all]` — `NestjsQAOrchestratorAgent` (`ai/agents/qa-orchestrator.md`) runs both

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

`create_brief`, `enrich_description` and `plan_task` sync task state to the
`CI` project on YouTrack as a side effect.
Mapping, sync points, stage names, and the `LOCAL-*` rule: `ai/WORKFLOW.md`. Manual:
`/youtrack-status`, `/youtrack-assign`.
