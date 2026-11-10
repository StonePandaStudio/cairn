'use strict';

// codeSource — code facts for `cairn context`, asked by *capability* and answered by a
// pluggable *provider*. cairn core knows no languages and ships no code parser
// (DESIGN.md "The boundary (Q4)"): language knowledge lives in providers, which own their
// parsers / language servers. A repo in a language nobody serves gets `unknown`, never an
// error. See INFRASTRUCTURE.md for where this sits.
//
// Capabilities (language-neutral):
//   symbols     does a named symbol exist in a repo       -> found | missing | unknown
//   references  where is a symbol referenced              -> ok | unknown
//   summary     architecture overview of a repo           -> ok | unknown
//
// A provider is `{ id, capabilities: [...], create({ config, workspaceDir, memoMs }) }`
// where `create` returns an instance with `available()` plus one method per capability it
// serves — `symbol(repo, name)`, `references(repo, symbolPath)`, `summary(repo)` — and
// optionally `index(repo)`. `repo` is `{ name, path }`. Methods return `{ status, ... }`
// and never throw for an unavailable tool. Providers register with `registerProvider`.
//
// Config (the optional `codeSource` block of repos.json):
//   { "providers": { "summary": "codebase-memory-mcp" },      // route a capability explicitly
//     "codebase-memory-mcp": { "command": "...", ... } }      // per-provider settings
// The pre-registry flat shape (`{ command, args, version, allowGlobal }`) is still read, as
// the settings of `codebase-memory-mcp`.

const cbm = require('./providers/codebase-memory');
const serena = require('./providers/serena');

const CAPABILITIES = ['symbols', 'references', 'summary'];

// Used when a capability is not routed explicitly: the first available provider wins.
// This is a *preference order* (Serena is compiler-accurate; the code-graph tool is the
// optional orientation provider); any other registered provider with the capability is
// tried after these, so adding a provider never requires editing this table.
const DEFAULT_ROUTING = {
  symbols: ['serena', 'codebase-memory-mcp'],
  references: ['serena'],
  summary: ['codebase-memory-mcp'],
};

const HINT = 'run `cairn context setup` to install a code-intelligence provider into this workspace';

const registry = new Map();

// Returns a function that unregisters it again (for tests).
function registerProvider(provider) {
  if (!provider || typeof provider.id !== 'string' || typeof provider.create !== 'function') {
    throw new Error('a code provider needs a string `id` and a `create` function');
  }
  const caps = provider.capabilities;
  if (!Array.isArray(caps) || !caps.length || caps.some((c) => !CAPABILITIES.includes(c))) {
    throw new Error(`provider "${provider.id}": capabilities must be a non-empty subset of ${CAPABILITIES.join(', ')}`);
  }
  registry.set(provider.id, provider);
  return () => registry.delete(provider.id);
}

registerProvider(serena);
registerProvider(cbm);

// `cairn context setup` installs providers into the workspace. Serena is the default; the
// code-graph tool (orientation summaries) is opt-in.
const SETUPS = { [serena.id]: serena.setup, [cbm.id]: cbm.setup };
const SETUP_DEFAULT = [serena.id];

function setupProvider(id, opts) {
  if (!SETUPS[id]) throw new Error(`no setup for provider "${id}" (known: ${Object.keys(SETUPS).join(', ')})`);
  return SETUPS[id](opts);
}

const FLAT_KEYS = ['command', 'args', 'version', 'allowGlobal'];

function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const flat = FLAT_KEYS.some((k) => k in cfg);
  return {
    routes: cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {},
    block: (id) => (cfg[id] && typeof cfg[id] === 'object' ? cfg[id] : flat && id === cbm.id ? cfg : {}),
  };
}

