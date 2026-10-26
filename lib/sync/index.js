'use strict';

// cairn sync — propagate preset changes into a repo that has already rendered.
//
// `cairn render` is greenfield: it writes files that do not exist and never
// touches one again. `cairn sync` is the upgrade path. For every managed file it
// holds three versions —
//
//   base    what the template rendered last time      (_cairn/base/<rel>)
//   ours    what is on disk now                        (the repo's edits)
//   theirs  what the current presets render
//
// — and runs a 2x2:
//
//                  template unchanged     template changed
//   local unchanged   no-op                fast-forward (write theirs)
//   local changed     keep local (MODIFIED)  three-way merge
//
// Three cells are automatic. The bottom-right shells out to `git merge-file`;
// a clean merge is applied, a conflicted one is written with markers and stops
// the command with a non-zero exit. Nothing is ever silently overwritten.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { hashContent, readBase } = require('../manifest');
const render = require('../render');

const SHIM_SOURCE = 'shims/jira.js';

// Outcomes, most-benign first. CONFLICT, NO_BASE and UNTRACKED are the non-zero exits.
const OUTCOME = {
  UNCHANGED: 'unchanged',
  MODIFIED: 'modified',
  CREATED: 'created',
  FAST_FORWARD: 'fast-forward',
  MERGED: 'merged',
  RESTORED: 'restored',
  CONFLICT: 'CONFLICT',
  ORPHANED: 'orphaned',
  NO_BASE: 'no base',
  UNTRACKED: 'untracked',
};

function templatesDir() {
  return path.join(__dirname, '..', '..', 'templates');
}

// `theirs` for a manifest entry: the preset-rendered file when the presets still
// emit that path, the vendored template for a tracker shim, or null when neither
// applies any more (the stack changed and this preset dropped out).
function resolveTheirs(entry, rel, targetsByRel) {
  const hit = targetsByRel.get(rel);
  if (hit) return { content: hit.content, source: hit.source };
  if (entry.source === SHIM_SOURCE) {
    const file = path.join(templatesDir(), SHIM_SOURCE);
    if (fs.existsSync(file)) return { content: fs.readFileSync(file, 'utf8'), source: SHIM_SOURCE };
  }
  return null;
}

