'use strict';

// What `presets/` offers, and whether a repo's `stack` list only names things that
// exist. Nothing here renders; it is the catalogue `cairn preset` reads and the
// guard `render` / `sync` / `init` run before trusting a stack list.

const fs = require('fs');
const path = require('path');

const PRESETS_DIR = path.join(__dirname, '..', 'presets');

// `core/` is applied to every repo, whatever its stack. It is not a stack entry.
const CORE = 'core';

// Stack names that are valid on purpose and have no preset folder: the repo gets
// `core/` only. Anything else without a folder is more likely a typo than a choice.
const PRESET_LESS = new Set(['unknown', 'cli']);

// What a preset folder can contribute, in the order `cairn preset list` shows it.
const SHIPS = [
  ['slots', 'slots'],
  ['code-guidelines.md', 'guidelines'],
  ['agents', 'agents'],
  ['commands', 'commands'],
  ['variants', 'variants'],
];

function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'preset.json'), 'utf8'));
  } catch {
    return {};
  }
}

// [{ name, kind, description, ships: ['slots', 'guidelines', …] }], by name.
// `kind` and `description` come from an optional preset.json — a preset without
// one is still listed, as kind "other".
function listPresets(presetsDir = PRESETS_DIR) {
  if (!fs.existsSync(presetsDir)) return [];
  return fs
    .readdirSync(presetsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== CORE)
    .map((d) => {
      const dir = path.join(presetsDir, d.name);
      const meta = readMeta(dir);
      return {
        name: d.name,
        kind: meta.kind || 'other',
        description: meta.description || '',
        ships: SHIPS.filter(([entry]) => fs.existsSync(path.join(dir, entry))).map(([, label]) => label),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function closest(name, candidates) {
  let best = null;
  let bestDistance = 3; // more than two edits away is a different word, not a typo
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}

// { errors: [string], warnings: [string] }.
//   error   — the stack cannot mean what it says: `core` listed as an entry (it is
//             always applied) or a name listed twice (its slots would repeat).
//   warning — a name with no preset folder that is not on the deliberate list. It
//             renders from `core/` alone, which is right for `cli` and silently
//             wrong for a typo, so it is flagged rather than refused.
function validateStack(stack, presetsDir = PRESETS_DIR) {
  const errors = [];
  const warnings = [];
  const known = listPresets(presetsDir).map((p) => p.name);
  const seen = new Set();

  for (const name of stack || []) {
    if (name === CORE) {
      errors.push(`"${CORE}" is always applied — it is not a stack entry`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`"${name}" is listed more than once — its slots would repeat`);
      continue;
    }
    seen.add(name);
    if (known.includes(name) || PRESET_LESS.has(name)) continue;

    const guess = closest(name, known);
    warnings.push(
      `no preset "${name}" — rendering from core only` +
        (guess ? `; did you mean "${guess}"?` : '') +
        ` (available: ${known.join(', ')})`,
    );
  }
  return { errors, warnings };
}

// Print what validateStack found. Returns false when there is an error — callers
// stop; warnings alone never do.
function checkStack(stack, { presetsDir = PRESETS_DIR, err = console.error } = {}) {
  const { errors, warnings } = validateStack(stack, presetsDir);
  for (const w of warnings) err(`warning: stack: ${w}`);
  for (const e of errors) err(`error: stack: ${e}`);
  return errors.length === 0;
}

module.exports = { PRESETS_DIR, PRESET_LESS, listPresets, validateStack, checkStack };
