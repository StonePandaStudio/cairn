'use strict';

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME, configPath, cairnDir } = require('./config');
const {
  emptyManifest,
  readManifest,
  record,
  writeManifest,
  manifestPath,
} = require('./manifest');
const { listProviders } = require('./tracker');
const { makePaint } = require('./paint');

// `cairn init` — make a repo cairn-managed.
//
// It writes exactly three things:
//   cairn.config.json        hand-editable from here on; cairn never rewrites it
//   _cairn/scripts/jira.js   vendored shim, tracked in the manifest
//   _cairn/manifest.json     the record of what was written
//
// Plus, when the repo still carries a copied ai/scripts/jira.js, that file is
// replaced by a shim too. Replacing rather than deleting is deliberate: the five
// repos have roughly forty prose references to that path, and breaking them all
// in the same release that swaps the Jira client would make any failure
// impossible to attribute.

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
  --stack <name>           backend | frontend | cli | ...   (default: unknown)
  --tracker <provider>     ${listProviders().join(' | ')}   (default: none)
  --project-key <KEY>      tracker project key, e.g. PROOF
  --story-type <name>      parent issue type  (default: Story)
  --subtask-type <name>    child issue type   (default: Sub-task)
  --no-shim                do not vendor or replace the ai/scripts/*.js client shims
  --force                  overwrite an existing cairn.config.json
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
    shim: true,
    force: false,
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
    else if (a === '--no-shim') args.shim = false;
    else if (a === '--force') args.force = true;
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
    stack: args.stack,
    tracker: { provider: args.tracker },
  };
  if (args.tracker !== 'none') {
    cfg.tracker.projectKey = args.projectKey;
    cfg.tracker.env = '.env';
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

  const planned = [];
  const config = buildConfig(args);
  planned.push([CONFIG_NAME, JSON.stringify(config, null, 2) + '\n', null]);

  const shim = readTemplate(SHIM_SOURCE);
  if (args.shim) {
    planned.push([SHIM_TARGET, shim, SHIM_SOURCE]);
    // Only replace a legacy path if a copied client is actually there — creating
    // one in a repo that never had it would invent a path nothing references.
    for (const target of LEGACY_SHIM_TARGETS) {
      if (fs.existsSync(path.join(repoPath, target))) {
        planned.push([target, shim, SHIM_SOURCE]);
      }
    }
  }

  if (args.dryRun) {
    console.log(paint.bold(`cairn init --dry-run  ${repoPath}`));
    for (const [rel] of planned) console.log(`  would write  ${rel}`);
    return 0;
  }

  const manifest = readManifest(repoPath) || emptyManifest();
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
  for (const [rel, , source] of planned) {
    console.log(`  ${paint.green('wrote')}  ${rel}${source ? paint.dim(`  (${source})`) : ''}`);
  }
  console.log(`  ${paint.green('wrote')}  ${path.relative(repoPath, manifestPath(repoPath)).replace(/\\/g, '/')}`);

  const gitignore = path.join(repoPath, '.gitignore');
  const hasIgnore = fs.existsSync(gitignore) && /^_cairn\b/m.test(fs.readFileSync(gitignore, 'utf8'));
  if (hasIgnore) {
    console.log(
      paint.yellow(`  warning: _cairn/ is gitignored in this repo — generated files must be committed`),
    );
  }
  if (args.tracker !== 'none') {
    console.log(
      paint.dim(`\n  Next: ensure .env has JIRA_BASE_URL, JIRA_USER, JIRA_PASSWORD, then run`),
    );
    console.log(paint.dim(`        npx cairn tracker list-statuses ${args.projectKey}`));
  }
  return 0;
}

module.exports = { main, buildConfig, HELP, SHIM_TARGET, LEGACY_SHIM_TARGETS, cairnDir };
