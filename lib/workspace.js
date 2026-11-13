'use strict';

// The workspace a repo belongs to, as the renderer sees it: the sibling repos
// listed in the same `repos.json` that `cairn doctor` / `cairn context` read.
//
// Looked for at `config.workspace` (path relative to the repo) or, by default,
// `../repos.json`. A repo that is not itself listed there, or a workspace with
// no other repo in it, has no workspace — the templates then emit nothing.

const fs = require('fs');
const { readJsonFile } = require('./json');
const { validateWorkspace } = require('./workspace-config');
const path = require('path');

const { loadRepoConfig, normalizeStack } = require('./config');

function samePath(p) {
  const norm = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function workspaceContext(repoPath, config = {}, { includeSingle = false } = {}) {
  if (!repoPath) return null;

  const file = path.resolve(repoPath, config.workspace || path.join('..', 'repos.json'));
  if (!fs.existsSync(file)) return null;

  // The file is found by convention (`../repos.json`), so valid JSON that is not a workspace
  // config is somebody else's file and is skipped; one that cannot be read or parsed is an error.
  const raw = readJsonFile(file);
  if (!raw || !Array.isArray(raw.repos)) return null;
  validateWorkspace(raw, file);

  const dir = path.dirname(file);
  const members = raw.repos.map((entry) => ({ entry, abs: path.resolve(dir, entry.path) }));
  const here = samePath(repoPath);
  if (!members.some((m) => samePath(m.abs) === here)) return null;

  const siblings = members
    .filter((m) => samePath(m.abs) !== here)
    .map(({ entry, abs }) => {
      let stack = entry.stack;
      if (!stack) {
        try {
          stack = loadRepoConfig(abs).stack;
        } catch {
          stack = null;
        }
      }
      return {
        name: entry.name,
        path: toPosix(path.relative(repoPath, abs)),
        stack: normalizeStack(stack).join(', '),
        role: entry.role || '—',
      };
    });
  if (!siblings.length && !includeSingle) return null;

  return { file: toPosix(path.relative(repoPath, file)), count: members.length, siblings };
}

module.exports = { workspaceContext };
