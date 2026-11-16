---
description: Register the cairn MCP server and install the code lookup tools
---

# cairn-tools

Give the agents cairn's context and code lookups. Arguments from the user, if any: $ARGUMENTS

## Procedure

1. **Where.** A workspace (`repos.json` next to or above the repos): pass `--config <file>` to every command below. A single repo: run them from the repo root.
2. **Register the MCP server.** `npx cairn context register [--config <file>]` adds a `cairn` entry for each host a repo uses: `.mcp.json` for Claude Code, `.codex/config.toml` for Codex. Other servers are kept; a different existing `cairn` entry is left alone unless `--force` (ask first). The Codex file has an absolute path, so it is per-machine: it must not be committed. Claude Code asks the user to approve a project server the first time.
3. **Check the contexts (cheap, read-only).** `npx cairn context check` reports links and anchors; it never fails CI. Summarise the findings.
4. **Code lookup tools (heavy, ask first).** `npx cairn context install-tools [--config <file>]` installs Serena (symbols and references through language servers) into `<workspace>/_cairn/tools/` and warms each repo's language server. It needs Python 3.11–3.14, downloads about 170 MB and takes minutes. `--no-warm` skips the warm-up. `--provider codebase-memory-mcp` adds an optional architecture-summary tool (about 330 MB).
5. **Verify.** Tell the user to restart the agent session, then ask it to look up a symbol with the `cairn` server's `code_symbol` tool.

{{common}}
