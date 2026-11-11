'use strict';

// cairn context — the cross-repo *authored* context layer. See DESIGN.md
// "The cross-repo context layer" and PLAN.md "C. Prototype the context
// resolver" for the why and the scope. This is the prototype: a frontmatter
// parser + graph resolver + the checks that are computable with no external
// wiring (no codeSource, no OpenAPI contract, no `local` tracker provider yet
// — those three finding types report `unknown`, per DESIGN.md's "not wired ->
// unknown" delegation rule, not a false pass).
//
// A node id is `<repoName>:<path-within-repo>` (e.g.
// `backend:ai/contexts/entities/invoice.md`) — the same syntax a `counterpartOf`
// reference in frontmatter uses, so a human writing one and cairn resolving one
// are the same string.

const fs = require('fs');
const path = require('path');

const { parse, firstHeading } = require('./frontmatter');

const CONTEXTS_REL = 'ai/contexts';
// `ai/contexts/<category>/**/<name>.md` — a category folder, then anything.
// Confirmed against snap-proof's real trees: `features/<name>/overview.md`,
// `pages/<page>/<sub>/business-logic.md` are legitimate nested organization by
// feature/page, not violations — an earlier stricter one-folder-one-file version
// flagged 12/34 real, deliberately-structured docs before this loosened it.
// Only a file with no category folder at all (`ai/contexts/foo.md`) is
// OFF_CONVENTION now, unless marked `unmanaged: true`. Loose on purpose: cairn
// does not yet own a fixed category list (entities/features/pages/… all fit).
const CONVENTION_RE = /^ai\/contexts\/[^/]+\/.+\.md$/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) walk(abs, out);
    else if (entry.endsWith('.md')) out.push(abs);
  }
  return out;
}

function toId(repoName, relPath) {
  return `${repoName}:${relPath}`;
}

function parseRef(ref) {
  const i = ref.indexOf(':');
  if (i === -1) return null; // a bare path with no repo prefix is not resolvable
  return { repo: ref.slice(0, i), relPath: ref.slice(i + 1) };
}

