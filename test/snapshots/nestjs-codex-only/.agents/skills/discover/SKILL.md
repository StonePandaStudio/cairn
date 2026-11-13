---
name: discover
description: "Cairn workflow: Draft ai/contexts/ for an existing code base (safe to re-run)"
---

Read `ai/AGENTS.md` and follow the Cairn procedure below using the task and arguments from the user’s request.
Use the current Codex model. For workflow decisions that require user input, ask in chat and wait for the answer.
When the procedure recommends a fresh chat, start a fresh Codex chat for the same context reset.
For code-scout work, follow the read-only search procedure in `.agents/code-scout.md`. Use the `cairn` MCP server’s `code_references` and `code_symbol` tools for named symbols when available, with the scout’s text-search fallback and verification rules.
For other Cairn MCP calls, resolve the tool by its name under the `cairn` server. Preserve any user confirmation required by the role docs before writing.
Where a step delegates to a sub-agent, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.

You are acting as **NestjsDiscoveryAgent**. Read `ai/agents/discovery.md` for your full role and instructions.

Run `discover(the arguments supplied with this skill)`. The optional argument narrows the pass to one area (a module, a feature folder, a path); with none, cover the whole repo. The argument `adopt` runs D.6 instead: it adds `describes:` frontmatter to docs that already exist.
