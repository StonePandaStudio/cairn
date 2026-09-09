'use strict';

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME, configPath, cairnDir, normalizeStack } = require('./config');
const {
  emptyManifest,
  readManifest,
  record,
  writeManifest,
  manifestPath,
  hashContent,
} = require('./manifest');
const { listProviders } = require('./tracker');
const { makePaint } = require('./paint');

// `cairn init` — make a repo cairn-managed.
//
// It writes:
//   cairn.config.json        hand-editable from here on; cairn never rewrites it
//                            except with --force
//   _cairn/scripts/jira.js   vendored shim, tracked in the manifest
//   _cairn/manifest.json     the record of what was written
//
// Plus, for every copied client the repo still carries (jira.js / youtrack.js /
// task-tracker.js under ai/scripts/), that file is replaced by the same shim —
// replacing rather than deleting because dozens of prose references name the path
// and the shim reads the same argv. A file already holding the shim is skipped; a
// file hand-edited away from what cairn wrote is kept and reported unless
// --force-shims. cairn never invents one of these paths in a repo that lacked it.

const SHIM_SOURCE = 'shims/jira.js';
const SHIM_TARGET = '_cairn/scripts/jira.js';

// Copied tracker-client filenames seen across the repos. `cairn init` replaces
// every one that exists with the shim — the snap-proof repos carry all three
// (`task-tracker.js` dispatching to `jira.js` / `youtrack.js`), and the docs
// that reference them by path keep working because the shim reads the same
// argv. A repo that never had one is left alone; the shim is never invented.
const LEGACY_SHIM_TARGETS = [
  'ai/scripts/jira.js',
  'ai/scripts/youtrack.js',
  'ai/scripts/task-tracker.js',
];

const HELP = `cairn init — make a repo cairn-managed

Usage: cairn init [options]

  --repo <path>            repo to initialise (default: cwd)
  --stack <names>          comma-separated, framework first: nestjs,typeorm | angular | cli
  --tracker <provider>     ${listProviders().join(' | ')}   (default: none)
  --project-key <KEY>      tracker project key, e.g. PROOF
  --story-type <name>      parent issue type  (default: Story, jira-server only)
  --subtask-type <name>    child issue type   (default: Sub-task, jira-server only)
  --env-prefix <PFX>       prefix for the tracker credential vars, e.g. CAIRN_
                           (only when the repo's app reads JIRA_*/YOUTRACK_* itself)
  --no-shim                do not vendor or replace the ai/scripts/*.js client shims
  --force                  overwrite an existing cairn.config.json
  --force-shims            also replace an ai/scripts/*.js shim that was hand-edited
                           since cairn wrote it (kept untouched otherwise)
  --dry-run                print what would be written, write nothing
`;

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    stack: 'unknown',
    tracker: 'none',
    projectKey: null,
    storyType: 'Story',
    subtaskType: 'Sub-task',
    envPrefix: '',
    shim: true,
    force: false,
    forceShims: false,
    dryRun: false,
    color: process.stdout.isTTY,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--stack') args.stack = argv[++i];
    else if (a === '--tracker') args.tracker = argv[++i];
    else if (a === '--project-key') args.projectKey = argv[++i];
    else if (a === '--story-type') args.storyType = argv[++i];
    else if (a === '--subtask-type') args.subtaskType = argv[++i];
    else if (a === '--env-prefix') args.envPrefix = argv[++i];
    else if (a === '--no-shim') args.shim = false;
    else if (a === '--force') args.force = true;
    else if (a === '--force-shims') args.forceShims = args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    }
  }
  return args;
}

function buildConfig(args) {
  const cfg = {
    $schema: `./node_modules/${require('../package.json').name}/schema.json`,
    cairn: require('../package.json').version,
    stack: normalizeStack(args.stack),
    tracker: { provider: args.tracker },
  };
  if (args.tracker !== 'none') {
    cfg.tracker.projectKey = args.projectKey;
    cfg.tracker.env = '.env';
    if (args.envPrefix) cfg.tracker.envPrefix = args.envPrefix;
    // issueTypes is a Jira concept — YouTrack has no Task/Sub-task split.
    if (args.tracker === 'jira-server') {
      cfg.tracker.issueTypes = { story: args.storyType, subtask: args.subtaskType };
    }
  }
  cfg.agents = {};
  return cfg;
}

