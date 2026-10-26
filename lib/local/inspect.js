'use strict';

// What a repo's ai/local/ is doing, and whether it has gone stale.
//
// An override that extends a slot keeps following the preset for everything it does
// not mention. The two ways that can quietly stop being true:
//
//   upstream-changed  the preset's slot text moved since the override was recorded
//                     (the author has not looked at the change)
//   section-gone      a section the override used to replace no longer exists in
//                     the preset (renamed or removed), so the override now adds a
//                     second section instead of replacing one
//
// Both are recorded in the manifest (`overrides`) the first time sync sees an
// override, and acknowledged with `cairn override ack`. Neither blocks anything.

const fs = require('fs');
const path = require('path');

const { hashContent } = require('../manifest');
const { createLocalReader, listOverrideFiles, applySlotOverride, LOCAL_DIR, titleOf } = require('./index');

const SLOT_USE = /\{\{>\s*stack\/([\w-]+)\s*\}\}/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs) : [abs];
  });
}

// Every slot name some template pulls in with `{{> stack/<name> }}`.
function usedSlots(presetsDir) {
  const names = new Set();
  for (const file of walk(presetsDir).filter((f) => f.endsWith('.md'))) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(SLOT_USE)) names.add(m[1]);
  }
  return names;
}

// Lazy: the renderer requires ../local, so it cannot be required at load time here.
const renderer = () => require('../render');

function inspectOverrides({ repoPath, config, presetsDir, manifest = null }) {
  const render = renderer();
  const items = [];
  const reader = createLocalReader(repoPath);
  const slots = listOverrideFiles(repoPath, 'slots');
  const agents = listOverrideFiles(repoPath, 'agents');
  if (!slots.length && !agents.length) return items;

  const recordedAll = (manifest && manifest.overrides) || {};

  if (slots.length) {
    const ctx = render.buildContext(config, presetsDir, repoPath);
    const upstreamOf = render.makeResolvePartial(ctx.stack, presetsDir, ctx.variants);
    const used = usedSlots(presetsDir);
    for (const name of slots) {
      const key = `slots/${name}`;
      const file = `${LOCAL_DIR}/slots/${name}.md`;
      if (!used.has(name)) {
        items.push({ key, kind: 'slot', name, file, state: 'unknown-slot', message: `${file}: no template uses a slot called "${name}" (known: ${[...used].sort().join(', ')})` });
        continue;
      }
      const upstream = upstreamOf(`stack/${name}`) || '';
      const upstreamHash = hashContent(upstream);
      const { matched } = applySlotOverride(upstream, reader.slot(name));
      const recorded = recordedAll[key];
      const record = { upstream: upstreamHash, matched };
      const gone = recorded ? (recorded.matched || []).filter((k) => !matched.includes(k)) : [];

      let state = 'ok';
      let message = null;
      if (!recorded) state = 'new';
      if (recorded && recorded.upstream !== upstreamHash) {
        state = 'upstream-changed';
        message = `${file}: the preset's "${name}" slot changed since this override was recorded — review it, then \`cairn override ack ${name}\``;
      }
      if (gone.length) {
        state = 'section-gone';
        message = `${file}: section(s) ${gone.map((k) => `"${titleOf(k)}"`).join(', ')} no longer match a preset section, so they are now added alongside it instead of replacing it — rename them, or \`cairn override ack ${name}\``;
      }
      items.push({ key, kind: 'slot', name, file, state, message, record });
    }
  }

  if (agents.length) {
    const rels = new Set(render.renderTargets({ config, presetsDir, repoPath }).targets.map((t) => t[0]));
    for (const name of agents) {
      const file = `${LOCAL_DIR}/agents/${name}.md`;
      if (!rels.has(`ai/agents/${name}.md`)) {
        items.push({ key: `agents/${name}`, kind: 'agent', name, file, state: 'unknown-agent', message: `${file}: no ai/agents/${name}.md is generated for this repo, so this file is never used` });
      } else {
        items.push({ key: `agents/${name}`, kind: 'agent', name, file, state: 'ok', message: null });
      }
    }
  }
  return items;
}

const needsAttention = (item) => !['ok', 'new'].includes(item.state);

// Record overrides sync is seeing for the first time (`which = ['new']`), or the
// current state of the named ones (`ack`). Returns whether the manifest changed.
function recordOverrides(manifest, items, { names = null } = {}) {
  let changed = false;
  for (const item of items) {
    if (!item.record) continue;
    const wanted = names ? names.includes(item.name) : item.state === 'new';
    if (!wanted) continue;
    manifest.overrides = manifest.overrides || {};
    manifest.overrides[item.key] = item.record;
    changed = true;
  }
  return changed;
}

module.exports = { inspectOverrides, needsAttention, recordOverrides, usedSlots };
