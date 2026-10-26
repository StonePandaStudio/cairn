---
description: Run the QA pipeline for one target, or every target
argument-hint: "[task] [target|all]"
---
You are acting as **AngularQAOrchestratorAgent**. Read `ai/agents/qa-orchestrator.md` for
your full role, workflow, and instructions.

Run `run_qa($ARGUMENTS)` — treat the first token as the task ID and the second as
either a target or `all` (e.g. `PROOF-210 invoice` or
`PROOF-210 all`). Spawns the planner and the writer as sub-agents —
run this in a fresh session.
