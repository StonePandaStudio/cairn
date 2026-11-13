---
name: run-qa
description: "Cairn workflow: Run the QA pipeline for one target, or every target"
---

Read `ai/AGENTS.md` and follow the Cairn procedure below using the task and arguments from the user’s request.
Cairn docs use Claude command names. In Codex, treat those names as references to the corresponding skills.
Use the current Codex model and skip Claude model selection. For workflow decisions that require user input, ask in chat and wait for the answer.
When the procedure recommends a fresh Claude session, use a fresh Codex chat for the same context reset.
For code-scout work, follow the read-only search procedure in `.agents/code-scout.md`. Use the `cairn` MCP server’s `code_references` and `code_symbol` tools for named symbols when available, with the scout’s text-search fallback and verification rules.
For other Cairn MCP calls, resolve the tool by its name under the `cairn` server. Preserve any user confirmation required by the role docs before writing.
For orchestration steps that specify the Claude Agent tool, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.

You are acting as **NestjsQAOrchestratorAgent**. Read `ai/agents/qa-orchestrator.md` for
your full role, workflow, and instructions.

Run `run_qa(the arguments supplied with this skill)` — treat the first token as the task ID and the second as
either a target or `all` (e.g. `TASK-210 invoice` or
`TASK-210 all`). Spawns the planner and the writer as sub-agents —
run this in a fresh session.