// git merge-file --diff3, ours/base/theirs on disk, merged text on stdout. Exit
// code is the conflict count (0 = clean); a negative code means git failed.
function gitMergeFile(ours, base, theirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-merge-'));
  const write = (name, body) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body, 'utf8');
    return p;
  };
  try {
    const res = spawnSync(
      'git',
      [
        'merge-file',
        '-p',
        '--diff3',
        '-L',
        'ours (your edits)',
        '-L',
        'base (cairn wrote this)',
        '-L',
        'theirs (new template)',
        write('ours', ours),
        write('base', base),
        write('theirs', theirs),
      ],
      { encoding: 'utf8' },
    );
    if (res.error && res.error.code === 'ENOENT') {
      return { ok: false, reason: 'git is not on PATH — cairn sync needs it for the merge step' };
    }
    if (typeof res.status !== 'number' || res.status < 0) {
      return { ok: false, reason: (res.stderr || 'git merge-file failed').trim() };
    }
    return { ok: true, merged: res.stdout, conflicts: res.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// One decision per managed file. Returns an action describing what the caller
// should write; it performs no IO of its own beyond reading ours/base.
function planFile(rel, entry, repoPath, targetsByRel, { adoptBase }) {
  const theirs = resolveTheirs(entry, rel, targetsByRel);
  const absOurs = path.join(repoPath, rel);
  const ours = fs.existsSync(absOurs) ? fs.readFileSync(absOurs, 'utf8') : null;

  if (!theirs) {
    return { rel, outcome: OUTCOME.ORPHANED, detail: 'the presets no longer emit this path' };
  }

  if (ours === null) {
    // Deleted locally — nothing to preserve, put the current render back.
    return {
      rel,
      outcome: OUTCOME.RESTORED,
      detail: 'was deleted',
      write: theirs.content,
      base: theirs.content,
      source: theirs.source,
    };
  }

  let base = readBase(repoPath, rel);
  let seededBase = false;
  if (base === null) {
    if (hashContent(ours) === entry.hash) {
      // Untouched since cairn wrote it — the on-disk bytes are a faithful base.
      base = ours;
      seededBase = true;
    } else if (adoptBase) {
      base = ours;
      seededBase = true;
    } else {
      return {
        rel,
        outcome: OUTCOME.NO_BASE,
        detail: 'rendered before base tracking and edited since — pass --adopt-base or reconcile by hand',
      };
    }
  }

  const hOurs = hashContent(ours);
  const hBase = hashContent(base);
  const hTheirs = hashContent(theirs.content);
  const localChanged = hOurs !== hBase;
  const templateChanged = hTheirs !== hBase;
  const hasMarkers = /^<{7} /m.test(ours) && /^>{7} /m.test(ours);

  if (!templateChanged) {
    // The template has already been folded into the base — anything left is a
    // local edit. Clear a stale conflict flag once the markers are gone.
    const unresolved = entry.conflict && hasMarkers;
    return {
      rel,
      outcome: localChanged ? OUTCOME.MODIFIED : OUTCOME.UNCHANGED,
      detail: unresolved
        ? 'conflict markers still in the file — resolve them'
        : localChanged
          ? 'local edits, template steady — kept'
          : null,
      // Persist a base we only inferred this run, so the next sync is cheap.
      base: seededBase ? base : undefined,
      clearConflict: entry.conflict && !unresolved,
    };
  }

  if (!localChanged) {
    return {
      rel,
      outcome: OUTCOME.FAST_FORWARD,
      detail: `template moved ${diffMagnitude(base, theirs.content)}`,
      write: theirs.content,
      base: theirs.content,
      source: theirs.source,
      clearConflict: true,
    };
  }

  const merge = gitMergeFile(ours, base, theirs.content);
  if (!merge.ok) {
    return { rel, outcome: OUTCOME.CONFLICT, detail: merge.reason };
  }
  if (merge.conflicts === 0) {
    return {
      rel,
      outcome: OUTCOME.MERGED,
      detail: 'local edits + template changes combined cleanly',
      write: merge.merged,
      base: theirs.content,
      source: theirs.source,
      clearConflict: true,
    };
  }
  // Write the markers, and advance the base to `theirs` so the next run treats
  // whatever the human leaves behind as a plain local edit rather than merging
  // the same template change a second time.
  return {
    rel,
    outcome: OUTCOME.CONFLICT,
    detail: `${merge.conflicts} conflict${merge.conflicts === 1 ? '' : 's'} — markers written, resolve then re-run`,
    write: merge.merged,
    base: theirs.content,
    source: theirs.source,
    conflict: true,
  };
}

function diffMagnitude(a, b) {
  const la = a.split('\n').length;
  const lb = b.split('\n').length;
  const d = lb - la;
  if (d === 0) return '(same length)';
  return d > 0 ? `(+${d} lines)` : `(${d} lines)`;
}

// Plan a sync for the whole repo. Pure except for reading ours/base and invoking
// `git merge-file`; the caller writes the files and the manifest.
function planSync({ config, presetsDir, manifest, repoPath, adoptBase = false }) {
  const { targets } = render.renderTargets({ config, presetsDir, repoPath });
  const targetsByRel = new Map(targets.map(([rel, content, source]) => [rel, { content, source }]));

  const actions = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    actions.push(planFile(rel, entry, repoPath, targetsByRel, { adoptBase }));
  }

  // Preset targets the manifest has never seen: either a genuinely new preset
  // file (nothing there — write it, same greenfield guard as `cairn render`), or
  // a path something already occupies. The latter happens whenever `cairn init`
  // ran on a repo that already had a same-named file (a pre-cairn hand-written
  // doc, most often) — init's own greenfield guard left it untouched and
  // unmanifested, so every sync since has silently skipped it. Route it through
  // the same NO_BASE / --adopt-base decision an already-tracked file with no
  // base gets, instead of leaving it invisible forever.
  for (const [rel, content, source] of targets) {
    if (manifest.files[rel]) continue;
    const absOurs = path.join(repoPath, rel);
    if (!fs.existsSync(absOurs)) {
      actions.push({
        rel,
        outcome: OUTCOME.CREATED,
        detail: 'new preset file',
        write: content,
        base: content,
        source,
      });
      continue;
    }
    if (!adoptBase) {
      actions.push({
        rel,
        outcome: OUTCOME.UNTRACKED,
        detail: 'a file already here that presets render to, never brought under management — pass --adopt-base to review it',
      });
      continue;
    }
    const action = planFile(rel, { source, hash: null }, repoPath, targetsByRel, { adoptBase: true });
    // planFile's no-op/local-edit branch sets neither `source` nor `write` for an
    // already-managed file (nothing to do); this file has never been recorded at
    // all, so force both here — this run is the one that creates its manifest
    // entry, even when the adopted content needs no further change.
    if (action.source === undefined) action.source = source;
    if (action.write === undefined) action.write = fs.readFileSync(absOurs, 'utf8');
    actions.push(action);
  }

  actions.sort((a, b) => a.rel.localeCompare(b.rel));
  return { actions };
}

// Repo-relative paths whose current template render differs from what cairn last
// rendered (`_cairn/base/`, or the manifest hash for a file with no stored base).
// `cairn doctor` uses this for OUTDATED: "cairn has newer content for this file",
// answered without running any merge. Read-only.
function outdatedRels({ config, presetsDir, manifest, repoPath }) {
  const { targets } = render.renderTargets({ config, presetsDir, repoPath });
  const targetsByRel = new Map(targets.map(([rel, content, source]) => [rel, { content, source }]));

  const outdated = new Set();
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const theirs = resolveTheirs(entry, rel, targetsByRel);
    if (!theirs) continue;
    const base = readBase(repoPath, rel);
    const reference = base !== null ? hashContent(base) : entry.hash;
    if (hashContent(theirs.content) !== reference) outdated.add(rel);
  }
  return outdated;
}

module.exports = { planSync, planFile, gitMergeFile, outdatedRels, OUTCOME };
