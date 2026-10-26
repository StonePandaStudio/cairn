'use strict';

// cairn override — look after a repo's ai/local/.
//
//   status            what is in ai/local/ and whether the presets moved under it
//   ack [slot...]     "I have looked": record the current preset as the reference
//   extract <file>    turn a hand-edited agent doc into ai/local/ override files

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const { checkStack } = require('../presets');
const { readManifest, writeManifest, readBase, hashContent } = require('../manifest');
const { makePaint } = require('../paint');
const { inspectOverrides, needsAttention, recordOverrides } = require('../local/inspect');
const { extractOverrides } = require('../local/extract');
const { LOCAL_DIR } = require('../local');

const PRESETS_DIR = path.join(__dirname, '..', '..', 'presets');

const HELP = `cairn override — manage a repo's ai/local/

Usage: cairn override <command> [options]

  status                 list the overrides in ai/local/ and what needs a look
  ack [slot...]          record the current preset as reviewed (all, or the named slots)
  extract <file>         write the hand edits in ai/agents/<name>.md out as overrides

Options:
  --repo <path>          repo to work on (default: the repo cairn.config.json is in)
  --dry-run              (extract) print what would be written, write nothing
  --force                (extract) overwrite override files that already exist
  --no-color             disable ANSI colour

Layout (cairn never writes to ai/local/ except through \`extract\`):

  ai/local/slots/<slot>.md     extends one stack slot. Write only the sections that
                               differ: a heading the preset also has replaces that
                               section (and what is nested under it); a new heading
                               is added at the end; \`<!-- remove -->\` as a section's
                               body deletes it. A file with no headings is appended
                               to the slot. A first line \`<!-- replace -->\` makes
                               the file the whole slot.
  ai/local/agents/<name>.md    appended to ai/agents/<name>.md under "Project-specific".

Both are templates ({{ tracker.exampleKey }} and the other variables work). Apply
changes with \`cairn sync\`.
`;

function parseArgs(argv) {
  const args = { command: null, rest: [], repo: null, dryRun: false, force: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) return { error: `Unknown argument: ${a}` };
    else if (!args.command) args.command = a;
    else args.rest.push(a);
  }
  return args;
}

function load(args) {
  const start = args.repo ? path.resolve(args.repo) : process.cwd();
  const repoPath = args.repo ? start : findRepoRoot(start);
  if (!repoPath || !fs.existsSync(path.join(repoPath, 'cairn.config.json'))) {
    throw new ConfigError('No cairn.config.json found — run `cairn init` first');
  }
  const config = loadRepoConfig(repoPath, { required: true });
  if (!checkStack(config.stack)) throw new ConfigError('unknown stack entry');
  return { repoPath, config, manifest: readManifest(repoPath) || { files: {} } };
}

function status({ repoPath, config, manifest }, paint) {
  const items = inspectOverrides({ repoPath, config, presetsDir: PRESETS_DIR, manifest });
  if (!items.length) {
    console.log(paint.dim(`No overrides: ${LOCAL_DIR}/ is empty or missing.`));
    return 0;
  }
  const color = { ok: 'green', new: 'dim', 'upstream-changed': 'yellow', 'section-gone': 'yellow', 'unknown-slot': 'red', 'unknown-agent': 'red' };
  for (const item of items) {
    console.log(`  ${paint[color[item.state] || 'dim'](item.state.padEnd(16))} ${item.file}`);
    if (item.message) console.log(paint.dim(`                   ${item.message}`));
  }
  return items.some(needsAttention) ? 3 : 0;
}

function ack(ctx, names, paint) {
  const items = inspectOverrides({ ...ctx, presetsDir: PRESETS_DIR });
  const known = items.filter((i) => i.kind === 'slot' && i.record).map((i) => i.name);
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) {
    console.error(`Not a slot override here: ${unknown.join(', ')}${known.length ? ` (have: ${known.join(', ')})` : ''}`);
    return 2;
  }
  const chosen = names.length ? names : known;
  if (!chosen.length) {
    console.log(paint.dim('Nothing to acknowledge.'));
    return 0;
  }
  recordOverrides(ctx.manifest, items, { names: chosen });
  writeManifest(ctx.repoPath, ctx.manifest, { keepVersion: true });
  console.log(`${paint.green('recorded')}  ${chosen.join(', ')}`);
  return 0;
}

