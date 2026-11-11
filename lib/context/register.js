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

// The repo's own installed cairn, relative to the repo. `.mcp.json` is meant to be committed,
// so the entry must not depend on the OS of whoever ran `register`: `node` is a real executable
// everywhere, whereas `npx` is a .cmd shim that native Windows cannot spawn without `cmd /c`
// (which then fails on macOS/Linux). It also pins the server to the repo's installed version.
const CAIRN_BIN_REL = 'node_modules/@stonepandastudio/cairn/bin/cairn.js';

// What to write for one repo. Paths are relative to the repo (Claude Code starts a project's
// MCP servers with the repo as the working directory), so the file survives a clone to another
// machine; a workspace config assumes the same folder layout there.
function serverEntry(repoPath, configFile) {
  // No config file (a single repo without repos.json): `serve` finds the repo by itself.
  const args = [CAIRN_BIN_REL, 'context', 'serve'];
  if (configFile) args.push('--config', toPosix(path.relative(repoPath, configFile)) || 'repos.json');
  // alwaysLoad: Claude Code defers MCP tools behind a search step by default, and an agent that
  // skips the step falls back to Grep. The six tools are small; load them up front.
  return { command: 'node', args, alwaysLoad: true };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Returns { repo, file, action } with action one of:
//   created | added | unchanged | differs (left alone) | replaced (force) | invalid (file is not JSON)
function registerRepo(repo, configFile, { force = false, dryRun = false } = {}) {
  const file = path.join(repo.path, '.mcp.json');
  const entry = serverEntry(repo.path, configFile);
  // The entry is written either way; the caller warns, because one that points at nothing fails at start.
  const installed = fs.existsSync(path.join(repo.path, CAIRN_BIN_REL));
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
  else if (same(current, entry)) return { repo: repo.name, file, action: 'unchanged', installed };
  else if (force) action = 'replaced';
  else return { repo: repo.name, file, action: 'differs', current, wanted: entry };

  if (!dryRun) {
    doc.mcpServers = { ...servers, [SERVER_NAME]: entry };
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  }
  return { repo: repo.name, file, action, installed };
}

function registerAll(repos, configFile, opts = {}) {
  return repos.map((r) => registerRepo(r, configFile, opts));
}

module.exports = { registerAll, registerRepo, serverEntry, SERVER_NAME, CAIRN_BIN_REL };
