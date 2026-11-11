'use strict';

// `cairn context adopt` — the deterministic half of bringing existing, frontmatter-less
// context docs under the convention. It only ADDS frontmatter keys, never changes a body or
// an existing key, and never reads code (cairn parses no source). Per doc, when absent:
//
//   type:           the category folder, singular  (ai/contexts/entities/x.md -> entity)
//   counterpartOf:  only with `linkCandidates`, and only for a same-relative-path pair in
//                   another repo (the weak same-title suggestion is never written)
//
// `describes:` needs a symbol, so it stays with the discovery agent (it can ask a code
// provider and read the declaration); see presets/core/agents/discovery.md, step D.6.
//
// Idempotent: a second run finds nothing to add. Dry run unless the caller writes.

const fs = require('fs');

// ai/contexts/<category>/... -> the category, singular. `entities` -> `entity`,
// `features` -> `feature`; a word that is not a plural (`testing`) is left as it is.
function categoryType(relPath) {
  const m = /^ai\/contexts\/([^/]+)\//.exec(relPath);
  if (!m) return null;
  const c = m[1].toLowerCase();
  if (/ies$/.test(c)) return c.replace(/ies$/, 'y');
  if (/s$/.test(c) && !/ss$/.test(c)) return c.slice(0, -1);
  return c;
}

const hasKey = (node, key) => Object.prototype.hasOwnProperty.call(node.data, key);

// graph: from build(); candidates: [{ a, b, reason }] as produced by the CANDIDATE findings.
function plan(graph, { candidates = [], linkCandidates = false } = {}) {
  const items = new Map(); // id -> { id, file, add: {key: value}, hadFrontmatter }

  const slot = (node) => {
    if (!items.has(node.id)) items.set(node.id, { id: node.id, file: node.absPath, hadFrontmatter: node.hasFrontmatter, add: {} });
    return items.get(node.id);
  };

  for (const node of graph.nodes.values()) {
    if (!node.onConvention || node.data.unmanaged) continue;
    const type = categoryType(node.relPath);
    if (type && !hasKey(node, 'type')) slot(node).add.type = type;
  }

  const skipped = [];
  if (linkCandidates) {
    for (const c of candidates) {
      if (c.reason !== 'same relative path') continue;
      for (const [from, to] of [[c.a, c.b], [c.b, c.a]]) {
        const node = graph.nodes.get(from);
        if (!node || !graph.nodes.has(to)) continue;
        if (hasKey(node, 'counterpartOf')) {
          skipped.push({ id: from, reason: `already has counterpartOf; add ${to} by hand` });
          continue;
        }
        slot(node).add.counterpartOf = to;
      }
    }
  }

  return { items: [...items.values()].filter((i) => Object.keys(i.add).length), skipped };
}

// Insert `lines` as frontmatter: a new block when the file has none, otherwise just before the
// closing `---` of the first block. Keeps the file's own line ending; touches nothing else.
function withFrontmatter(input, lines) {
  // Keep a leading byte-order mark first in the file, ahead of the fence.
  const bom = input.startsWith('﻿') ? '﻿' : '';
  const text = input.slice(bom.length);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const m = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(text);
  if (m) {
    const inner = m[2].length ? m[2] + nl : '';
    return bom + m[1] + inner + lines.join(nl) + m[3].replace(/^\r?\n/, nl) + text.slice(m[0].length);
  }
  if (/^---[ \t]*\r?\n/.test(text)) return null; // an unterminated block: do not guess
  return `${bom}---${nl}${lines.join(nl)}${nl}---${nl}${text}`;
}

function apply(items) {
  const written = [];
  const failed = [];
  for (const item of items) {
    const lines = Object.entries(item.add).map(([k, v]) => `${k}: ${v}`);
    const text = fs.readFileSync(item.file, 'utf8');
    const next = withFrontmatter(text, lines);
    if (next === null) {
      failed.push({ id: item.id, reason: 'frontmatter block is not closed; left untouched' });
      continue;
    }
    fs.writeFileSync(item.file, next);
    written.push(item.id);
  }
  return { written, failed };
}

module.exports = { plan, apply, categoryType, withFrontmatter };
