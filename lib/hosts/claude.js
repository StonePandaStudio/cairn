'use strict';

// The Claude Code host adapter. Claude's files are the shared baseline for now: the renderer
// writes `.claude/commands/`, `.claude/agents/` and `ai/` for every repo, and other hosts derive
// their own files from them (see `codex.js`). So the adapter adds no extra targets. It still owns
// the host's MCP registration: the project-scoped `.mcp.json`.
//
// Making the baseline itself host-neutral (so a repo can render for Codex alone, without
// `.claude/`) is a later step; it means rewording the core templates, not moving files.

const { registerRepo } = require('../context/register');

module.exports = {
  id: 'claude',
  label: 'Claude Code',
  targets: null,
  mcp: { file: '.mcp.json', register: registerRepo },
};
