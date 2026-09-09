'use strict';

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const { readManifest, emptyManifest, record, writeManifest, manifestPath } = require('../manifest');
const { makePaint } = require('../paint');
const { planRender } = require('./index');

const PRESETS_DIR = path.join(__dirname, '..', '..', 'presets');

const HELP = `cairn render — scaffold a repo's ai/ from the bundled presets

Usage: cairn render [options]

  --repo <path>    repo to render into (default: the repo cairn.config.json is in)
  --dry-run        print what would be written, write nothing
  --no-color       disable ANSI colour

Reads the repo's cairn.config.json (run \`cairn init\` first) — the stack list,
tracker, and any agent overrides. Greenfield only: it writes files that do not
exist and records them in the manifest; anything already on disk is left alone.
`;

function parseArgs(argv) {
  const args = { repo: null, dryRun: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
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

// Shared by `cairn render` and `cairn init --render`.
function renderInto(repoPath, { dryRun = false, paint } = {}) {
  const config = loadRepoConfig(repoPath, { required: true });
  const manifest = readManifest(repoPath) || emptyManifest();
  paint = paint || makePaint(false);

  const { planned, kept } = planRender({ config, presetsDir: PRESETS_DIR, manifest, repoPath });

  if (dryRun) {
    console.log(paint.bold(`cairn render --dry-run  ${repoPath}`));
    for (const [rel, , , note] of planned) {
      console.log(`  ${paint.green('would write')}  ${rel}${note ? paint.dim(`  (${note})`) : ''}`);
    }
    for (const k of kept) console.log(paint.yellow(`  would keep    ${k.rel}  (${k.reason})`));
    if (!planned.length && !kept.length) console.log(paint.dim('  nothing to render'));
    return 0;
  }

  let wrote = 0;
  for (const [rel, content, source] of planned) {
    const abs = path.join(repoPath, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    record(manifest, rel, source, content);
    console.log(`  ${paint.green('wrote')}  ${rel}`);
    wrote++;
  }
  if (wrote) {
    writeManifest(repoPath, manifest);
    console.log(`  ${paint.green('wrote')}  ${path.relative(repoPath, manifestPath(repoPath)).replace(/\\/g, '/')}`);
  }
  for (const k of kept) console.log(paint.yellow(`  kept   ${k.rel}  (${k.reason})`));
  if (!wrote && !kept.length) console.log(paint.dim('  nothing to render — all current'));
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const start = args.repo ? path.resolve(args.repo) : process.cwd();
  const repoPath = args.repo ? start : findRepoRoot(start);
  if (!repoPath || !fs.existsSync(path.join(repoPath, 'cairn.config.json'))) {
    console.error(`No cairn.config.json found — run \`cairn init\` first`);
    return 2;
  }

  const paint = makePaint(args.color);
  try {
    if (!args.dryRun) console.log(paint.bold(`cairn render  ${repoPath}`));
    return renderInto(repoPath, { dryRun: args.dryRun, paint });
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

module.exports = { main, renderInto, HELP, PRESETS_DIR };
