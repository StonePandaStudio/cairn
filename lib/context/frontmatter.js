'use strict';

// Minimal YAML-frontmatter parser for `ai/contexts/**/*.md` — deliberately not a
// real YAML parser (same zero-dependency stance as the rest of cairn; see
// DESIGN.md "cairn context serve" on not pulling in the MCP SDK for the same
// reason). Covers exactly what the context-layer vocabulary needs: scalar
// `key: value`, inline arrays `key: [a, b]`, and block arrays
// `key:\n  - a\n  - b`. No nested maps, no multiline scalars, no anchors.

const FENCE = /^---\s*$/;

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function coerceScalar(raw) {
  const t = raw.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  return stripQuotes(t);
}

function parseInlineArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner.split(',').map((s) => coerceScalar(s));
}

// `text` is a whole file's content. Returns `{ data, body }` — `data` is `{}`
// and `body` is the full text unchanged when there is no `---`-fenced block at
// the very top of the file.
function parse(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length || !FENCE.test(lines[0])) return { data: {}, body: text };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: text };

  const data = {};
  const fmLines = lines.slice(1, end);
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^(\S[^:]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2];

    if (rest.trim().startsWith('[')) {
      data[key] = parseInlineArray(rest);
      continue;
    }
    if (rest.trim() === '') {
      // Possible block array on following indented `- ` lines.
      const items = [];
      let j = i + 1;
      while (j < fmLines.length && /^\s+-\s+/.test(fmLines[j])) {
        items.push(coerceScalar(fmLines[j].replace(/^\s+-\s+/, '')));
        j++;
      }
      if (items.length) {
        data[key] = items;
        i = j - 1;
        continue;
      }
      data[key] = null;
      continue;
    }
    data[key] = coerceScalar(rest);
  }

  const body = lines.slice(end + 1).join('\n');
  return { data, body };
}

// First `# Heading` in the body, if any — used as a node's display title.
function firstHeading(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

module.exports = { parse, firstHeading };
