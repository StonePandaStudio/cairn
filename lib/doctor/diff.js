'use strict';

// Line diff utilities with no external dependencies.
//
// Full LCS backtracking is O(n*m) in both time and memory, which is fine for the
// agent/command markdown files this tool compares (a few hundred lines each) but
// not for anything pathological. Past MAX_CELLS we fall back to a multiset
// estimate that gets the counts right without producing usable hunks.

const MAX_CELLS = 4_000_000;

function splitLines(text) {
  const lines = text.split('\n');
  // A trailing newline yields a final empty element that is not a real line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Returns an array of ['=' | '-' | '+', line] ops turning `a` into `b`,
// or null when the input is too large for the LCS table.
function diffOps(a, b) {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push(['=', a[i]]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push(['-', a[i]]);
      i++;
    } else {
      ops.push(['+', b[j]]);
      j++;
    }
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

// Multiset fallback: how many lines of each side have no partner on the other.
// Ignores ordering, so it under-reports pure moves — acceptable for a size guard.
function approxStats(a, b) {
  const pool = new Map();
  for (const line of a) pool.set(line, (pool.get(line) || 0) + 1);
  let common = 0;
  for (const line of b) {
    const left = pool.get(line) || 0;
    if (left > 0) {
      pool.set(line, left - 1);
      common++;
    }
  }
  return {
    common,
    removed: a.length - common,
    added: b.length - common,
    approx: true,
  };
}

function diffStats(a, b) {
  const ops = diffOps(a, b);
  if (!ops) return approxStats(a, b);
  let common = 0;
  let added = 0;
  let removed = 0;
  for (const [kind] of ops) {
    if (kind === '=') common++;
    else if (kind === '+') added++;
    else removed++;
  }
  return { common, added, removed, approx: false };
}

// 1.0 means identical, 0.0 means nothing in common. Two empty files are identical.
function similarity(stats, aLen, bLen) {
  const span = Math.max(aLen, bLen);
  return span === 0 ? 1 : stats.common / span;
}

// Groups ops into unified-diff-style hunks with `context` unchanged lines around
// each run of changes. Returns [] when there is nothing to show.
function hunks(ops, context = 2) {
  const changed = ops.map(([kind]) => kind !== '=');
  const keep = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (!changed[i]) continue;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }

  const out = [];
  let current = null;
  for (let i = 0; i < ops.length; i++) {
    if (keep[i]) {
      if (!current) {
        current = [];
        out.push(current);
      }
      current.push(ops[i]);
    } else {
      current = null;
    }
  }
  return out;
}

module.exports = { splitLines, diffOps, diffStats, similarity, hunks };
