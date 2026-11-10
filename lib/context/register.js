'use strict';

// `cairn context register` — put the `cairn` MCP server into each repo's project-scoped
// `.mcp.json`, so an agent opened in any repo of the workspace can call the context and
// code tools. Merge, never overwrite: other servers in the file are kept, and an existing
// `cairn` entry that differs is reported and left alone unless `force` is set.
//
// The server name is `cairn` on purpose: the preset agent docs name the tools
// `mcp__cairn__code_references` etc.

const fs = require('fs');
const path = require('path');

const SERVER_NAME = 'cairn';

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

// What to write for one repo. The config path is relative to the repo (Claude Code starts
// project MCP servers with the repo as cwd), so the file survives a move of the whole
// workspace and a clone to another machine with the same layout.
function serverEntry(repoPath, configFile, platform = process.platform) {
  const rel = toPosix(path.relative(repoPath, configFile)) || 'repos.json';
  const args = ['cairn', 'context', 'serve', '--config', rel];
  // Native Windows cannot spawn `npx` (a .cmd shim) directly from an MCP config.
  return platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'npx', ...args] }
    : { command: 'npx', args };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Returns { repo, file, action } with action one of:
//   created | added | unchanged | differs (left alone) | replaced (force) | invalid (file is not JSON)
function registerRepo(repo, configFile, { force = false, dryRun = false, platform } = {}) {
  const file = path.join(repo.path, '.mcp.json');
  const entry = serverEntry(repo.path, configFile, platform);
  let doc = null;
  let existed = false;
  if (fs.existsSync(file)) {
    existed = true;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { repo: repo.name, file, action: 'invalid' };
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { repo: repo.name, file, action: 'invalid' };
  } else {
    doc = {};
  }
  if (doc.mcpServers != null && (typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers))) {
    return { repo: repo.name, file, action: 'invalid' };
  }
  const servers = doc.mcpServers || {};
  const current = servers[SERVER_NAME];

  let action;
  if (current === undefined) action = existed ? 'added' : 'created';
  else if (same(current, entry)) return { repo: repo.name, file, action: 'unchanged' };
  else if (force) action = 'replaced';
  else return { repo: repo.name, file, action: 'differs', current, wanted: entry };

  if (!dryRun) {
    doc.mcpServers = { ...servers, [SERVER_NAME]: entry };
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
  return { repo: repo.name, file, action };
}

function registerAll(repos, configFile, opts = {}) {
  return repos.map((r) => registerRepo(r, configFile, opts));
}

module.exports = { registerAll, registerRepo, serverEntry, SERVER_NAME };
