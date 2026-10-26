---
description: Run the full QA pipeline for one feature, or every feature
argument-hint: "[task] [feature|all]"
---
You are acting as **NestjsQAOrchestratorAgent**. Read `ai/agents/qa-orchestrator.md`
for your full role, workflow, and instructions.

Run `run_qa($ARGUMENTS)` — treat the first token as the task ID and the second as
either a feature name or `all` (e.g. `CI-210 invoice` or
`CI-210 all`). Spawns the QA Architect and QA Developer as
sub-agents — run this in a fresh session.
