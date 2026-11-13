'use strict';

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const { configNotes } = require('../hosts');
const { checkStack } = require('../presets');
const {
  readManifest,
  record,
  writeManifest,
  writeBase,
  manifestPath,
} = require('../manifest');
const { makePaint } = require('../paint');
const { planSync, OUTCOME } = require('./index');
const { inspectOverrides, needsAttention, recordOverrides } = require('../local/inspect');

const PRESETS_DIR = path.join(__dirname, '..', '..', 'presets');

const HELP = `cairn sync — propagate preset changes into an already-rendered repo

Usage: cairn sync [options]

  --repo <path>    repo to sync (default: the repo cairn.config.json is in)
  --dry-run        print the 2x2 outcome per file, write nothing
  --only <path>    sync just this repo-relative file (repeatable); every other
                   file is left exactly as it is, and the repo is not stamped
                   as synced by this cairn version
  --reset <path>   take the template for a hand-edited agent doc (repeatable); the
                   edit is discarded. The lasting way to customize an agent doc
                   is ai/local/, see \`cairn override --help\`.
  --adopt-base     for files rendered before cairn tracked a merge base and
                   hand-edited since, or a preset target a pre-cairn file
                   already occupied and was never brought under management:
                   accept the current file as the base (you lose the ability
                   to merge upstream changes made before this point)
  --no-color       disable ANSI colour

Agent docs (ai/agents/*.md) are regenerated from the template plus ai/local/. One
that was edited by hand while the template moved is not touched: it is reported
with a diff and the run exits 3.

Every other file gets a three-way merge: base (what the template rendered last
time, in _cairn/base/), ours (what is on disk), theirs (what the current presets
render). Clean results are written; a conflict is written with git markers and
exits non-zero. Nothing is ever silently overwritten.
`;

const COLOR = {
  [OUTCOME.UNCHANGED]: 'dim',
  [OUTCOME.MODIFIED]: 'yellow',
  [OUTCOME.CREATED]: 'green',
  [OUTCOME.FAST_FORWARD]: 'green',
  [OUTCOME.MERGED]: 'green',
  [OUTCOME.RESTORED]: 'green',
  [OUTCOME.RESET]: 'yellow',
  [OUTCOME.HAND_EDITED]: 'red',
  [OUTCOME.CONFLICT]: 'red',
  [OUTCOME.ORPHANED]: 'magenta',
  [OUTCOME.NO_BASE]: 'red',
  [OUTCOME.UNTRACKED]: 'red',
};

function parseArgs(argv) {
  const args = { repo: null, dryRun: false, adoptBase: false, only: [], reset: [], color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--only') args.only.push(String(argv[++i] || '').replace(/\\/g, '/'));
    else if (a === '--reset') args.reset.push(String(argv[++i] || '').replace(/\\/g, '/'));
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--adopt-base') args.adoptBase = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    }
  }
  return args;
}

// Apply a plan to disk. Returns the count of files left in conflict.
function applyPlan(repoPath, manifest, actions, paint) {
  let conflicts = 0;
  let changed = false;
  for (const act of actions) {
    if (act.write !== undefined) {
      const abs = path.join(repoPath, act.rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, act.write, 'utf8');
    }
    // record() rebuilds the entry, so it drops any stale `conflict` flag; set the
    // fresh one back afterwards.
    if (act.write !== undefined && act.source !== undefined) {
      record(manifest, act.rel, act.source, act.write);
      changed = true;
    } else if (act.record !== undefined && act.source !== undefined) {
      // The file already holds the right content; only the manifest was out of date.
      record(manifest, act.rel, act.source, act.record);
      changed = true;
    }
    if (act.base !== undefined) writeBase(repoPath, act.rel, act.base);
    if (act.conflict) {
      manifest.files[act.rel].conflict = true;
      conflicts++;
      changed = true;
    } else if (act.clearConflict && manifest.files[act.rel] && manifest.files[act.rel].conflict) {
      delete manifest.files[act.rel].conflict;
      changed = true;
    }
    printAction(act, paint);
  }
  return { conflicts, changed };
}

function printAction(act, paint) {
  const tag = paint[COLOR[act.outcome] || 'dim'](act.outcome.padEnd(12));
  const detail = act.detail ? paint.dim(`  ${act.detail}`) : '';
  console.log(`  ${tag}  ${act.rel}${detail}`);
}

// Outcomes that need a person before the repo is in sync.
const NEEDS_HUMAN = new Set([OUTCOME.CONFLICT, OUTCOME.NO_BASE, OUTCOME.UNTRACKED, OUTCOME.HAND_EDITED]);

// The hand edits sync refused to overwrite, as diffs, so the person can move them
// to ai/local/ without opening the file.
function printHandEdits(actions, paint, limit = 60) {
  for (const act of actions.filter((a) => a.outcome === OUTCOME.HAND_EDITED && a.diff)) {
    console.log('');
    console.log(paint.bold(`${act.rel}`) + paint.dim(' — your edit, as a diff against what cairn wrote:'));
    const lines = act.diff.split('\n');
    for (const line of lines.slice(0, limit)) {
      console.log('  ' + (line.startsWith('+') ? paint.green(line) : line.startsWith('-') ? paint.red(line) : paint.dim(line)));
    }
    if (lines.length > limit) console.log(paint.dim(`  … ${lines.length - limit} more lines`));
  }
}

function printConfigNotes(config, paint) {
  const notes = configNotes(config);
  if (!notes.length) return;
  console.log('');
  console.log(paint.bold('cairn.config.json'));
  for (const note of notes) console.log('  ' + paint.yellow(note));
}

