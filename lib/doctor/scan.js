'use strict';

const fs = require('fs');
const path = require('path');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minimal glob: `*` matches within one segment, `**` matches across segments.
// Enough for the path shapes in repos.json; deliberately not a full glob engine.
function globToRegex(glob) {
  const pattern = glob
    .split('/')
    .map((seg) => {
      if (seg === '**') return '(?:.+)';
      return seg
        .split('*')
        .map(escapeRe)
        .join('[^/]*');
    })
    .join('/');
  return new RegExp(`^${pattern}$`);
}

// The fixed directory prefix of a glob — everything before the first wildcard.
// Lets us walk only what a rule can possibly match instead of the whole repo,
// which matters because ai/tasks/ holds thousands of files no rule targets.
function globBase(glob) {
  const segs = glob.split('/');
  const out = [];
  for (const seg of segs) {
    if (seg.includes('*')) break;
    out.push(seg);
  }
  // Drop the filename when the glob has no wildcard at all (exact-path rule).
  if (out.length === segs.length) out.pop();
  return out.join('/');
}

function walk(root, relBase, recursive, acc) {
  const abs = relBase ? path.join(root, relBase) : root;
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return acc; // Missing directory is a finding, not an error — handled by caller.
  }
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (recursive && entry.name !== 'node_modules' && !entry.name.startsWith('.git')) {
        walk(root, rel, recursive, acc);
      }
    } else if (entry.isFile()) {
      acc.push(rel);
    }
  }
  return acc;
}

// Relative paths in `repo` matching `rule`, sorted.
function matchRule(repoPath, rule) {
  const re = globToRegex(rule.glob);
  const excludes = (rule.exclude || []).map(globToRegex);
  const base = globBase(rule.glob);
  const recursive = rule.glob.includes('**');

  const found = walk(repoPath, base, recursive, []);
  return found
    .filter((rel) => re.test(rel))
    .filter((rel) => !excludes.some((ex) => ex.test(rel)))
    .sort();
}

function readFile(repoPath, rel) {
  try {
    return fs.readFileSync(path.join(repoPath, rel), 'utf8');
  } catch {
    return null;
  }
}

module.exports = { matchRule, readFile, globToRegex, escapeRe };
