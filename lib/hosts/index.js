'use strict';

// Hosts: the agent harnesses cairn writes files for (Claude Code, Codex, …). cairn never calls a
// model itself, so what varies between setups is the host: where its workflow commands live, how
// its MCP server is registered, what its root instructions file is.
//
// A repo names its hosts in `cairn.config.json`:
//
//   "hosts": ["claude", "codex"]        default: ["claude"]
//
// An adapter is { id, label, targets(baseline) | null, mcp: { file, register(repo, configFile, opts) } }.
//   - `targets(baseline)` gets the [rel, content, source] list the renderer has built and returns
//     extra targets for that host (null: the host adds none, its files are the baseline);
//   - `mcp.register` writes the host's project-scoped MCP entry (merge-safe, see context/register.js).

const { UserError } = require('../errors');

const ADAPTERS = {
  claude: require('./claude'),
  codex: require('./codex'),
};

const DEFAULT_HOSTS = ['claude'];

function listHosts() {
  return Object.keys(ADAPTERS);
}

function getHost(id) {
  const host = ADAPTERS[id];
  if (!host) throw new UserError(`unknown host "${id}" — available: ${listHosts().join(', ')}`);
  return host;
}

// `claude,codex` or ['claude', 'codex'] → ['claude', 'codex']. Order is kept, duplicates dropped,
// unknown names refused.
function normalizeHosts(value) {
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out = [];
  for (const raw of list) {
    const id = String(raw).trim();
    if (!id) continue;
    getHost(id);
    if (!out.includes(id)) out.push(id);
  }
  if (!out.length) throw new UserError(`hosts must name at least one of: ${listHosts().join(', ')}`);
  return out;
}

// The hosts a config selects. `hosts` wins when present; `codexSkills: true` is the older spelling
// of "also Codex" and still adds it. A config with neither gets the default, Claude.
function resolveHosts(config = {}) {
  const hosts = config.hosts === undefined ? [...DEFAULT_HOSTS] : normalizeHosts(config.hosts);
  if (config.codexSkills === true && !hosts.includes('codex')) hosts.push('codex');
  return hosts;
}

// Register the cairn MCP server for a repo's hosts, through each adapter. `only` limits it to
// named hosts (`--codex-mcp` passes ['codex']); a host the repo does not use is `skipped`, never
// written. One row per host: { host, file, action, installed?, reason? }.
function registerMcp(repo, configFile, config, { only = null, dryRun = false } = {}) {
  const configured = resolveHosts(config);
  return (only || configured).map((id) => {
    const host = getHost(id);
    if (!configured.includes(id)) {
      return { host: id, file: host.mcp.file, action: 'skipped', reason: `${id} is not in hosts` };
    }
    const r = host.mcp.register(repo, configFile, { dryRun });
    return { host: id, file: host.mcp.file, action: r.action, installed: r.installed };
  });
}

// Config keys that older cairn versions wrote or documented. They still work; this says what to
// use instead. cairn never rewrites a hand-edited config, so it only reports.
function configNotes(config = {}) {
  const notes = [];
  if (config.codexSkills !== undefined) {
    notes.push(`"codexSkills" is deprecated — use "hosts": ${JSON.stringify(resolveHosts(config))} (it still works)`);
  }
  return notes;
}

module.exports = { listHosts, getHost, normalizeHosts, resolveHosts, registerMcp, configNotes, DEFAULT_HOSTS };
