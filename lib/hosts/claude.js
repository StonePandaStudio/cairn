'use strict';

// The Claude Code host adapter. The renderer builds Claude's files (`.claude/commands/`,
// `.claude/agents/code-scout.md`) together with the shared `ai/` docs, because other hosts derive
// their own files from them (see `codex.js`), and drops the `.claude/` ones for a repo whose hosts
// do not include `claude` (render/index.js). So this adapter adds no targets of its own. It owns the
// host's MCP registration: the project-scoped `.mcp.json`.

const { registerRepo } = require('../context/register');

module.exports = {
  id: 'claude',
  label: 'Claude Code',
  targets: null,
  mcp: { file: '.mcp.json', register: registerRepo },
};