function asList(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Build the graph from a set of resolved repos (`doctor.resolveRepos` shape —
// needs `.name` and `.path`). Pure and synchronous; the only I/O is reading
// each repo's `ai/contexts/**/*.md`.
function build(repos) {
  const nodes = new Map();

  for (const repo of repos) {
    const contextsDir = path.join(repo.path, CONTEXTS_REL);
    const files = walk(contextsDir, []);
    for (const abs of files) {
      const relPath = path.relative(repo.path, abs).replace(/\\/g, '/');
      const text = fs.readFileSync(abs, 'utf8');
      const { data, body } = parse(text);
      const hasFrontmatter = Object.keys(data).length > 0 || /^---\s*\n/.test(text);
      const id = toId(repo.name, relPath);
      nodes.set(id, {
        id,
        repo: repo.name,
        relPath,
        absPath: abs.replace(/\\/g, '/'),
        data,
        hasFrontmatter,
        title: firstHeading(body),
        onConvention: CONVENTION_RE.test(relPath),
      });
    }
  }

  // Declared edges + reverse inference. An edge is `{ from, to, type, inferred }`.
  const edges = [];
  const dangling = []; // { from, ref } — counterpartOf pointed nowhere resolvable
  const seen = new Set(); // dedupe `${from}->${to}` per type

  const addEdge = (from, to, type, inferred) => {
    const key = `${type}|${from}|${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, type, inferred });
  };

  for (const node of nodes.values()) {
    for (const ref of asList(node.data.counterpartOf)) {
      const parsed = typeof ref === 'string' ? parseRef(ref) : null;
      const targetId = parsed ? toId(parsed.repo, parsed.relPath) : null;
      if (!targetId || !nodes.has(targetId)) {
        dangling.push({ from: node.id, ref: String(ref) });
        continue;
      }
      addEdge(node.id, targetId, 'counterpartOf', false);
      addEdge(targetId, node.id, 'counterpartOf', true);
    }
  }

  return { nodes, edges, dangling };
}

// `notCounterpartOf` entries silence a suggestion in either direction. Matches
// by full id or by bare relPath (the common case — "not this file, in any repo").
function isSilenced(node, other) {
  for (const entry of [...asList(node.data.notCounterpartOf), ...asList(other.data.notCounterpartOf)]) {
    if (entry === other.id || entry === node.id) return true;
    if (entry === other.relPath || entry === node.relPath) return true;
  }
  return false;
}

function hasDeclaredLink(node, other) {
  return asList(node.data.counterpartOf).some((ref) => {
    const parsed = typeof ref === 'string' ? parseRef(ref) : null;
    return parsed && toId(parsed.repo, parsed.relPath) === other.id;
  });
}

// Two heuristics, both weak by design (never auto-linked, always CANDIDATE):
// same relative path in two repos, or the same first-heading title in two repos.
function suggest(nodes) {
  const list = [...nodes.values()];
  const candidates = [];
  const paired = new Set();

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.repo === b.repo) continue;
      if (hasDeclaredLink(a, b) || hasDeclaredLink(b, a)) continue;
      if (isSilenced(a, b)) continue;

      const samePath = a.relPath === b.relPath;
      const sameTitle = a.title && b.title && a.title === b.title;
      if (!samePath && !sameTitle) continue;

      const key = [a.id, b.id].sort().join('|');
      if (paired.has(key)) continue;
      paired.add(key);
      candidates.push({ a: a.id, b: b.id, reason: samePath ? 'same relative path' : 'same title' });
    }
  }
  return candidates;
}

// The 7 findings from DESIGN.md's table. BROKEN_ANCHOR / CONTENT_MISMATCH /
// TRACKER_DESYNC need wiring cairn does not have yet (codeSource MCP, an
// OpenAPI contract, the `local` tracker provider) — reported once as
// `notChecked`, not spuriously per-file, per "not wired -> unknown, with a
// hint" (DESIGN.md "The boundary"). Never a reason to fail CI: `check` never
// throws and the caller decides what a non-zero exit means, if anything.
//
// `opts.resolveAnchor(repoName, symbolName)` is the optional codeSource hook:
// returns `{ status: 'found' | 'missing' | 'unknown' }`. Supplied → BROKEN_ANCHOR
// is computed (`missing` is the finding; `unknown` is listed, never a failure).
// Absent → BROKEN_ANCHOR stays in `notChecked`, exactly as before.
function check(graph, opts = {}) {
  const findings = [];
  const unknownAnchors = [];
  const resolveAnchor = typeof opts.resolveAnchor === 'function' ? opts.resolveAnchor : null;

  for (const node of graph.nodes.values()) {
    if (!node.hasFrontmatter) {
      findings.push({ type: 'MISSING_FRONTMATTER', id: node.id, detail: 'no frontmatter block' });
    }
    if (!node.onConvention && !node.data.unmanaged) {
      findings.push({
        type: 'OFF_CONVENTION',
        id: node.id,
        detail: `expected ai/contexts/<category>/<name>.md, got ${node.relPath} — mark \`unmanaged: true\` if this is deliberate`,
      });
    }
  }

  for (const d of graph.dangling) {
    findings.push({ type: 'DANGLING', id: d.from, detail: `counterpartOf: ${d.ref} does not resolve to a known file` });
  }

  for (const c of suggest(graph.nodes)) {
    findings.push({ type: 'CANDIDATE', id: c.a, detail: `possible counterpart: ${c.b} (${c.reason})` });
  }

  if (resolveAnchor) {
    for (const node of graph.nodes.values()) {
      for (const symbol of anchorsOf(node)) {
        const res = resolveAnchor(node.repo, symbol);
        if (res.status === 'missing') {
          findings.push({ type: 'BROKEN_ANCHOR', id: node.id, detail: `describes ${symbol}, but no such symbol in ${node.repo}` });
        } else if (res.status === 'unknown') {
          unknownAnchors.push({ id: node.id, symbol, reason: res.reason || 'code source unavailable' });
        }
      }
    }
  }

  return {
    findings,
    unknownAnchors,
    notChecked: resolveAnchor ? ['CONTENT_MISMATCH', 'TRACKER_DESYNC'] : ['BROKEN_ANCHOR', 'CONTENT_MISMATCH', 'TRACKER_DESYNC'],
    notCheckedReason: resolveAnchor
      ? 'no OpenAPI contract / local tracker provider wired yet'
      : 'no codeSource MCP / OpenAPI contract / local tracker provider wired yet',
  };
}

// `describes: entity Invoice` -> `Invoice`. The last word is the symbol; a lone
// word is the symbol. A list describes several.
function anchorsOf(node) {
  return asList(node.data.describes)
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim().split(/\s+/).pop());
}

// Resolved counterparts for one node id — declared + inferred-reverse edges,
// each with the target node's content already attached (see DESIGN.md "Serve
// it": "the server returns graph + content"). `null` if the id is unknown.
function counterparts(graph, id) {
  if (!graph.nodes.has(id)) return null;
  return graph.edges
    .filter((e) => e.from === id && e.type === 'counterpartOf')
    .map((e) => ({ ...graph.nodes.get(e.to), inferred: e.inferred }));
}

module.exports = { build, check, suggest, counterparts, anchorsOf, toId, parseRef, CONTEXTS_REL, CONVENTION_RE };
