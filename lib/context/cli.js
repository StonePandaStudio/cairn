'use strict';

const fs = require('fs');
const path = require('path');

const { resolveRepos } = require('../doctor');
const { makePaint } = require('../paint');
const { build, check, counterparts } = require('./index');

const HELP = `cairn context — the cross-repo authored context layer (prototype)

Usage: cairn context <subcommand> [options]

  build                      resolve ai/contexts/**/*.md across the workspace into a graph
  check                      report OFF_CONVENTION / DANGLING / MISSING_FRONTMATTER / CANDIDATE
                             (never fails CI — see --strict to opt into a non-zero exit)
  counterparts <id>          resolved counterparts for one node, e.g. backend:ai/contexts/entities/invoice.md

Options (all subcommands):
  --config <file>            workspace config (default: ./repos.json)
  --json                     emit JSON instead of the table
  --strict                   check only: exit 1 if any finding was reported
  --no-color                 disable ANSI colour

BROKEN_ANCHOR / CONTENT_MISMATCH / TRACKER_DESYNC are not computed yet — they need
a codeSource MCP, an OpenAPI contract, or the \`local\` tracker provider, none of
which cairn has wired up. \`check\` reports this once, not as per-file noise.
`;

function parseArgs(argv) {
  const args = { config: 'repos.json', json: false, strict: false, color: process.stdout.isTTY };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '--color') args.color = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    } else positional.push(a);
  }
  args.positional = positional;
  return args;
}

function loadGraph(config) {
  const configFile = path.resolve(config);
  if (!fs.existsSync(configFile)) {
    console.error(`Workspace config not found: ${configFile}`);
    console.error(`Run cairn context from the directory holding repos.json, or pass --config <file>.`);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const repos = resolveRepos(raw, path.dirname(configFile));
  const missing = repos.filter((r) => !fs.existsSync(r.path));
  if (missing.length) {
    console.error(`Repo path not found: ${missing.map((r) => r.path).join(', ')}`);
    return null;
  }
  return { graph: build(repos), repos };
}

const FINDING_COLOR = {
  OFF_CONVENTION: 'yellow',
  DANGLING: 'red',
  MISSING_FRONTMATTER: 'dim',
  CANDIDATE: 'cyan',
};

function renderBuild(graph, repos, paint) {
  const lines = [];
  lines.push(paint.bold(`cairn context build — ${repos.map((r) => r.name).join(', ')}`));
  lines.push('');
  lines.push(`${graph.nodes.size} node(s), ${graph.edges.filter((e) => !e.inferred).length} declared edge(s), ${graph.dangling.length} dangling reference(s).`);
  if (graph.nodes.size) {
    lines.push('');
    for (const node of graph.nodes.values()) {
      const tag = node.onConvention ? '' : paint.yellow(' [off-convention]');
      lines.push(`  ${node.id}${tag}`);
    }
  }
  return lines.join('\n');
}

function renderCheck(result, paint) {
  const lines = [];
  lines.push(paint.bold('cairn context check'));
  lines.push('');
  if (!result.findings.length) {
    lines.push(paint.green('No findings.'));
  } else {
    for (const f of result.findings) {
      const tag = paint[FINDING_COLOR[f.type] || 'dim'](f.type.padEnd(18));
      lines.push(`  ${tag} ${f.id}  ${paint.dim(f.detail)}`);
    }
  }
  lines.push('');
  lines.push(paint.dim(`Not checked (${result.notCheckedReason}): ${result.notChecked.join(', ')}`));
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const [sub, ...rest] = argv;
  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const args = parseArgs(rest);
  if (args.error) return args.error;
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const paint = makePaint(args.color);

  if (sub === 'build') {
    const loaded = loadGraph(args.config);
    if (!loaded) return 2;
    const { graph, repos } = loaded;
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            nodes: [...graph.nodes.values()],
            edges: graph.edges,
            dangling: graph.dangling,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(renderBuild(graph, repos, paint));
    }
    return 0;
  }

  if (sub === 'check') {
    const loaded = loadGraph(args.config);
    if (!loaded) return 2;
    const result = check(loaded.graph);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(renderCheck(result, paint));
    return args.strict && result.findings.length ? 1 : 0;
  }

  if (sub === 'counterparts') {
    const id = args.positional[0];
    if (!id) {
      console.error('Usage: cairn context counterparts <id>');
      return 2;
    }
    const loaded = loadGraph(args.config);
    if (!loaded) return 2;
    const result = counterparts(loaded.graph, id);
    if (result === null) {
      console.error(`Unknown node: ${id}`);
      return 2;
    }
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!result.length) {
      console.log(paint.dim(`${id} has no declared or inferred counterparts.`));
    } else {
      for (const c of result) {
        console.log(`  ${c.id}${c.inferred ? paint.dim(' (inferred)') : ''}`);
      }
    }
    return 0;
  }

  console.error(`Unknown subcommand: ${sub}`);
  process.stderr.write(HELP);
  return 2;
}

module.exports = { main, HELP };
