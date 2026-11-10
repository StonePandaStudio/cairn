'use strict';

// Code provider: `codebase-memory-mcp` — a third-party code-graph tool, delegated to
// because cairn ships NO code parser (DESIGN.md "The boundary (Q4)").
//
// Capabilities: `symbols` (does a named symbol exist) and `summary` (architecture
// overview). It is NOT used for `references`: its call graph does not resolve tsconfig
// path aliases (measured 2026-11-10: 20% caller recall on three NestJS repos), so a
// "0 callers" answer would be silently wrong.
//
//   - Installed per *workspace*, version-pinned, in `<workspace>/_cairn/tools/
//     codebase-memory-mcp/` — never global, so a stale project keeps the binary it
//     was tested with (`cairn context setup`).
//   - Run one-shot (`cli --json <tool>`, JSON on stdin): no long-lived process to
//     manage. ~1.9s startup per call, measured; the fingerprint gate below keeps a
//     lookup to a single spawn in the common case.
//   - One index per repo, in `<repo>/_cairn/cache/` (gitignored), by pointing the
//     tool's CBM_CACHE_DIR there.
//   - Freshness is cairn's job (the tool's watcher only covers a live MCP session):
//     a cheap git fingerprint decides whether to re-index before answering.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ID = 'codebase-memory-mcp';
const PACKAGE = 'codebase-memory-mcp';
const PINNED_VERSION = '0.12.1';
const CALL_TIMEOUT_MS = 180000;
const MAX_BUFFER = 128 * 1024 * 1024;

