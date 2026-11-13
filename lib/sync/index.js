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
//   local changed     keep local (MODIFIED)  see below
//
// The bottom-right cell depends on the file. Agent docs (ai/agents/*.md) are
// generated: a project customizes them through `ai/local/` (see lib/local), never
// by editing them, so a local edit that meets a moved template is not merged. It
// is reported with a diff, and `--reset <file>` takes the template. Every other
// file (command stubs, WORKFLOW.md, AGENTS.md, code-guidelines.md) has no
// override mechanism, so there the cell is a three-way merge that shells out to
// `git merge-file`: a clean merge is applied, a conflicted one is written with
// markers and stops the command with a non-zero exit. Nothing is ever silently
// overwritten.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { hashContent, readBase } = require('../manifest');
const render = require('../render');

const SHIM_SOURCE = 'shims/jira.js';

// Outcomes, most-benign first. HAND_EDITED, CONFLICT, NO_BASE and UNTRACKED are the non-zero exits.
const OUTCOME = {
  UNCHANGED: 'unchanged',
  MODIFIED: 'modified',
  CREATED: 'created',
  FAST_FORWARD: 'fast-forward',
  MERGED: 'merged',
  RESTORED: 'restored',
  RESET: 'reset',
  HAND_EDITED: 'HAND-EDITED',
  CONFLICT: 'CONFLICT',
  ORPHANED: 'orphaned',
  NO_BASE: 'no base',
  UNTRACKED: 'untracked',
};

// Agent docs are the files a project customizes through ai/local/ instead of by
// editing, so they are regenerated rather than merged. Anything without such a
// mechanism is still merged: blocking a hand edit there would leave no way to
// customize the file at all.
const isRegenerated = (rel) => /^ai\/agents\/[^/]+\.md$/.test(rel);

const hasMarkers = (text) => /^<{7} /m.test(text) && /^>{7} /m.test(text);