// `memoMs`: passed through to providers that cache freshness in-process — forever for a
// one-shot CLI run, a few seconds for a long-lived server.
function createCodeSource({ config, workspaceDir, memoMs = Infinity }) {
  const cfg = normalizeConfig(config);
  const instances = new Map();

  const get = (id) => {
    if (!instances.has(id)) instances.set(id, registry.get(id).create({ config: cfg.block(id), workspaceDir, memoMs }));
    return instances.get(id);
  };

  const unknown = (reason, hint = HINT) => ({ status: 'unknown', reason, hint });

  // -> { instance } | { error } | null (nothing available for this capability)
  function resolve(capability) {
    const wanted = cfg.routes[capability];
    if (wanted) {
      const p = registry.get(wanted);
      if (!p) return { error: `unknown provider "${wanted}" for ${capability} (known: ${[...registry.keys()].join(', ')})` };
      if (!p.capabilities.includes(capability)) return { error: `provider "${wanted}" does not provide ${capability}` };
      return { instance: get(wanted) };
    }
    // Preference order first, then any other registered provider that has the capability —
    // so a provider for a new language registers itself without touching this table.
    const order = [...(DEFAULT_ROUTING[capability] || []), ...registry.keys()];
    for (const id of new Set(order)) {
      const p = registry.get(id);
      if (!p || !p.capabilities.includes(capability)) continue;
      const instance = get(id);
      if (instance.available()) return { instance };
    }
    return null;
  }

  // Providers may answer synchronously (a one-shot CLI) or asynchronously (a long-lived
  // language server); the facade is async either way.
  async function via(capability, method, repo, ...args) {
    const r = resolve(capability);
    if (r && r.error) return unknown(r.error, 'check the codeSource.providers block in repos.json');
    if (!r) return unknown(`no code provider available for ${capability}`);
    if (typeof r.instance[method] !== 'function') return unknown(`provider "${r.instance.id}" does not implement ${method}`);
    return r.instance[method](repo, ...args);
  }

  return {
    // Is something able to answer this capability (or, with none given, any capability)?
    available(capability) {
      const caps = capability ? [capability] : CAPABILITIES;
      return caps.some((c) => {
        const r = resolve(c);
        return Boolean(r && r.instance && r.instance.available());
      });
    },

    // capability -> id of the provider that would answer it, or null.
    describe() {
      return Object.fromEntries(
        CAPABILITIES.map((c) => {
          const r = resolve(c);
          return [c, r && r.instance ? r.instance.id : null];
        }),
      );
    },

    symbol: (repo, name) => via('symbols', 'symbol', repo, name),
    // `opts.file` pins the file when a name is ambiguous; providers may accept more.
    references: (repo, symbolPath, opts) => via('references', 'references', repo, symbolPath, opts),
    summary: (repo) => via('summary', 'summary', repo),

    // (Re)index a repo if the answering provider keeps an index. Mostly for `code index`.
    async index(repo) {
      for (const c of ['symbols', 'summary']) {
        const r = resolve(c);
        if (r && r.instance && typeof r.instance.index === 'function') return r.instance.index(repo);
      }
      return unknown('no available provider keeps an index');
    },

    // Stop anything long-lived a provider started (language servers). Safe to call twice.
    async close() {
      const open = [...instances.values()];
      instances.clear();
      await Promise.all(open.map((i) => (typeof i.close === 'function' ? i.close() : null)));
    },

    // Synchronous best-effort kill for a `process.on('exit')` handler, where nothing async runs.
    closeSync() {
      for (const i of instances.values()) if (typeof i.closeSync === 'function') i.closeSync();
      instances.clear();
    },
  };
}

module.exports = {
  createCodeSource,
  registerProvider,
  setupProvider,
  SETUP_PROVIDERS: Object.keys(SETUPS),
  SETUP_DEFAULT,
  CAPABILITIES,
  DEFAULT_ROUTING,
  // `cairn context setup` and the tests still reach the codebase-memory-mcp helpers here.
  setup: cbm.setup,
  resolveRunner: cbm.resolveRunner,
  fingerprint: cbm.fingerprint,
  toolDir: cbm.toolDir,
  cacheDir: cbm.cacheDir,
  installedBinary: cbm.installedBinary,
  PINNED_VERSION: cbm.PINNED_VERSION,
  CodeSourceError: cbm.CodeSourceError,
};
