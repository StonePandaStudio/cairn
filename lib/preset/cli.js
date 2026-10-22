'use strict';

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const { makePaint, table } = require('../paint');
const { PRESETS_DIR, PRESET_LESS, listPresets } = require('../presets');

const HELP = `cairn preset — what the bundled presets offer

Usage: cairn preset list [options]

  list             every preset in the bundle: kind, what it ships, and — when run
                   inside a cairn-managed repo — whether that repo's stack uses it

Options:
  --repo <path>    repo to read the active stack from (default: the repo cairn.config.json is in)
  --json           emit JSON instead of the table
  --no-color       disable ANSI colour

A repo's stack is set in its cairn.config.json — framework first, then add-ons.
\`core\` is applied to every repo and is not listed.
`;

function parseArgs(argv) {
  const args = { repo: null, json: false, color: process.stdout.isTTY, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '--color') args.color = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    } else args.positional.push(a);
  }
  return args;
}

// The stack of the repo cairn is being run in, or null when there is none — `list`
// works anywhere, the "in use" column just needs a repo to read.
function activeStack(args) {
  const start = args.repo ? path.resolve(args.repo) : process.cwd();
  const repoPath = args.repo ? start : findRepoRoot(start);
  if (!repoPath || !fs.existsSync(path.join(repoPath, 'cairn.config.json'))) return null;
  return loadRepoConfig(repoPath, { required: true }).stack;
}

function list(args, paint) {
  const presets = listPresets(PRESETS_DIR);
  const stack = activeStack(args);
  const use = (name) => (!stack ? null : stack[0] === name ? 'primary' : stack.includes(name) ? 'add-on' : null);

  if (args.json) {
    console.log(
      JSON.stringify(
        { stack, presets: presets.map((p) => ({ ...p, inUse: use(p.name) })) },
        null,
        2,
      ),
    );
    return 0;
  }

  const headers = ['Preset', 'Kind', 'Ships', ...(stack ? ['In use'] : []), 'Description'];
  const rows = presets.map((p) => [
    use(p.name) ? paint.green(p.name) : p.name,
    p.kind,
    p.ships.join(', '),
    ...(stack ? [use(p.name) || ''] : []),
    p.description,
  ]);
  console.log(table(rows, headers, paint));

  if (stack) {
    const names = new Set(presets.map((p) => p.name));
    const without = stack.filter((s) => !names.has(s));
    if (without.length) {
      console.log(
        paint.dim(
          `\nIn this repo's stack with no preset: ${without
            .map((s) => (PRESET_LESS.has(s) ? `${s} (core only, deliberate)` : `${s} (unknown — typo?)`))
            .join(', ')}`,
        ),
      );
    }
  }
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  const [sub] = args.positional;
  if (args.help || !sub) {
    process.stdout.write(HELP);
    return 0;
  }

  const paint = makePaint(args.color);
  try {
    if (sub === 'list') return list(args, paint);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  }
  console.error(`Unknown preset command: ${sub}`);
  process.stderr.write(HELP);
  return 2;
}

module.exports = { main, HELP };
