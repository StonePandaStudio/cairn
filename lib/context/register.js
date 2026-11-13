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

// Codex reads project-scoped MCP servers from `<repo>/.codex/config.toml`. Unlike `.mcp.json` the
// entry needs an absolute `cwd` (Codex does not start a server from the repo root), so the file is
// machine-specific: each checkout runs `register --codex` itself and the file is not committed.
const CODEX_FILE = path.join('.codex', 'config.toml');

function tomlString(s) {
  return JSON.stringify(s); // a JSON string is a valid TOML basic string
}

function codexSection(repoPath, configFile) {
  const entry = serverEntry(repoPath, configFile);
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `cwd = ${tomlString(toPosix(path.resolve(repoPath)))}`,
    `args = [${entry.args.map(tomlString).join(', ')}]`,
  ].join('\n');
}

// The `[mcp_servers.cairn]` table in a TOML text, as { start, end } offsets, or null. The table runs
// to the next line that opens a different table; its own sub-tables (`[mcp_servers.cairn.env]`)
// belong to it.
function findCodexSection(text) {
  const header = new RegExp(`^\\[mcp_servers\\.${SERVER_NAME}\\][ \\t]*\\r?$`, 'm').exec(text);
  if (!header) return null;
  const own = new RegExp(`^\\[mcp_servers\\.${SERVER_NAME}(\\.[^\\]]*)?\\]`);
  const lines = text.slice(header.index).split('\n');
  let end = header.index;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && lines[i].startsWith('[') && !own.test(lines[i])) break;
    end += lines[i].length + (i < lines.length - 1 ? 1 : 0);
  }
  return { start: header.index, end };
}

// Same actions as registerRepo, for `.codex/config.toml`. No TOML parser: the table is found by its
// header and compared as text, so anything else in the file (other servers, settings, comments)
// is never rewritten.
function registerCodexRepo(repo, configFile, { force = false, dryRun = false } = {}) {
  const file = path.join(repo.path, CODEX_FILE);
  const section = codexSection(repo.path, configFile);
  const installed = fs.existsSync(path.join(repo.path, CAIRN_BIN_REL));
  const existed = fs.existsSync(file);
  const text = existed ? fs.readFileSync(file, 'utf8') : '';
  const found = findCodexSection(text);
  const row = (action, extra = {}) => ({ repo: repo.name, file, target: 'codex', action, ...extra });

  let action;
  let next;
  if (!found) {
    action = existed ? 'added' : 'created';
    const sep = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    next = `${text}${sep}${section}\n`;
  } else {
    const current = text.slice(found.start, found.end).replace(/\r\n/g, '\n').trim();
    if (current === section) return row('unchanged', { installed });
    if (!force) return row('differs', { current, wanted: section });
    action = 'replaced';
    const tail = text.slice(found.end).replace(/^\r?\n/, '');
    next = `${text.slice(0, found.start)}${section}\n${tail === '' ? '' : '\n'}${tail}`;
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next);
  }
  return row(action, { installed });
}

// The Claude `.mcp.json` for every repo. The hosts-aware entry point, which also covers Codex,
// is `registerMcp` in `../hosts`.
function registerAll(repos, configFile, opts = {}) {
  return repos.map((r) => registerRepo(r, configFile, opts));
}

module.exports = { registerAll, registerRepo, registerCodexRepo, serverEntry, SERVER_NAME, CAIRN_BIN_REL, CODEX_FILE };
