'use strict';

// `cairn override extract`: turn the hand edits in a generated agent doc into
// ai/local/ override files, so nobody has to redo them by hand.
//
// The edit is found by diffing the file against what cairn wrote (the stored base).
// Each changed region is placed in the stack slot it sits in; the slot's change is
// then written as the smallest override that reproduces it (changed sections for a
// slot with headings, an appended list for one without). Whatever it cannot place
// is returned, not guessed. The result is checked by rendering the agent with the
// new overrides and comparing it to the edited file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { render: renderTemplate } = require('../render/engine');
const { splitSections, extentEnd, keyOf, applySlotOverride, parseOverrideFile, REMOVE_MARKER } = require('./index');
const { unifiedDiff } = require('../sync');

const lf = (s) => String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const SLOT_USE = /\{\{>\s*stack\/([\w-]+)\s*\}\}/g;

// Hunks of the line diff a -> b: { start, len, lines } where `start` is the 0-based
// index into a's lines of the first replaced line (or the insertion point when
// len is 0) and `lines` are the new lines.
function diffHunks(a, b) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hunks-'));
  try {
    fs.writeFileSync(path.join(dir, 'a'), a, 'utf8');
    fs.writeFileSync(path.join(dir, 'b'), b, 'utf8');
    const res = spawnSync('git', ['diff', '--no-index', '--no-color', '-U0', '--', 'a', 'b'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (res.error) throw new Error(`git is needed to extract overrides: ${res.error.message}`);
    const hunks = [];
    let current = null;
    for (const line of (res.stdout || '').split('\n')) {
      const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (h) {
        const len = h[2] === undefined ? 1 : Number(h[2]);
        current = { start: len === 0 ? Number(h[1]) : Number(h[1]) - 1, len, lines: [] };
        hunks.push(current);
      } else if (current && line.startsWith('+') && !line.startsWith('+++')) {
        current.lines.push(line.slice(1));
      }
    }
    return hunks;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function applyHunks(lines, hunks) {
  const out = [...lines];
  for (const h of [...hunks].sort((x, y) => y.start - x.start)) out.splice(h.start, h.len, ...h.lines);
  return out;
}

// The smallest override text that turns `oldText` into `newText`, or null when
// they are the same.
function deriveSlotOverride(oldText, newText) {
  if (oldText === newText) return null;
  const oldS = splitSections(oldText);
  const newS = splitSections(newText);

  if (!oldS.sections.length) {
    if (newText.startsWith(oldText)) {
      const added = newText.slice(oldText.length).replace(/^\n+/, '').trimEnd();
      if (added) return added;
    }
    return `<!-- replace -->\n${newText}`;
  }
  if (oldS.preamble.join('\n').trim() !== newS.preamble.join('\n').trim()) return `<!-- replace -->\n${newText}`;

  const ownText = (sections, i) => sections[i].lines.join('\n').trimEnd();
  const oldByKey = new Map(oldS.sections.map((s, i) => [keyOf(s), i]));
  const newKeys = new Set(newS.sections.map(keyOf));
  const blocks = [];

  for (let i = 0; i < newS.sections.length; ) {
    const k = keyOf(newS.sections[i]);
    const j = oldByKey.get(k);
    const changed = j === undefined || ownText(oldS.sections, j) !== ownText(newS.sections, i);
    if (changed) {
      const end = extentEnd(newS.sections, i);
      blocks.push(newS.sections.slice(i, end).flatMap((s) => s.lines).join('\n').trimEnd());
      i = end;
    } else {
      i++;
    }
  }

  // Sections the edit deleted (and whose parent survived).
  oldS.sections.forEach((s, j) => {
    if (newKeys.has(keyOf(s))) return;
    const parentGone = oldS.sections.slice(0, j).some((p, pj) => !newKeys.has(keyOf(p)) && extentEnd(oldS.sections, pj) > j);
    if (!parentGone) blocks.push(`${s.lines[0]}\n<!-- remove -->`);
  });
  return blocks.join('\n\n');
}

function slotsUsedBy(presetsDir, source) {
  const file = path.join(presetsDir, source);
  if (!fs.existsSync(file)) return [];
  return [...new Set([...fs.readFileSync(file, 'utf8').matchAll(SLOT_USE)].map((m) => m[1]))];
}

// -> { slots: {name: text}, agent: text|null, unplaced: [string], verified, remaining }
function extractOverrides({ rel, ours, base, config, presetsDir, repoPath, existing = { slots: [], agents: [] } }) {
  const render = require('../render');
  const name = (rel.match(/^ai\/agents\/([^/]+)\.md$/) || [])[1];
  if (!name) throw new Error('extract works on generated agent docs: ai/agents/<name>.md');

  const ctx = render.buildContext(config, presetsDir, repoPath);
  const resolve = render.makeResolvePartial(ctx.stack, presetsDir, ctx.variants);
  const { targets } = render.renderTargets({ config, presetsDir, repoPath });
  const target = targets.find((t) => t[0] === rel);
  if (!target) throw new Error(`${rel}: cairn does not generate this file for this repo`);

  const oursLf = lf(ours);
  const baseLf = lf(base !== null && base !== undefined ? base : target[1]);
  const baseLines = baseLf.split('\n');
  const hunks = diffHunks(baseLf, oursLf);
  const result = { slots: {}, agent: null, unplaced: [], mismatches: [], verified: false, remaining: '' };
  if (!hunks.length) return { ...result, verified: true };

  const claimed = new Set();
  for (const slot of slotsUsedBy(presetsDir, target[2])) {
    const slotText = lf(renderTemplate(`{{> stack/${slot} }}`, ctx, resolve));
    if (!slotText.trim()) continue;
    const at = baseLf.indexOf(slotText);
    if (at === -1) continue;
    const first = baseLf.slice(0, at).split('\n').length - 1;
    const slotLines = slotText.split('\n');
    const last = first + slotLines.length - 1;

    const inside = hunks.filter((h) => (h.len > 0 ? h.start >= first && h.start + h.len - 1 <= last : h.start > first && h.start <= last));
    if (!inside.length) continue;
    inside.forEach((h) => claimed.add(h));
    const relative = inside.map((h) => ({ ...h, start: h.start - first }));
    const newText = applyHunks(slotLines, relative).join('\n');
    const override = deriveSlotOverride(slotText, newText);
    if (!override) continue;
    result.slots[slot] = override;

    // The check that matters: the override, applied to the slot as it was when the
    // file was written, gives back the edited slot. (Rendering the whole agent
    // against today's templates would also pick up template changes since, which
    // are not part of the edit.)
    const got = applySlotOverride(slotText, parseOverrideFile(override)).text;
    if (got.trimEnd() !== newText.trimEnd()) {
      result.mismatches.push(unifiedDiff(got, newText, `slot "${slot}" with the override`, 'your edit'));
    }
  }

  const leftover = hunks.filter((h) => !claimed.has(h));
  // An insertion after the last real line (the split leaves a phantom '' after the
  // final newline) reads as "added to the end of the agent".
  const atEnd = (h) => h.len === 0 && h.start >= baseLines.length - 1;
  if (leftover.length && leftover.every(atEnd)) {
    result.agent = leftover.flatMap((h) => h.lines).join('\n').trim() || null;
  } else {
    for (const h of leftover) {
      const removed = baseLines.slice(h.start, h.start + h.len);
      result.unplaced.push(
        [`@@ base line ${h.start + 1} @@`, ...removed.map((l) => `-${l}`), ...h.lines.map((l) => `+${l}`)].join('\n'),
      );
    }
  }

  const clashes = Object.keys(result.slots).filter((s) => existing.slots.includes(s));
  result.clashes = clashes;

  // Verified: every edit was placed, and each override reproduces its slot's edit.
  result.verified = result.unplaced.length === 0 && result.mismatches.length === 0;
  result.remaining = result.mismatches.join('\n\n');
  return result;
}

module.exports = { extractOverrides, deriveSlotOverride, diffHunks, REMOVE_MARKER };
