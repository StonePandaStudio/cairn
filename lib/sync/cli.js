'use strict';

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const {
  readManifest,
  record,
  writeManifest,
  writeBase,
  manifestPath,
} = require('../manifest');
const { makePaint } = require('../paint');
const { planSync, OUTCOME } = require('./index');

const PRESETS_DIR = path.join(__dirname, '..', '..', 'presets');

const HELP = `cairn sync — propagate preset changes into an already-rendered repo

Usage: cairn sync [options]

  --repo <path>    repo to sync (default: the repo cairn.config.json is in)
  --dry-run        print the 2x2 outcome per file, write nothing
  --adopt-base     for files rendered before cairn tracked a merge base and
                   hand-edited since: accept the current file as the base
                   (you lose the ability to merge upstream changes to it)
  --no-color       disable ANSI colour

Runs a three-way merge per managed file: base (what the template rendered last
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
  [OUTCOME.CONFLICT]: 'red',
  [OUTCOME.ORPHANED]: 'magenta',
  [OUTCOME.NO_BASE]: 'red',
};

function parseArgs(argv) {
  const args = { repo: null, dryRun: false, adoptBase: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
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
  try {
    const config = loadRepoConfig(repoPath, { required: true });
    plan = planSync({ config, presetsDir: PRESETS_DIR, manifest, repoPath, adoptBase: args.adoptBase });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }

  if (args.dryRun) {
    console.log(paint.bold(`cairn sync --dry-run  ${repoPath}`));
    for (const act of plan.actions) printAction(act, paint);
    const conflicts = plan.actions.filter((a) => a.outcome === OUTCOME.CONFLICT).length;
    const noBase = plan.actions.filter((a) => a.outcome === OUTCOME.NO_BASE).length;
    console.log('');
    console.log(summary(plan.actions, paint));
    return conflicts || noBase ? 3 : 0;
  }

  console.log(paint.bold(`cairn sync  ${repoPath}`));
  const { conflicts, changed } = applyPlan(repoPath, manifest, plan.actions, paint);
  const noBase = plan.actions.filter((a) => a.outcome === OUTCOME.NO_BASE).length;

  if (changed) {
    writeManifest(repoPath, manifest);
    console.log(
      `  ${paint.green('wrote')}  ${path
        .relative(repoPath, manifestPath(repoPath))
        .replace(/\\/g, '/')}`,
    );
  }

  console.log('');
  console.log(summary(plan.actions, paint));

  if (conflicts) {
    console.log('');
    console.log(
      paint.red(`  ${conflicts} file(s) left with conflict markers`) +
        paint.dim(' — resolve them, then run `cairn sync` again'),
    );
  }
  if (noBase) {
    console.log(
      paint.red(`  ${noBase} file(s) have no merge base`) +
        paint.dim(' — re-run with --adopt-base once you have reviewed them'),
    );
  }
  return conflicts || noBase ? 3 : 0;
}

function summary(actions, paint) {
  const counts = {};
  for (const a of actions) counts[a.outcome] = (counts[a.outcome] || 0) + 1;
  const order = [
    OUTCOME.CREATED,
    OUTCOME.FAST_FORWARD,
    OUTCOME.MERGED,
    OUTCOME.RESTORED,
    OUTCOME.MODIFIED,
    OUTCOME.UNCHANGED,
    OUTCOME.ORPHANED,
    OUTCOME.NO_BASE,
    OUTCOME.CONFLICT,
  ];
  const parts = order
    .filter((k) => counts[k])
    .map((k) => paint[COLOR[k] || 'dim'](`${k} ${counts[k]}`));
  return paint.bold('Summary') + '\n  ' + (parts.join('   ') || paint.dim('nothing managed'));
}

module.exports = { main, applyPlan, HELP, PRESETS_DIR };