function printOverrideNotes(items, paint) {
  const notes = items.filter(needsAttention);
  if (!notes.length) return;
  console.log('');
  console.log(paint.bold('ai/local'));
  for (const item of notes) console.log('  ' + paint.yellow(item.message));
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const paint = makePaint(args.color);
  const start = args.repo ? path.resolve(args.repo) : process.cwd();
  const repoPath = args.repo ? start : findRepoRoot(start);
  if (!repoPath || !fs.existsSync(path.join(repoPath, 'cairn.config.json'))) {
    console.error('No cairn.config.json found — run `cairn init` first');
    return 2;
  }

  const manifest = readManifest(repoPath);
  if (!manifest || !Object.keys(manifest.files).length) {
    console.error('Nothing to sync — this repo has no cairn manifest. Run `cairn render` first.');
    return 2;
  }

  let plan;
  let config;
  try {
    config = loadRepoConfig(repoPath, { required: true });
    if (!checkStack(config.stack)) return 2;
    plan = planSync({ config, presetsDir: PRESETS_DIR, manifest, repoPath, adoptBase: args.adoptBase, reset: args.reset });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }

  // A partial sync touches only the named files. A path the plan doesn't contain is
  // a typo (or a file no preset renders), and silently syncing nothing would look
  // like success.
  const partial = args.only.length > 0;
  if (partial) {
    const known = new Set(plan.actions.map((a) => a.rel));
    const unknown = args.only.filter((rel) => !known.has(rel));
    if (unknown.length) {
      console.error(`--only: not a file cairn manages or renders here: ${unknown.join(', ')}`);
      return 2;
    }
    plan.actions = plan.actions.filter((a) => args.only.includes(a.rel));
  }
  if (args.reset.length) {
    const known = new Set(plan.actions.map((a) => a.rel));
    const unknown = args.reset.filter((rel) => !known.has(rel));
    if (unknown.length) {
      console.error(`--reset: not a file cairn manages or renders here: ${unknown.join(', ')}`);
      return 2;
    }
  }

  const overrides = inspectOverrides({ repoPath, config, presetsDir: PRESETS_DIR, manifest });

  if (args.dryRun) {
    console.log(paint.bold(`cairn sync --dry-run  ${repoPath}`));
    for (const act of plan.actions) printAction(act, paint);
    printHandEdits(plan.actions, paint);
    console.log('');
    console.log(summary(plan.actions, paint));
    printOverrideNotes(overrides, paint);
    printConfigNotes(config, paint);
    return plan.actions.some((a) => NEEDS_HUMAN.has(a.outcome)) ? 3 : 0;
  }

  console.log(paint.bold(`cairn sync  ${repoPath}`));
  const applied = applyPlan(repoPath, manifest, plan.actions, paint);
  const { conflicts } = applied;
  let { changed } = applied;
  const noBase = plan.actions.filter((a) => a.outcome === OUTCOME.NO_BASE || a.outcome === OUTCOME.UNTRACKED).length;
  const handEdited = plan.actions.filter((a) => a.outcome === OUTCOME.HAND_EDITED).length;

  // Overrides sync is seeing for the first time are recorded now, so later runs can
  // tell when the preset moves under them. A partial sync leaves that to a full one.
  if (!partial && recordOverrides(manifest, overrides)) changed = true;

  // Stamp the cairn version even when no file changed, so `cairn doctor` can tell
  // "synced by this cairn" from "never synced since the version moved".
  // (Not on a partial sync: other files may still be behind, so it would overclaim.)
  if (changed || (!partial && manifest.cairnVersion !== require('../../package.json').version)) {
    writeManifest(repoPath, manifest, { keepVersion: partial });
    console.log(
      `  ${paint.green('wrote')}  ${path
        .relative(repoPath, manifestPath(repoPath))
        .replace(/\\/g, '/')}`,
    );
  }

  printHandEdits(plan.actions, paint);
  console.log('');
  console.log(summary(plan.actions, paint));
  printOverrideNotes(overrides, paint);
  printConfigNotes(config, paint);

  if (handEdited) {
    console.log('');
    console.log(
      paint.red(`  ${handEdited} file(s) edited by hand while the template moved, left as they are`) +
        paint.dim(' — move the edit to ai/local/ (`cairn override extract <file>` does it), then `cairn sync --reset <file>`'),
    );
  }
  if (conflicts) {
    console.log('');
    console.log(
      paint.red(`  ${conflicts} file(s) left with conflict markers`) +
        paint.dim(' — resolve them, then run `cairn sync` again'),
    );
  }
  if (noBase) {
    console.log(
      paint.red(`  ${noBase} file(s) have no merge base or were never brought under management`) +
        paint.dim(' — re-run with --adopt-base once you have reviewed them'),
    );
  }
  return plan.actions.some((a) => NEEDS_HUMAN.has(a.outcome)) ? 3 : 0;
}

function summary(actions, paint) {
  const counts = {};
  for (const a of actions) counts[a.outcome] = (counts[a.outcome] || 0) + 1;
  const order = [
    OUTCOME.CREATED,
    OUTCOME.FAST_FORWARD,
    OUTCOME.MERGED,
    OUTCOME.RESTORED,
    OUTCOME.RESET,
    OUTCOME.MODIFIED,
    OUTCOME.UNCHANGED,
    OUTCOME.ORPHANED,
    OUTCOME.NO_BASE,
    OUTCOME.UNTRACKED,
    OUTCOME.HAND_EDITED,
    OUTCOME.CONFLICT,
  ];
  const parts = order
    .filter((k) => counts[k])
    .map((k) => paint[COLOR[k] || 'dim'](`${k} ${counts[k]}`));
  return paint.bold('Summary') + '\n  ' + (parts.join('   ') || paint.dim('nothing managed'));
}

module.exports = { main, applyPlan, HELP, PRESETS_DIR };