// A unified diff of two texts, headed with `labelA` / `labelB`. Empty when git
// cannot produce one: the diff is a courtesy, never load-bearing.
function unifiedDiff(a, b, labelA, labelB) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-diff-'));
  try {
    const lf = (t) => String(t).replace(/\r\n?/g, '\n');
    fs.writeFileSync(path.join(dir, 'a'), lf(a), 'utf8');
    fs.writeFileSync(path.join(dir, 'b'), lf(b), 'utf8');
    const res = spawnSync('git', ['diff', '--no-index', '--no-color', '-U2', '--', 'a', 'b'], { cwd: dir, encoding: 'utf8' });
    if (res.error || !res.stdout) return '';
    const body = res.stdout.split('\n');
    const at = body.findIndex((l) => l.startsWith('@@'));
    if (at === -1) return '';
    return [`--- ${labelA}`, `+++ ${labelB}`, ...body.slice(at)].join('\n').trimEnd();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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

// The line ending a file mostly uses. A tie or an empty file reads as LF.
function dominantEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

// git merge-file --diff3, ours/base/theirs on disk, merged text on stdout. Exit
// code is the conflict count (0 = clean); a negative code means git failed.
//
// Line endings are normalized first. On Windows a checkout makes `ours` and the
// stored base CRLF while the renderer emits LF, and git then sees every line as
// changed: a whole-file conflict over edits that never touched each other. The
// merge runs on LF text and the result takes the line ending `ours` already used,
// so the file does not flip style under the person who owns it.
function gitMergeFile(ours, base, theirs) {
  const eol = dominantEol(ours);
  const toLf = (s) => s.replace(/\r\n/g, '\n');
  const result = mergeLf(toLf(ours), toLf(base), toLf(theirs));
  if (result.ok && eol === '\r\n') result.merged = result.merged.replace(/\n/g, '\r\n');
  return result;
}

function mergeLf(ours, base, theirs) {
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

// A regenerated file (an agent doc). What cairn last wrote is `entry.hash`; if the disk still holds
// that, the file is regenerated freely. If someone edited it, it is left alone and
// the edit is reported, unless the template is steady (nothing is blocked, so it
// is only noted) or `--reset` asks for the template.
function planOwned(rel, entry, theirs, ours, repoPath, reset) {
  const hOurs = hashContent(ours);
  const hTheirs = hashContent(theirs.content);
  const base = readBase(repoPath, rel);
  const wantsReset = !!(reset && reset.has(rel));

  // Markers from an earlier sync (an older cairn merged owned files) are two
  // people's work; overwriting them with the template would lose both.
  if (entry.conflict && hasMarkers(ours) && !wantsReset) {
    return {
      rel,
      outcome: OUTCOME.CONFLICT,
      detail: 'conflict markers from an earlier sync are still in the file — resolve them, or `--reset` to take the template',
    };
  }

  const handEdited = entry.hash ? hOurs !== entry.hash : hOurs !== hTheirs;
  if (hOurs === hTheirs || !handEdited) {
    if (hOurs === hTheirs) {
      const action = { rel, outcome: OUTCOME.UNCHANGED, detail: null, clearConflict: !!entry.conflict };
      if (base === null || hashContent(base) !== hTheirs) action.base = theirs.content;
      // The disk already equals the render but the manifest remembers something else
      // (markers resolved by hand, say): record what is there, without touching it.
      if (entry.hash !== hOurs) {
        action.record = ours;
        action.source = theirs.source;
      }
      return action;
    }
    return {
      rel,
      outcome: OUTCOME.FAST_FORWARD,
      detail: `template moved ${diffMagnitude(ours, theirs.content)}`,
      write: theirs.content,
      base: theirs.content,
      source: theirs.source,
      clearConflict: true,
    };
  }

  if (wantsReset) {
    return {
      rel,
      outcome: OUTCOME.RESET,
      detail: 'hand edit discarded, template written',
      write: theirs.content,
      base: theirs.content,
      source: theirs.source,
      clearConflict: true,
    };
  }

  const baseline = base !== null ? hashContent(base) : entry.hash || null;
  const templateMoved = baseline === null || hTheirs !== baseline;
  if (!templateMoved) {
    return {
      rel,
      outcome: OUTCOME.MODIFIED,
      detail: 'hand-edited, template steady — kept (move the edit to ai/local/ to keep this file current)',
      clearConflict: !!entry.conflict,
    };
  }
  return {
    rel,
    outcome: OUTCOME.HAND_EDITED,
    detail: 'edited by hand and the template moved — move the edit to ai/local/, or `--reset` to take the template',
    diff: unifiedDiff(base !== null ? base : theirs.content, ours, base !== null ? 'what cairn wrote' : 'current template', rel),
  };
}

// One decision per managed file. Returns an action describing what the caller
// should write; it performs no IO of its own beyond reading ours/base.
function planFile(rel, entry, repoPath, targetsByRel, { adoptBase, reset = null }) {
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

  if (isRegenerated(rel)) {
    return planOwned(rel, entry, theirs, ours, repoPath, reset);
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
  const ourMarkers = hasMarkers(ours);

  if (!templateChanged) {
    // The template has already been folded into the base — anything left is a
    // local edit. Clear a stale conflict flag once the markers are gone.
    const unresolved = entry.conflict && ourMarkers;
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
function planSync({ config, presetsDir, manifest, repoPath, adoptBase = false, reset = [] }) {
  const resetSet = new Set(reset);
  const { targets } = render.renderTargets({ config, presetsDir, repoPath });
  const targetsByRel = new Map(targets.map(([rel, content, source]) => [rel, { content, source }]));

  const actions = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    actions.push(planFile(rel, entry, repoPath, targetsByRel, { adoptBase, reset: resetSet }));
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
    if (rel === 'AGENTS.md' && !adoptBase) {
      actions.push({ rel, outcome: OUTCOME.MODIFIED, detail: 'repo-owned root guide — add the Cairn pointer by hand' });
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
    const action = planFile(rel, { source, hash: null }, repoPath, targetsByRel, { adoptBase: true, reset: resetSet });
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

module.exports = { planSync, planFile, gitMergeFile, outdatedRels, isRegenerated, unifiedDiff, OUTCOME };
