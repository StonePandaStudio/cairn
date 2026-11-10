'use strict';

// Code provider: Serena (https://github.com/oraios/serena) — an MCP server that fronts
// real language servers (LSP), so symbol and reference answers are compiler-grade and
// language-neutral: cairn itself knows nothing about TypeScript, Java or C#; Serena picks
// the language server per project (~60 supported; only TypeScript/NestJS has been
// measured here — 99% caller recall on three repos, no references to files that do not
// mention the symbol).
//
// Capabilities: `symbols` and `references`. (Not `summary`: Serena has no repo overview.)
//
//   - Installed per *workspace*, version-pinned, into `<workspace>/_cairn/tools/serena/`:
//     a Python venv plus a private SERENA_HOME (language servers download there).
//     Never global, so a stale project keeps the version it was tested with.
//   - Read-only by construction: setup writes `fixed_tools` into that private config, so
//     Serena itself exposes only five read tools — no editing, shell or memory tools.
//     This provider additionally calls just `find_symbol` and `find_referencing_symbols`.
//   - Long-lived: one Serena process per repo, started lazily on the first question and
//     reused (a cold language server takes ~20s; later calls ~0.3s). Calls are queued per
//     repo, a crashed process is restarted once, a hung call times out and kills the
//     process tree, and everything is stopped on `close()` / process exit.
//   - Serena writes `.serena/` into each project it opens; `setup` gitignores it.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const { CodeSourceError, toPosix, appendIgnore } = require('./common');

const ID = 'serena';
const PACKAGE = 'serena-agent';
const PINNED_VERSION = '2.1.0';
// Serena 2.1.0 needs Python >=3.11,<3.15 (its package metadata).
const PY_MIN = [3, 11];
const PY_MAX = [3, 14];

// The only tools Serena is allowed to expose (config) and the only ones this provider calls.
const READ_ONLY_TOOLS = ['find_symbol', 'find_referencing_symbols', 'get_symbols_overview', 'find_implementations', 'find_declaration'];

const START_TIMEOUT_MS = 120000;
const FIRST_CALL_TIMEOUT_MS = 300000; // includes starting/warming the language server
const CALL_TIMEOUT_MS = 60000;
const GRACE_MS = 3000; // how long a closing Serena gets to exit by itself before its tree is killed
const DEFAULT_FILE_LIMIT = 100;

const HINT = 'run `cairn context setup` to install Serena into this workspace';

// Provider-owned heuristic for "this reference is in a test" — the core has no idea what a
// test file looks like in any language. Deliberately broad; callers can ask for tests.
const TEST_PATH = [
  /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|testing)\//i,
  /\.(spec|test|e2e-spec|e2e|stories)\.[cm]?[jt]sx?$/i,
  /(Tests?|Spec|IT)\.(java|kt|cs|scala)$/,
  /_test\.(go|py|rs)$/,
  /(^|\/)test_[^/]+\.py$/,
];
const isTestPath = (p) => TEST_PATH.some((re) => re.test(p));

// ---- install layout --------------------------------------------------------

const toolDir = (workspaceDir) => path.join(workspaceDir, '_cairn', 'tools', 'serena');
const venvDir = (workspaceDir) => path.join(toolDir(workspaceDir), 'venv');
const homeDir = (workspaceDir) => path.join(toolDir(workspaceDir), 'home');
const metaFile = (workspaceDir) => path.join(toolDir(workspaceDir), 'cairn-tool.json');

function installedBinary(workspaceDir) {
  const exe = process.platform === 'win32' ? path.join(venvDir(workspaceDir), 'Scripts', 'serena.exe') : path.join(venvDir(workspaceDir), 'bin', 'serena');
  return fs.existsSync(exe) ? exe : null;
}

