'use strict';

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const {
  readManifest,
  emptyManifest,
  record,
  writeManifest,
  writeBase,
  manifestPath,
} = require('../manifest');
const { makePaint } = require('../paint');
const { planRender } = require('./index');
const { checkStack } = require('../presets');
const { workspaceContext } = require('../workspace');
const { registerMcp, configNotes } = require('../hosts');

const PRESETS_DIR = path.join(__dirname, '..', '..', 'presets');

const HELP = `cairn render — scaffold a repo's ai/ from the bundled presets

Usage: cairn render [options]

  --repo <path>    repo to render into (default: the repo cairn.config.json is in)
  --dry-run        print what would be written, write nothing
  --mcp            also register the Cairn MCP server for each host the repo uses
                   (.mcp.json for claude, .codex/config.toml for codex)
  --no-color       disable ANSI colour

Reads the repo's cairn.config.json (run \`cairn init\` first) — the stack list,
tracker, and any agent overrides. Seeds missing files and updates untouched
managed Codex skills and the generated root AGENTS.md. Use sync to merge edits.
`;

function parseArgs(argv) {
  const args = { repo: null, dryRun: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--mcp') args.mcp = true;
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
  if (!checkStack(config.stack)) return 2;
  for (const note of configNotes(config)) console.log(paint.yellow(`  note: ${note}`));
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
    // The merge base `cairn sync` will diff against: what the template produced,
    // verbatim, this run.
    writeBase(repoPath, rel, content);
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
    const exit = renderInto(repoPath, { dryRun: args.dryRun, paint });
    if (exit || !args.mcp) return exit;
    const config = loadRepoConfig(repoPath, { required: true });
    const workspace = workspaceContext(repoPath, config, { includeSingle: true });
    const configFile = workspace ? path.resolve(repoPath, workspace.file) : null;
    const rows = registerMcp({ name: path.basename(repoPath), path: repoPath }, configFile, config, {
      dryRun: args.dryRun,
    });
    for (const r of rows) {
      console.log(`  ${args.dryRun ? 'preview: ' : ''}${r.action}  ${r.file}`);
      if (r.action === 'differs') console.log(paint.yellow(`  Review the existing Cairn MCP entry in ${r.file}.`));
    }
    if (rows.some((r) => r.installed === false)) {
      console.log(paint.yellow('  Install Cairn in this repo before starting the MCP server.'));
    }
    return rows.some((r) => r.action === 'differs') ? 1 : 0;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

module.exports = { main, renderInto, HELP, PRESETS_DIR };