function readTemplate(rel) {
  return fs.readFileSync(path.join(__dirname, '..', 'templates', rel), 'utf8');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const paint = makePaint(args.color);
  const repoPath = path.resolve(args.repo);

  if (!fs.existsSync(repoPath)) {
    console.error(`Repo not found: ${repoPath}`);
    return 2;
  }
  if (!listProviders().includes(args.tracker)) {
    console.error(`Unknown tracker "${args.tracker}". Available: ${listProviders().join(', ')}`);
    return 2;
  }
  if (args.tracker !== 'none' && !args.projectKey) {
    console.error(`--tracker ${args.tracker} requires --project-key`);
    return 2;
  }

  const cfgFile = configPath(repoPath);
  if (fs.existsSync(cfgFile) && !args.force) {
    console.error(`${cfgFile} already exists — pass --force to overwrite`);
    return 2;
  }

  const manifest = readManifest(repoPath) || emptyManifest();

  const planned = [];
  const kept = [];
  const config = buildConfig(args);
  planned.push([CONFIG_NAME, JSON.stringify(config, null, 2) + '\n', null]);

  const shim = readTemplate(SHIM_SOURCE);
  if (args.shim) {
    planned.push([SHIM_TARGET, shim, SHIM_SOURCE]);
    // Replace a legacy client only where one is actually present. A file already
    // holding the shim is left alone; one hand-edited away from what cairn wrote
    // is kept unless --force — never silently overwrite an edit.
    for (const target of LEGACY_SHIM_TARGETS) {
      const abs = path.join(repoPath, target);
      if (!fs.existsSync(abs)) continue;
      const current = fs.readFileSync(abs, 'utf8');
      const entry = manifest.files[target];

      // Already the shim and already tracked — nothing to do. If it holds the
      // shim but isn't in the manifest (someone copied it by hand), fall through
      // so this run records it.
      if (current === shim && entry) continue;

      const modified = entry && hashContent(current) !== entry.hash;
      if (modified && !args.forceShims) {
        kept.push(target);
        continue;
      }
      const note =
        current === shim ? 'recording existing shim' : entry ? null : `replacing ${current.split('\n').length} lines`;
      planned.push([target, shim, SHIM_SOURCE, note]);
    }
  }

  if (args.dryRun) {
    console.log(paint.bold(`cairn init --dry-run  ${repoPath}`));
    for (const [rel, , , note] of planned) {
      console.log(`  would write  ${rel}${note ? paint.dim(`  (${note})`) : ''}`);
    }
    for (const rel of kept) {
      console.log(paint.yellow(`  would keep   ${rel}  (hand-edited — pass --force-shims to replace)`));
    }
    return 0;
  }

  for (const [rel, content, source] of planned) {
    const abs = path.join(repoPath, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    // cairn.config.json is hand-editable, so it is deliberately not manifested —
    // tracking it would report every legitimate edit as MODIFIED.
    if (source) record(manifest, rel, source, content);
  }
  writeManifest(repoPath, manifest);

  console.log(paint.bold(`cairn init  ${repoPath}`));
  for (const [rel, , source, note] of planned) {
    const tag = note || source;
    console.log(`  ${paint.green('wrote')}  ${rel}${tag ? paint.dim(`  (${tag})`) : ''}`);
  }
  console.log(`  ${paint.green('wrote')}  ${path.relative(repoPath, manifestPath(repoPath)).replace(/\\/g, '/')}`);
  for (const rel of kept) {
    console.log(paint.yellow(`  kept   ${rel}  (hand-edited since cairn wrote it — pass --force-shims to replace)`));
  }

  const gitignore = path.join(repoPath, '.gitignore');
  const hasIgnore = fs.existsSync(gitignore) && /^_cairn\b/m.test(fs.readFileSync(gitignore, 'utf8'));
  if (hasIgnore) {
    console.log(
      paint.yellow(`  warning: _cairn/ is gitignored in this repo — generated files must be committed`),
    );
  }
  if (args.tracker !== 'none') {
    const envVars = require('./tracker').providerEnv(args.tracker, args.envPrefix);
    console.log(paint.dim(`\n  Next: ensure .env has ${envVars.join(', ')}, then run`));
    console.log(paint.dim(`        npx cairn tracker list-statuses ${args.projectKey}`));
  }
  return 0;
}

module.exports = { main, buildConfig, HELP, SHIM_TARGET, LEGACY_SHIM_TARGETS, cairnDir };