function extract(ctx, args, paint) {
  const rel = String(args.rest[0] || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel) {
    console.error('Usage: cairn override extract <file>   e.g. ai/agents/developer.md');
    return 2;
  }
  const abs = path.join(ctx.repoPath, rel);
  if (!fs.existsSync(abs)) {
    console.error(`${rel}: no such file`);
    return 2;
  }
  const ours = fs.readFileSync(abs, 'utf8');
  if (/^<{7} /m.test(ours) && /^>{7} /m.test(ours)) {
    console.error(`${rel}: still has conflict markers. Restore the file you edited (git checkout -- ${rel}) and its base (git checkout -- _cairn/base/${rel}), then run this again.`);
    return 2;
  }
  const base = readBase(ctx.repoPath, rel);
  if (base === null) console.error(paint.yellow(`${rel}: no stored base, comparing against the current template instead`));

  let result;
  try {
    const { listOverrideFiles } = require('../local');
    result = extractOverrides({
      rel,
      ours,
      base,
      config: ctx.config,
      presetsDir: PRESETS_DIR,
      repoPath: ctx.repoPath,
      existing: { slots: listOverrideFiles(ctx.repoPath, 'slots'), agents: listOverrideFiles(ctx.repoPath, 'agents') },
    });
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  const name = path.basename(rel, '.md');
  const files = Object.entries(result.slots).map(([slot, text]) => [`${LOCAL_DIR}/slots/${slot}.md`, text]);
  if (result.agent) files.push([`${LOCAL_DIR}/agents/${name}.md`, result.agent]);

  if (!files.length && !result.unplaced.length) {
    console.log(paint.dim(`${rel}: no edits against what cairn wrote, nothing to extract.`));
    return 0;
  }

  const blocked = files.filter(([file]) => fs.existsSync(path.join(ctx.repoPath, file)) && !args.force);
  if (blocked.length) {
    console.error(`These override files already exist and extract cannot merge into them: ${blocked.map((b) => b[0]).join(', ')}`);
    console.error('Add the sections below to them by hand, or pass --force to overwrite.');
  }

  for (const [file, text] of files) {
    const skip = blocked.some((b) => b[0] === file);
    console.log(`${paint.bold(skip ? 'skipped' : args.dryRun ? 'would write' : 'wrote')}  ${file}`);
    console.log(text.split('\n').map((l) => '    ' + l).join('\n'));
    if (!skip && !args.dryRun) {
      fs.mkdirSync(path.dirname(path.join(ctx.repoPath, file)), { recursive: true });
      fs.writeFileSync(path.join(ctx.repoPath, file), text + '\n', 'utf8');
    }
  }

  if (result.unplaced.length) {
    console.log('');
    console.log(paint.red(`${result.unplaced.length} edit(s) are outside any slot and cannot be expressed as an override automatically:`));
    for (const u of result.unplaced) console.log(u.split('\n').map((l) => '    ' + l).join('\n'));
    console.log(paint.dim(`Put them in ${LOCAL_DIR}/agents/${name}.md by hand if they should be kept.`));
  }

  console.log('');
  if (result.verified) {
    console.log(paint.green('Verified:') + ` ${rel} rendered with these overrides is identical to your edited file.`);
    if (!args.dryRun && !blocked.length) {
      console.log(paint.dim(`Next: cairn sync --reset ${rel}   (takes the generated file, which now includes your edits)`));
    }
  } else {
    console.log(paint.yellow('Not identical:') + ' the file rendered with these overrides still differs from your edit:');
    console.log(result.remaining.split('\n').map((l) => '    ' + l).join('\n'));
  }
  if (Object.keys(result.slots).some((s) => ['key-patterns'].includes(s))) {
    console.log(paint.dim('Note: key-patterns feeds both the architect and the developer; the override changes both.'));
  }
  return blocked.length || result.unplaced.length || !result.verified ? 3 : 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(args.error);
    return 2;
  }
  if (args.help || !args.command) {
    process.stdout.write(HELP);
    return args.help ? 0 : 2;
  }
  const paint = makePaint(args.color);
  try {
    const ctx = load(args);
    if (args.command === 'status') return status(ctx, paint);
    if (args.command === 'ack') return ack(ctx, args.rest, paint);
    if (args.command === 'extract') return extract(ctx, args, paint);
    console.error(`Unknown command: ${args.command}`);
    return 2;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
}

module.exports = { main, HELP, hashContent };
