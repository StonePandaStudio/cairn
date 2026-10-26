'use strict';

// Project-owned overrides: what a repo adds to cairn's generated files without
// ever editing them.
//
//   ai/local/slots/<slot>.md     extends or replaces one stack slot
//   ai/local/agents/<name>.md    appended to ai/agents/<name>.md
//
// A generated file is rebuilt from the template plus these, so there is nothing
// to merge. The unit of an override is a markdown section: a slot file holds only
// the sections that differ, matched to the preset's by heading, and everything it
// does not mention keeps following the preset.

const fs = require('fs');
const path = require('path');

const LOCAL_DIR = 'ai/local';
const REPLACE_MARKER = /^\s*<!--\s*replace\s*-->\s*$/i;
const REMOVE_MARKER = /^\s*<!--\s*remove\s*-->\s*$/i;
const LEADING_COMMENTS = /^(?:\s*<!--[\s\S]*?-->[ \t]*\n)+/;

const norm = (s) => String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// --- reading -----------------------------------------------------------------

// `{ replace, text }` for an override file's raw content. A leading
// `<!-- replace -->` line makes the file the whole slot; any other leading HTML
// comments are the author's notes and are dropped.
function parseOverrideFile(raw) {
  let text = norm(raw);
  let replace = false;
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first !== -1 && REPLACE_MARKER.test(lines[first])) {
    replace = true;
    lines.splice(first, 1);
    text = lines.join('\n');
  }
  text = text.replace(LEADING_COMMENTS, '').replace(/^\n+/, '').trimEnd();
  return { replace, text };
}

// Reader over a repo's ai/local/, or over an in-memory `overlay`
// ({ slots: {name: raw}, agents: {name: raw} }) that takes precedence — used to
// preview overrides that are not on disk yet.
// Slots renamed upstream: an override file under the old name still applies, so a
// repo's ai/local/ keeps working until it renames the file. `cairn override status`
// reports the old name as an unknown slot, which is the prompt to rename it.
const RENAMED_SLOTS = { 'mandatory-docs': 'architect-mandatory-docs' };

function createLocalReader(repoPath, overlay = null) {
  const readFile = (kind, name) => {
    if (overlay && overlay[kind] && overlay[kind][name] !== undefined) return overlay[kind][name];
    if (!repoPath) return null;
    const file = path.join(repoPath, LOCAL_DIR, kind, `${name}.md`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  const read = (kind, name) => {
    const raw = readFile(kind, name);
    return raw === null && kind === 'slots' && RENAMED_SLOTS[name] ? readFile(kind, RENAMED_SLOTS[name]) : raw;
  };
  return {
    slot(name) {
      const raw = read('slots', name);
      return raw === null ? null : parseOverrideFile(raw);
    },
    agent(name) {
      const raw = read('agents', name);
      if (raw === null) return null;
      const { text } = parseOverrideFile(raw);
      return text || null;
    },
  };
}

function listOverrideFiles(repoPath, kind) {
  const dir = path.join(repoPath, LOCAL_DIR, kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
}

// --- sections ----------------------------------------------------------------

// Split markdown into a preamble and heading-led sections. Headings inside fenced
// code are text, not headings.
function splitSections(text) {
  const preamble = [];
  const sections = [];
  let current = null;
  let fence = null;
  for (const line of norm(text).split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (line.trim().startsWith(fence.repeat(3))) fence = null;
    }
    const h = !fence && !f && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      current = { level: h[1].length, title: h[2].trim(), lines: [line] };
      sections.push(current);
    } else {
      (current ? current.lines : preamble).push(line);
    }
  }
  return { preamble, sections };
}

const keyOf = (s) => `${s.level}|${s.title.toLowerCase()}`;
const titleOf = (key) => key.slice(key.indexOf('|') + 1);

// Index just past a section and everything nested under it (deeper headings).
function extentEnd(sections, i) {
  let j = i + 1;
  while (j < sections.length && sections[j].level > sections[i].level) j++;
  return j;
}

const flatten = (sections) => sections.flatMap((s) => s.lines);

function trailingBlanks(lines) {
  let n = 0;
  while (n < lines.length && lines[lines.length - 1 - n].trim() === '') n++;
  return n;
}

const trimBlanks = (lines) => lines.slice(0, lines.length - trailingBlanks(lines));

// Apply one slot override to the preset's slot text. Returns `{ text, matched }`
// where `matched` lists the heading keys of override sections that found a
// section of the same level and title in the preset.
//
//   replace marker       the override is the whole slot
//   no headings          the override is appended to the slot
//   headings             a section replaces the preset's section of the same
//                        heading (and what is nested under it); `<!-- remove -->`
//                        as its body deletes that section; a heading the preset
//                        lacks is appended at the end
function applySlotOverride(upstream, override) {
  if (override.replace) return { text: override.text, matched: [] };
  if (!override.text) return { text: upstream, matched: [] };

  const ov = splitSections(override.text);
  if (!ov.sections.length) {
    return { text: [upstream, override.text].filter(Boolean).join('\n\n'), matched: [] };
  }

  const up = splitSections(upstream);
  const replacements = new Map();
  const appended = [];
  const matched = [];

  for (let i = 0; i < ov.sections.length; ) {
    const o = ov.sections[i];
    const end = extentEnd(ov.sections, i);
    const block = flatten(ov.sections.slice(i, end));
    const j = up.sections.findIndex((s, idx) => keyOf(s) === keyOf(o) && !replacements.has(idx));
    const remove = block.slice(1).filter((l) => l.trim() !== '').length === 1 && REMOVE_MARKER.test(block.slice(1).find((l) => l.trim() !== ''));
    if (j >= 0) {
      replacements.set(j, { end: extentEnd(up.sections, j), lines: remove ? null : block });
      matched.push(keyOf(o));
    } else if (!remove) {
      appended.push(block);
    }
    i = end;
  }

  const out = [...up.preamble];
  for (let k = 0; k < up.sections.length; ) {
    const r = replacements.get(k);
    if (!r) {
      out.push(...up.sections[k].lines);
      k++;
      continue;
    }
    if (r.lines) {
      const replaced = flatten(up.sections.slice(k, r.end));
      out.push(...trimBlanks(r.lines), ...Array(trailingBlanks(replaced)).fill(''));
    }
    k = r.end;
  }

  const extras = [];
  const pre = trimBlanks(ov.preamble);
  if (pre.some((l) => l.trim() !== '')) extras.push(pre.join('\n').replace(/^\n+/, ''));
  for (const block of appended) extras.push(trimBlanks(block).join('\n'));

  let text = out.join('\n');
  if (extras.length) text = [text.trimEnd(), ...extras].filter(Boolean).join('\n\n');
  return { text, matched };
}

// --- agent append ------------------------------------------------------------

function appendToAgent(content, extra) {
  return `${String(content).trimEnd()}\n\n---\n\n## Project-specific\n\n${extra.trim()}\n`;
}

module.exports = {
  LOCAL_DIR,
  REMOVE_MARKER,
  appendToAgent,
  applySlotOverride,
  createLocalReader,
  extentEnd,
  keyOf,
  listOverrideFiles,
  parseOverrideFile,
  splitSections,
  titleOf,
};