// Node labels that are never "a code symbol" — markdown sections under `ai/`,
// files, folders, routes. A symbol check must not be satisfied by a heading.
const NON_SYMBOL_LABELS = new Set(['Section', 'File', 'Folder', 'Project', 'Branch', 'Image', 'Process', 'Resource', 'Route', 'Module']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.angular', '.next', '_cairn', '.idea', '.claude']);

const { CodeSourceError, toPosix, appendIgnore } = require('./common');

function toolDir(workspaceDir) {
  return path.join(workspaceDir, '_cairn', 'tools', PACKAGE);
}

function cacheDir(repoPath) {
  return path.join(repoPath, '_cairn', 'cache');
}

function installedBinary(workspaceDir) {
  const dir = path.join(toolDir(workspaceDir), 'node_modules', PACKAGE, 'bin');
  const candidates = process.platform === 'win32' ? [`${PACKAGE}.exe`] : [PACKAGE, `${PACKAGE}.exe`];
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function installedVersion(workspaceDir) {
  try {
    const pkg = path.join(toolDir(workspaceDir), 'node_modules', PACKAGE, 'package.json');
    return JSON.parse(fs.readFileSync(pkg, 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Where to find the tool. `config` is this provider's block:
//   { "command": "...", "args": [...], "version": "...", "allowGlobal": false }
// Order: explicit command, then the workspace install, then (opt-in only) PATH.
// A global version never leaks in by default — that is the point of pinning.
function resolveRunner(config, workspaceDir) {
  const cfg = config && typeof config === 'object' ? config : {};
  if (cfg.command) {
    return { command: cfg.command, args: Array.isArray(cfg.args) ? cfg.args : [], version: cfg.version || 'custom', source: 'config' };
  }
  const bin = installedBinary(workspaceDir);
  if (bin) return { command: bin, args: [], version: installedVersion(workspaceDir), source: 'workspace' };
  if (cfg.allowGlobal) return { command: PACKAGE, args: [], version: 'global', source: 'path' };
  return null;
}

const HINT = 'run `cairn context setup` to install the pinned code-graph tool into this workspace';

// ---- freshness fingerprint -------------------------------------------------

function git(cwd, args) {
  const r = cp.spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

function statSig(file) {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return 'gone';
  }
}

function walkSig(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.count > 50000) return;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walkSig(abs, acc);
    } else if (e.isFile()) {
      acc.count++;
      try {
        const m = fs.statSync(abs).mtimeMs;
        if (m > acc.max) acc.max = m;
      } catch {
        /* vanished */
      }
    }
  }
}

// A cheap "has the code changed since the last index" token. Git repos: HEAD plus
// every dirty path's mtime/size (a bare `status` line would not change when an
// already-modified file is edited again). The index folder itself is excluded or
// indexing would invalidate its own fingerprint. Non-git: newest mtime + file count.
function fingerprint(repoPath) {
  const h = crypto.createHash('sha1');
  const head = git(repoPath, ['rev-parse', 'HEAD']);
  const top = head === null ? null : (git(repoPath, ['rev-parse', '--show-toplevel']) || '').trim();
  if (head !== null && top) {
    h.update(`git:${head.trim()}\n`);
    const status = git(repoPath, ['status', '--porcelain', '-z', '--', '.', ':(exclude)_cairn/cache']) || '';
    const entries = status.split('\0').filter(Boolean);
    for (let i = 0; i < entries.length; i++) {
      const xy = entries[i].slice(0, 2);
      const rel = entries[i].slice(3);
      if (/[RC]/.test(xy)) i++; // a rename/copy is followed by its source path
      h.update(`${xy}|${rel}|${statSig(path.join(top, rel))}\n`);
    }
    return h.digest('hex');
  }
  const acc = { max: 0, count: 0 };
  walkSig(repoPath, acc);
  h.update(`fs:${acc.count}:${acc.max}`);
  return h.digest('hex');
}

const stateFile = (repoPath) => path.join(cacheDir(repoPath), 'fingerprint.json');

function readState(repoPath) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(repoPath), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(repoPath, state) {
  fs.mkdirSync(cacheDir(repoPath), { recursive: true });
  fs.writeFileSync(stateFile(repoPath), JSON.stringify(state, null, 2) + '\n');
}

// ---- running the tool ------------------------------------------------------

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function callTool(runner, repo, tool, args) {
  fs.mkdirSync(cacheDir(repo.path), { recursive: true });
  const res = cp.spawnSync(runner.command, [...runner.args, 'cli', '--json', tool], {
    input: JSON.stringify(args),
    encoding: 'utf8',
    env: { ...process.env, CBM_CACHE_DIR: cacheDir(repo.path) },
    timeout: CALL_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  if (res.error) throw new CodeSourceError(`cannot run ${runner.command}: ${res.error.message}`, 'unavailable');

  const envelope = tryParse(res.stdout);
  if (!envelope) {
    throw new CodeSourceError(`${tool}: unparseable output — ${(res.stdout || res.stderr || '').trim().slice(0, 200)}`);
  }
  const text = envelope.content && envelope.content[0] && envelope.content[0].text;
  const payload = envelope.structuredContent !== undefined ? envelope.structuredContent : tryParse(text) !== undefined ? tryParse(text) : text;
  if (envelope.isError || (payload && typeof payload === 'object' && payload.error)) {
    throw new CodeSourceError(`${tool}: ${(payload && payload.error) || text || 'tool reported an error'}`);
  }
  return payload;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- the provider ----------------------------------------------------------

// `repo` is `{ name, path }` (the `doctor.resolveRepos` shape). Every method returns an
// answer object with a `status`; none throws — an unavailable tool is `unknown` plus a
// hint, never a failure (DESIGN.md: "not wired -> unknown, with a hint").
//
// `memoMs`: how long "this repo is fresh" is trusted inside one process. One-shot CLI
// runs use the default (forever — the process is short). A long-lived server passes a
// few seconds so a repo edited mid-session is re-fingerprinted on the next question.
function create({ config, workspaceDir, memoMs = Infinity }) {
  const runner = resolveRunner(config, workspaceDir);
  const indexed = new Map(); // repo.path -> { project, at }

  const unknown = (reason, hint = HINT) => ({ status: 'unknown', reason, hint });

  function ensureIndexed(repo) {
    const key = toPosix(path.resolve(repo.path));
    const memo = indexed.get(key);
    if (memo && Date.now() - memo.at < memoMs) return { project: memo.project, reindexed: false };

    const fp = fingerprint(repo.path);
    const state = readState(repo.path);
    let result;
    if (state && state.fingerprint === fp && state.toolVersion === runner.version && state.project) {
      result = { project: state.project, reindexed: false };
    } else {
      const out = callTool(runner, repo, 'index_repository', { repo_path: key, mode: 'full' });
      if (!out || !out.project) throw new CodeSourceError('index_repository did not report a project name');
      writeState(repo.path, { fingerprint: fp, toolVersion: runner.version, project: out.project, indexedAt: new Date().toISOString() });
      result = { project: out.project, reindexed: true };
    }
    indexed.set(key, { project: result.project, at: Date.now() });
    return result;
  }

  function guarded(repo, fn) {
    if (!runner) return unknown('no code-graph tool installed');
    if (!fs.existsSync(repo.path)) return unknown(`repo path not found: ${repo.path}`, 'check repos.json');
    try {
      return fn();
    } catch (err) {
      if (err instanceof CodeSourceError) return unknown(err.message, err.code === 'unavailable' ? HINT : 'see the message above');
      throw err;
    }
  }

  return {
    id: ID,
    available: () => Boolean(runner),

    // (Re)index if the repo changed since the last index. Mostly for `cairn context code index`.
    index(repo) {
      return guarded(repo, () => ({ status: 'ok', ...ensureIndexed(repo) }));
    },

    // The tool's architecture summary for one repo, as the tool reports it.
    summary(repo) {
      return guarded(repo, () => {
        const { project, reindexed } = ensureIndexed(repo);
        const data = callTool(runner, repo, 'get_architecture', { project, format: 'json' });
        return { status: 'ok', project, reindexed, data };
      });
    },

    // Does a symbol with exactly this name exist in the repo? `found` / `missing`.
    symbol(repo, name) {
      return guarded(repo, () => {
        const { project, reindexed } = ensureIndexed(repo);
        const data = callTool(runner, repo, 'search_graph', { project, name_pattern: `^${escapeRe(name)}$`, format: 'json' });
        const cols = (data && data.cols) || [];
        const iName = cols.indexOf('name');
        const iLabel = cols.indexOf('label');
        const iLines = cols.indexOf('lines');
        const matches = [];
        for (const g of (data && data.groups) || []) {
          for (const row of g.rows || []) {
            const label = row[iLabel];
            if (NON_SYMBOL_LABELS.has(label)) continue;
            matches.push({ name: row[iName], label, file: g.file, lines: row[iLines] });
          }
        }
        return { status: matches.length ? 'found' : 'missing', project, reindexed, matches };
      });
    },
  };
}

// ---- setup -----------------------------------------------------------------

// Install the pinned tool into `<workspace>/_cairn/tools/codebase-memory-mcp/` and
// gitignore what must not be committed. Never runs the tool's own `install` (that
// rewrites the user's agent client configs). Returns a report; throws on npm failure.
function setup({ workspaceDir, repos = [], version = PINNED_VERSION, install = true }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new CodeSourceError(`not an exact version: ${version}`);
  const report = { dir: toolDir(workspaceDir), version, ignored: [] };

  if (install) {
    fs.mkdirSync(report.dir, { recursive: true });
    const r = cp.spawnSync(`npm install --prefix "${report.dir}" --save-exact --no-audit --no-fund ${PACKAGE}@${version}`, {
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      timeout: 600000,
    });
    if (r.status !== 0) throw new CodeSourceError(`npm install failed: ${(r.stderr || r.stdout || '').trim().slice(-400)}`);
  }
  report.binary = installedBinary(workspaceDir);
  report.installed = installedVersion(workspaceDir);

  // Workspace: `_cairn/tools/` (hundreds of MB). Only if it is under version control.
  const wsGit = path.join(workspaceDir, '.git');
  const wsIgnore = path.join(workspaceDir, '.gitignore');
  if (fs.existsSync(wsGit) || fs.existsSync(wsIgnore)) {
    if (appendIgnore(wsIgnore, '_cairn/tools/')) report.ignored.push(toPosix(wsIgnore));
  }
  // Each repo: its index folder.
  for (const repo of repos) {
    if (!fs.existsSync(path.join(repo.path, '.git'))) continue;
    const f = path.join(repo.path, '.gitignore');
    if (appendIgnore(f, '_cairn/cache/')) report.ignored.push(toPosix(f));
  }
  return report;
}

module.exports = {
  id: ID,
  capabilities: ['symbols', 'summary'],
  create,
  setup,
  resolveRunner,
  fingerprint,
  toolDir,
  cacheDir,
  installedBinary,
  PINNED_VERSION,
  CodeSourceError,
};
