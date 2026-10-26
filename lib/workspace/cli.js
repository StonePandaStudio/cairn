'use strict';

// cairn workspace — manage the repo list in a workspace repos.json.
//
// The file is also read by doctor, upgrade and context, and carries hand-written
// blocks (`shared`, `normalize`, `$comment`). Every command here parses it, touches
// only `repos`, and writes the rest back as it found it.

const fs = require('fs');
const path = require('path');

const { loadRepoConfig, normalizeStack, ConfigError } = require('../config');
const { checkStack } = require('../presets');
const { makePaint, table } = require('../paint');

const HELP = `cairn workspace — manage the repo list in a workspace repos.json

Usage: cairn workspace <command> [options]

  init                 create an empty repos.json
  add <path>           add a repo
  remove <name>        remove a repo
  list                 show the repos

Options:
  --config <file>      workspace file (default: ./repos.json)
  --name <name>        add: name in the workspace (default: the folder name)
  --stack <a,b>        add: framework first, then add-ons (default: read from the
                       repo's cairn.config.json; required when it has none)
  --role <text>        add: one line on what the repo is for, shown to the agents
  --json               list: emit JSON
  --no-color           disable ANSI colour

\`add\` creates repos.json when it is missing. Paths are stored relative to the
workspace file. Nothing outside the \`repos\` list is changed.
`;

function parseArgs(argv) {
  const args = { config: 'repos.json', positional: [], json: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--stack') args.stack = argv[++i];
    else if (a === '--role') args.role = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    } else args.positional.push(a);
  }
  return args;
}

function readWorkspace(file) {
  if (!fs.existsSync(file)) return null;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${file}: invalid JSON — ${err.message}`);
  }
  if (!Array.isArray(cfg.repos)) throw new ConfigError(`${file}: no "repos" array`);
  return cfg;
}

// One repo per line, the way the file is written by hand; the rest as plain JSON.
function entryText(entry) {
  const fields = Object.entries(entry).map(([k, v]) => {
    const val = Array.isArray(v) ? `[${v.map((s) => JSON.stringify(s)).join(', ')}]` : JSON.stringify(v);
    return `"${k}": ${val}`;
  });
  return `{ ${fields.join(', ')} }`;
}

function serialize(cfg) {
  const marker = '"__cairn_repos__"';
  const body = JSON.stringify({ ...cfg, repos: '__cairn_repos__' }, null, 2);
  const lines = cfg.repos.map((e) => '    ' + entryText(e)).join(',\n');
  const list = cfg.repos.length ? `[\n${lines}\n  ]` : '[]';
  return body.replace(marker, () => list) + '\n';
}

function writeWorkspace(file, cfg) {
  fs.writeFileSync(file, serialize(cfg), 'utf8');
}

function init(args) {
  const file = path.resolve(args.config);
  if (fs.existsSync(file)) {
    console.error(`Already exists: ${file}`);
    return 2;
  }
  writeWorkspace(file, { repos: [] });
  console.log(`Created ${file}`);
  console.log('Add repos with: cairn workspace add <path>');
  return 0;
}

function add(args) {
  const [target] = args.positional.slice(1);
  if (!target) {
    console.error('Usage: cairn workspace add <path> [--name n] [--stack a,b] [--role text]');
    return 2;
  }
  const repoPath = path.resolve(target);
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    console.error(`Not a directory: ${repoPath}`);
    return 2;
  }

  const file = path.resolve(args.config);
  const cfg = readWorkspace(file) || { repos: [] };
  const created = !fs.existsSync(file);

  const name = args.name || path.basename(repoPath);
  const rel = path.relative(path.dirname(file), repoPath).replace(/\\/g, '/') || '.';
  const clash = cfg.repos.find((r) => r.name === name || path.resolve(path.dirname(file), r.path) === repoPath);
  if (clash) {
    console.error(`Already in the workspace as "${clash.name}" (${clash.path}). Remove it first to change it.`);
    return 2;
  }

  let stack;
  if (args.stack) stack = normalizeStack(args.stack.split(',').map((s) => s.trim()).filter(Boolean));
  else {
    const repoConfig = loadRepoConfig(repoPath);
    if (repoConfig.unmanaged) {
      console.error(`${repoPath} has no cairn.config.json — pass --stack <framework[,add-on]> (or "unknown").`);
      return 2;
    }
    stack = repoConfig.stack;
  }
  if (!stack.length) {
    console.error('Empty --stack.');
    return 2;
  }
  if (!(stack.length === 1 && stack[0] === 'unknown') && !checkStack(stack)) return 2;

  const entry = { name, path: rel, stack };
  if (args.role) entry.role = args.role;
  cfg.repos.push(entry);
  writeWorkspace(file, cfg);

  console.log(`${created ? 'Created ' + file + ' and added' : 'Added'} ${name} (${stack.join(', ')}) → ${rel}`);
  return 0;
}

function remove(args) {
  const [name] = args.positional.slice(1);
  if (!name) {
    console.error('Usage: cairn workspace remove <name>');
    return 2;
  }
  const file = path.resolve(args.config);
  const cfg = readWorkspace(file);
  if (!cfg) {
    console.error(`Workspace config not found: ${file}`);
    return 2;
  }
  const next = cfg.repos.filter((r) => r.name !== name);
  if (next.length === cfg.repos.length) {
    console.error(`Not in the workspace: ${name}`);
    return 2;
  }
  cfg.repos = next;
  writeWorkspace(file, cfg);
  console.log(`Removed ${name}. The repo itself is untouched.`);
  return 0;
}

function list(args) {
  const file = path.resolve(args.config);
  const cfg = readWorkspace(file);
  if (!cfg) {
    console.error(`Workspace config not found: ${file}`);
    return 2;
  }
  if (args.json) {
    console.log(JSON.stringify(cfg.repos, null, 2));
    return 0;
  }
  const paint = makePaint(args.color);
  if (!cfg.repos.length) {
    console.log(paint.dim('No repos. Add one with: cairn workspace add <path>'));
    return 0;
  }
  const dir = path.dirname(file);
  const rows = cfg.repos.map((r) => {
    const exists = fs.existsSync(path.resolve(dir, r.path));
    const managed = exists && fs.existsSync(path.join(path.resolve(dir, r.path), 'cairn.config.json'));
    return [
      '  ' + r.name,
      [].concat(r.stack || []).join(', '),
      r.path,
      !exists ? paint.red('path missing') : managed ? paint.green('cairn') : paint.dim('not cairn-managed'),
    ];
  });
  console.log(table(rows, ['  REPO', 'STACK', 'PATH', 'STATE'], paint));
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  const [command] = args.positional;
  if (args.help || !command) {
    process.stdout.write(HELP);
    return args.help || !command ? 0 : 2;
  }
  try {
    switch (command) {
      case 'init':
        return init(args);
      case 'add':
        return add(args);
      case 'remove':
        return remove(args);
      case 'list':
        return list(args);
      default:
        console.error(`Unknown command: ${command}`);
        process.stderr.write(HELP);
        return 2;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
}

module.exports = { main, parseArgs, serialize, HELP };
