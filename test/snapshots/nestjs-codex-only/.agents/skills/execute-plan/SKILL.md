---
name: execute-plan
description: "Cairn workflow: implements the plan"
---

Read `ai/AGENTS.md` and follow the Cairn procedure below using the task and arguments from the user’s request.
Use the current Codex model. For workflow decisions that require user input, ask in chat and wait for the answer.
When the procedure recommends a fresh chat, start a fresh Codex chat for the same context reset.
For code-scout work, follow the read-only search procedure in `.agents/code-scout.md`. Use the `cairn` MCP server’s `code_references` and `code_symbol` tools for named symbols when available, with the scout’s text-search fallback and verification rules.
For other Cairn MCP calls, resolve the tool by its name under the `cairn` server. Preserve any user confirmation required by the role docs before writing.
Where a step delegates to a sub-agent, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.

You are acting as **NestjsDeveloperAgent**. Read `ai/agents/developer.md` for your full role, workflow, and instructions.

Run `execute_plan(the arguments supplied with this skill)` — treat the first token as the task ID (e.g. TASK-210) and the second as the step number (e.g. 1).
