'use strict';

// What the interactive shell knows about where it was started: is the folder a cairn repo, is it
// part of a workspace (a repos.json), and how do the stamped versions compare with the cairn that
// is running. Read-only and forgiving: a broken config shows up as a note, never as an exception,
// because the shell must still start so the user can see and fix it.

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME } = require('../config');
const { readJsonFile } = require('../json');
const { readWorkspaceConfig } = require('../workspace-config');

const WORKSPACE_FILE = 'repos.json';
const WORKSPACE_SEARCH_LEVELS = 4;

function readRepo(dir) {
  const file = path.join(dir, CONFIG_NAME);
  const base = { path: dir, name: path.basename(dir) || dir, managed: false, note: null };
  if (!fs.existsSync(file)) return base;
  try {
    const cfg = readJsonFile(file);
    const stack = Array.isArray(cfg.stack) ? cfg.stack : cfg.stack ? [cfg.stack] : [];
    return {
      ...base,
      managed: true,
      stamp: typeof cfg.cairn === 'string' ? cfg.cairn : null,
      stack,
      hosts: Array.isArray(cfg.hosts) && cfg.hosts.length ? cfg.hosts : ['claude'],
      tracker: cfg.tracker && cfg.tracker.provider ? cfg.tracker.provider : 'none',
    };
  } catch (err) {
    return { ...base, managed: true, stamp: null, stack: [], hosts: [], tracker: null, note: err.message };
  }
}

// The nearest folder up from `start` that holds cairn.config.json, or null.
function findManagedRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_NAME))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// repos.json in `start` or a few folders up; a workspace is usually the folder above the repos.
function findWorkspaceFile(start) {
  let dir = path.resolve(start);
  for (let i = 0; i <= WORKSPACE_SEARCH_LEVELS; i++) {
    const file = path.join(dir, WORKSPACE_FILE);
    if (fs.existsSync(file)) return file;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

function readWorkspace(file) {
  try {
    const raw = readWorkspaceConfig(file);
    const dir = path.dirname(file);
    return {
      file,
      note: null,
      repos: raw.repos.map((r) => {
        const abs = path.resolve(dir, r.path);
        const repo = readRepo(abs);
        return { name: r.name, path: abs, exists: fs.existsSync(abs), managed: repo.managed, stamp: repo.stamp || null };
      }),
    };
  } catch (err) {
    return { file, repos: [], note: err.message };
  }
}

// { cwd, running, repo, workspace }
//   repo       the cairn repo containing `cwd` (managed: true), or `cwd` itself as an unmanaged folder
//   workspace  { file, repos: [{ name, path, exists, managed, stamp }], note } or null
function agentCommandsStatus(home) {
  try {
    return require('../host-commands').status({ home });
  } catch {
    return [];
  }
}

function detectState(cwd = process.cwd(), running = require('../../package.json').version, home = require('../host-commands').defaultHome()) {
  const start = path.resolve(cwd);
  const root = findManagedRoot(start);
  const repo = readRepo(root || start);
  const wsFile = findWorkspaceFile(start);
  return { cwd: start, running, home, repo, workspace: wsFile ? readWorkspace(wsFile) : null, agentCommands: agentCommandsStatus(home) };
}

module.exports = { detectState, findManagedRoot, findWorkspaceFile, readWorkspace, readRepo, WORKSPACE_FILE };
