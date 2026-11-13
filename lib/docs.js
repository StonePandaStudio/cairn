'use strict';

// `docs` in cairn.config.json: knowledge about the project that lives outside `ai/contexts/` —
// an existing `docs/` folder, an architecture file — listed so the agents read it.
//
//   "docs": [
//     { "path": "docum/arch-backend.md", "about": "backend layers", "when": "a backend domain, service or DAO changes" },
//     "docum/api.md"
//   ]
//
// An entry is a path relative to the repo (a file, or a folder whose own index the agents open), or an
// object with that `path` plus an optional `about` and `when`. cairn does not read these files: it
// lists them in `ai/AGENTS.md` and tells the role agents to consult them.

const path = require('path');
const { UserError } = require('./errors');

const DEFAULT_WHEN = 'the task touches this area';

// Entries as the config wrote them -> [{ path, about, when }] with the defaults filled in, or null
// when there are none. Throws a UserError naming the entry on a malformed one.
function normalizeDocs(value, file = 'cairn.config.json') {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new UserError(`${file}: docs must be an array of paths or { "path", "about", "when" } objects`);
  const seen = new Set();
  const out = [];
  value.forEach((entry, i) => {
    const where = `${file}: docs[${i}]`;
    const raw = typeof entry === 'string' ? { path: entry } : entry;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new UserError(`${where} must be a path or an object with a "path"`);
    }
    for (const key of ['path', 'about', 'when']) {
      if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new UserError(`${where}.${key} must be a string`);
    }
    const rel = String(raw.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!rel) throw new UserError(`${where}.path is required`);
    if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) throw new UserError(`${where}.path must be relative to the repo, not "${rel}"`);
    if (seen.has(rel)) throw new UserError(`${where}.path "${rel}" is listed twice`);
    seen.add(rel);
    const cell = (text, fallback) => (String(text || '').trim() || fallback).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
    out.push({ path: rel, about: cell(raw.about, '—'), when: cell(raw.when, DEFAULT_WHEN) });
  });
  return out.length ? out : null;
}

module.exports = { normalizeDocs, DEFAULT_WHEN };