function installedVersion(workspaceDir) {
  try {
    return JSON.parse(fs.readFileSync(metaFile(workspaceDir), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Where to find Serena. `config` is this provider's block:
//   { "command": "...", "args": [...], "env": {...}, "home": "...", "version": "...",
//     "allowGlobal": false, "timeoutMs": 60000, "firstCallTimeoutMs": 300000 }
// Order: explicit command, then the workspace install, then (opt-in only) PATH.
function resolveRunner(config, workspaceDir) {
  const cfg = config && typeof config === 'object' ? config : {};
  if (cfg.command) {
    return {
      command: cfg.command,
      args: Array.isArray(cfg.args) ? cfg.args : [],
      env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
      home: cfg.home || null,
      version: cfg.version || 'custom',
      source: 'config',
    };
  }
  const bin = installedBinary(workspaceDir);
  if (bin) return { command: bin, args: [], env: {}, home: homeDir(workspaceDir), version: installedVersion(workspaceDir), source: 'workspace' };
  if (cfg.allowGlobal) return { command: 'serena', args: [], env: {}, home: null, version: 'global', source: 'path' };
  return null;
}

// ---- one long-lived Serena process per repo --------------------------------

function killTree(child) {
  if (!child || child.pid == null || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      cp.spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL'); // the child leads its own process group (detached)
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

class Session {
  constructor(runner, repo, timeouts) {
    this.runner = runner;
    this.repo = repo;
    this.timeouts = timeouts;
    this.child = null;
    this.starting = null;
    this.pending = new Map();
    this.nextId = 0;
    this.buf = '';
    this.stderrTail = '';
    this.calls = 0; // calls made on the current process (the first is the slow one)
    this.queue = Promise.resolve();
  }

  // A process died (or was killed): fail only the requests it owned. A killed process's
  // `exit` event can arrive after its replacement has started — it must not touch the new one.
  _fail(child, err) {
    for (const [id, p] of this.pending) {
      if (p.child !== child) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(err);
    }
    if (this.child === child) {
      this.child = null;
      this.starting = null;
    }
  }

  _spawn() {
    const { runner, repo } = this;
    const args = [
      ...runner.args,
      'start-mcp-server',
      '--project', repo.path,
      '--enable-web-dashboard', 'false',
      '--open-web-dashboard', 'false',
      '--agent-interface', 'tools',
    ];
    const env = { ...process.env, ...runner.env };
    if (runner.home) env.SERENA_HOME = runner.home;

    const child = cp.spawn(runner.command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32', // own process group, so the whole tree can be killed
    });
    this.child = child;
    this.buf = '';
    this.stderrTail = '';
    this.calls = 0;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not protocol (a stray log line)
        }
        const p = msg.id != null ? this.pending.get(msg.id) : null;
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new CodeSourceError(`serena: ${msg.error.message || JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000);
    });
    child.on('error', (err) => this._fail(child, new CodeSourceError(`cannot run ${runner.command}: ${err.message}`, 'unavailable')));
    child.on('exit', (code, signal) => {
      const tail = this.stderrTail.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
      this._fail(child, new CodeSourceError(`serena exited (${signal || code})${tail ? `: ${tail}` : ''}`, 'exited'));
    });
    return child;
  }

  _request(method, params, timeoutMs) {
    const child = this.child;
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A hung Serena is not trusted again: kill the tree so the next call starts clean.
        killTree(child);
        this._fail(child, new CodeSourceError(`serena ${method} timed out after ${timeoutMs} ms`, 'timeout'));
        reject(new CodeSourceError(`serena ${method} timed out after ${timeoutMs} ms`, 'timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, child });
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new CodeSourceError(`serena stdin closed: ${err.message}`, 'exited'));
      }
    });
  }

  async _ensureStarted() {
    if (this.child && this.starting) return this.starting;
    this._spawn();
    const child = this.child;
    this.starting = (async () => {
      await this._request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cairn', version: '0' } }, this.timeouts.start);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    })();
    try {
      await this.starting;
    } catch (err) {
      killTree(child);
      if (this.child === child) {
        this.child = null;
        this.starting = null;
      }
      throw err;
    }
  }

  async _callOnce(name, args) {
    await this._ensureStarted();
    const ms = this.calls === 0 ? this.timeouts.firstCall : this.timeouts.call;
    const result = await this._request('tools/call', { name, arguments: args }, ms);
    this.calls++;
    const text = result && result.content && result.content[0] && result.content[0].text;
    if (result && result.isError) throw new CodeSourceError(`serena ${name}: ${String(text).slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new CodeSourceError(`serena ${name}: unparseable answer — ${String(text).slice(0, 200)}`);
    }
  }

  // Queued per repo; a Serena that died is restarted and the (read-only) call retried once.
  call(name, args) {
    const run = async () => {
      try {
        return await this._callOnce(name, args);
      } catch (err) {
        if (err instanceof CodeSourceError && err.code === 'exited') return this._callOnce(name, args);
        throw err;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.starting = null;
    const exited = new Promise((resolve) => child.once('exit', () => resolve('exit')));
    try {
      child.stdin.end(); // Serena shuts down on EOF (measured: ~0.2–0.6 s) and takes its language servers with it
    } catch {
      /* already closed */
    }
    const outcome = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('grace'), GRACE_MS))]);
    if (outcome === 'grace') killTree(child);
  }

  closeSync() {
    const child = this.child;
    this.child = null;
    this.starting = null;
    killTree(child);
  }
}

// ---- answers ---------------------------------------------------------------

const lastSegment = (namePath) => String(namePath).split('/').pop().replace(/\[\d+\]$/, '');
const lines = (loc) => (loc && loc.start_line != null ? `${loc.start_line}-${loc.end_line}` : null);

function toMatch(item) {
  return {
    name: lastSegment(item.name_path),
    namePath: item.name_path,
    label: item.kind,
    file: toPosix(item.relative_path || ''),
    lines: lines(item.body_location),
  };
}

// ---- the provider ----------------------------------------------------------

function create({ config, workspaceDir }) {
  const cfg = config && typeof config === 'object' ? config : {};
  const runner = resolveRunner(cfg, workspaceDir);
  const timeouts = {
    start: cfg.startTimeoutMs || START_TIMEOUT_MS,
    firstCall: cfg.firstCallTimeoutMs || FIRST_CALL_TIMEOUT_MS,
    call: cfg.timeoutMs || CALL_TIMEOUT_MS,
  };
  const sessions = new Map(); // repo path -> Session

  const unknown = (reason, hint = HINT) => ({ status: 'unknown', reason, hint });

  const sessionFor = (repo) => {
    const key = toPosix(path.resolve(repo.path));
    if (!sessions.has(key)) sessions.set(key, new Session(runner, { ...repo, path: key }, timeouts));
    return sessions.get(key);
  };

  async function guarded(repo, fn) {
    if (!runner) return unknown('Serena is not installed');
    if (!fs.existsSync(repo.path)) return unknown(`repo path not found: ${repo.path}`, 'check repos.json');
    try {
      return await fn(sessionFor(repo));
    } catch (err) {
      if (err instanceof CodeSourceError) return unknown(err.message, err.code === 'unavailable' ? HINT : 'see the message above');
      throw err;
    }
  }

  return {
    id: ID,
    available: () => Boolean(runner),

    // Does a symbol with exactly this name exist? Language-neutral: Serena asks the repo's
    // language server. `found` / `missing`.
    symbol(repo, name) {
      return guarded(repo, async (s) => {
        const out = await s.call('find_symbol', { name_path_pattern: name });
        const matches = (Array.isArray(out) ? out : []).map(toMatch);
        return { status: matches.length ? 'found' : 'missing', provider: ID, matches };
      });
    },

    // Where is a symbol referenced? `symbolPath` is a Serena name path (`Class/method`;
    // overloaded symbols carry `[0]`, `[1]`, …). Resolves the symbol first (Serena needs its
    // file); an ambiguous name returns the candidates and the caller pins one with `opts.file`.
    //   opts: { file, includeTests = false, limit = 100 }
    references(repo, symbolPath, opts = {}) {
      return guarded(repo, async (s) => {
        const found = await s.call('find_symbol', { name_path_pattern: symbolPath, ...(opts.file ? { relative_path: opts.file } : {}) });
        const candidates = (Array.isArray(found) ? found : []).map(toMatch);
        if (!candidates.length) return { status: 'missing', provider: ID, symbolPath };
        if (candidates.length > 1) return { status: 'ambiguous', provider: ID, symbolPath, candidates, hint: 'pass { file } to choose one' };

        const target = candidates[0];
        const raw = await s.call('find_referencing_symbols', { name_path: target.namePath, relative_path: target.file });

        const limit = opts.limit || DEFAULT_FILE_LIMIT;
        const refs = [];
        let testsOmitted = 0;
        for (const [file, byKind] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
          const f = toPosix(file);
          if (!opts.includeTests && isTestPath(f)) {
            testsOmitted++;
            continue;
          }
          const symbols = [];
          for (const [kind, items] of Object.entries(byKind || {})) {
            for (const it of Array.isArray(items) ? items : []) {
              symbols.push({ namePath: it.name_path, kind, lines: lines(it.body_location), context: it.content_around_reference });
            }
          }
          refs.push({ file: f, symbols });
        }
        refs.sort((a, b) => a.file.localeCompare(b.file));

        return {
          status: 'ok',
          provider: ID,
          symbol: target,
          references: refs.slice(0, limit),
          truncated: refs.length > limit,
          testFilesOmitted: testsOmitted,
        };
      });
    },

    async close() {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((s) => s.close()));
    },

    closeSync() {
      for (const s of sessions.values()) s.closeSync();
      sessions.clear();
    },
  };
}

// ---- setup -----------------------------------------------------------------

function pythonVersion(command, preArgs = []) {
  const r = cp.spawnSync(command, [...preArgs, '-c', "import sys;print('%d.%d' % sys.version_info[:2])"], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const m = /^(\d+)\.(\d+)/.exec((r.stdout || '').trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const inRange = (v) => v && v[0] === PY_MIN[0] && v[1] >= PY_MIN[1] && v[1] <= PY_MAX[1];

// The first Python in 3.11–3.14 we can find: an explicit one, then the usual names.
function findPython(explicit) {
  const candidates = explicit ? [[explicit, []]] : [['python3', []], ['python', []], ['py', ['-3']]];
  for (const [command, pre] of candidates) {
    const v = pythonVersion(command, pre);
    if (inRange(v)) return { command, pre, version: v.join('.') };
  }
  return null;
}

// Install the pinned Serena into `<workspace>/_cairn/tools/serena/` (a venv — nothing
// global), write a private read-only config, and gitignore what must not be committed.
// Never touches ~/.serena. Throws CodeSourceError if Python (3.11–3.14) is missing or pip fails.
function setup({ workspaceDir, repos = [], version = PINNED_VERSION, install = true, python }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new CodeSourceError(`not an exact version: ${version}`);
  const dir = toolDir(workspaceDir);
  const report = { dir, version, ignored: [] };

  if (install) {
    const py = findPython(python);
    if (!py) {
      throw new CodeSourceError(
        `Serena ${version} needs Python ${PY_MIN.join('.')}–${PY_MAX.join('.')}; none found on PATH. Install one, or pass { python } / set codeSource.serena.python.`,
        'prerequisite',
      );
    }
    report.python = py.version;
    fs.mkdirSync(dir, { recursive: true });

    if (!installedBinary(workspaceDir)) {
      const venv = cp.spawnSync(py.command, [...py.pre, '-m', 'venv', venvDir(workspaceDir)], { encoding: 'utf8', windowsHide: true, timeout: 300000 });
      if (venv.status !== 0) throw new CodeSourceError(`python -m venv failed: ${(venv.stderr || venv.stdout || '').trim().slice(-400)}`);
    }
    if (installedVersion(workspaceDir) !== version) {
      const venvPython = process.platform === 'win32' ? path.join(venvDir(workspaceDir), 'Scripts', 'python.exe') : path.join(venvDir(workspaceDir), 'bin', 'python');
      const pip = cp.spawnSync(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--quiet', `${PACKAGE}==${version}`], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 900000,
      });
      if (pip.status !== 0) {
        const out = `${pip.stderr || ''}\n${pip.stdout || ''}`;
        // Windows MAX_PATH: one of Serena's dependencies has ~130 characters of path below the venv root.
        if (/long path/i.test(out)) {
          throw new CodeSourceError(
            `pip hit the Windows path-length limit: the venv would live at ${toPosix(venvDir(workspaceDir))} (${venvDir(workspaceDir).length} chars; keep it under ~125). ` +
              'Enable Windows long paths (https://pip.pypa.io/warnings/enable-long-paths) or run setup from a shallower workspace folder.',
            'prerequisite',
          );
        }
        throw new CodeSourceError(`pip install ${PACKAGE}==${version} failed: ${out.trim().slice(-400)}`);
      }
      fs.writeFileSync(metaFile(workspaceDir), JSON.stringify({ package: PACKAGE, version, installedAt: new Date().toISOString() }, null, 2) + '\n');
    }

    // A private config: Serena exposes only the read tools, whatever the client asks for.
    // Written only if absent, so a hand-tuned file survives; Serena fills in the rest itself.
    const home = homeDir(workspaceDir);
    fs.mkdirSync(home, { recursive: true });
    const cfgFile = path.join(home, 'serena_config.yml');
    if (!fs.existsSync(cfgFile)) fs.writeFileSync(cfgFile, `projects: []\nfixed_tools: [${READ_ONLY_TOOLS.join(', ')}]\n`);
  }
  report.binary = installedBinary(workspaceDir);
  report.installed = installedVersion(workspaceDir);

  const wsIgnore = path.join(workspaceDir, '.gitignore');
  if (fs.existsSync(path.join(workspaceDir, '.git')) || fs.existsSync(wsIgnore)) {
    if (appendIgnore(wsIgnore, '_cairn/tools/')) report.ignored.push(toPosix(wsIgnore));
  }
  // Each repo: Serena writes `.serena/` into every project it opens.
  for (const repo of repos) {
    if (!fs.existsSync(path.join(repo.path, '.git'))) continue;
    const f = path.join(repo.path, '.gitignore');
    if (appendIgnore(f, '.serena/')) report.ignored.push(toPosix(f));
  }
  return report;
}

module.exports = {
  id: ID,
  capabilities: ['symbols', 'references'],
  create,
  setup,
  resolveRunner,
  toolDir,
  installedBinary,
  isTestPath,
  PINNED_VERSION,
  READ_ONLY_TOOLS,
  CodeSourceError,
};
