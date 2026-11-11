'use strict';

const fs = require('fs');
const path = require('path');

const { resolveRepos } = require('../doctor');
const { makePaint } = require('../paint');
const { build, check, suggest, counterparts } = require('./index');
const { createCodeSource, setupProvider, SETUP_PROVIDERS, SETUP_DEFAULT } = require('./codesource');
const { createServer, serveStdio } = require('./serve');
const { buildAnchorResolver } = require('./anchors');
const { registerAll } = require('./register');
const adopt = require('./adopt');

const HELP = `cairn context — the cross-repo authored context layer (prototype)

Usage: cairn context <subcommand> [options]

  build                      resolve ai/contexts/**/*.md across the workspace into a graph
  check                      report OFF_CONVENTION / DANGLING / MISSING_FRONTMATTER / CANDIDATE
                             (never fails CI — see --strict to opt into a non-zero exit)
  counterparts <id>          resolved counterparts for one node, e.g. backend:ai/contexts/entities/invoice.md
  setup [--provider <id>]    install a pinned code provider into <workspace>/_cairn/tools/ (once per workspace).
                             Default: serena (symbols + references, any language it has a language server for).
                             Also starts each repo's language server once so the first agent question is fast
                             (--no-warm to skip). --provider codebase-memory-mcp adds the optional architecture-summary tool; repeatable, or "all".
  code <what> <repo> [name]  ask a code provider: symbol <repo> <name> | references <repo> <Class/method> [--file <path>]
                             | summary <repo> (needs codebase-memory-mcp) | index <repo>
  serve                      MCP server (stdio) over the above — list_contexts, counterparts, check,
                             code_symbol, code_references, code_summary.
  adopt [--write] [--link-candidates]
                             add missing frontmatter to existing docs: type from the category folder, and with
                             --link-candidates counterpartOf for same-path pairs in another repo. Only adds
                             keys, never edits a body or an existing key. Dry run unless --write. describes is
                             the discovery agent job (it needs a symbol).
  register [--force]         add the server as "cairn" to each repo's .mcp.json (merge; other servers kept; an
                             existing different "cairn" entry is left alone unless --force). Claude Code asks you
                             to approve a project server the first time. Or by hand:
                             { "command": "npx", "args": ["cairn","context","serve","--config","<path>/repos.json"] }

Options (all subcommands):
  --config <file>            workspace config (default: ./repos.json; inside a single repo with no repos.json,
                             that repo alone is the workspace)
  --json                     emit JSON instead of the table
  --strict                   check only: exit 1 if any finding was reported
  --no-code                  check only: skip code-graph lookups (BROKEN_ANCHOR stays unchecked)
  --no-color                 disable ANSI colour

BROKEN_ANCHOR needs the code-graph tool (\`cairn context setup\`); without it \`check\`
reports it once as unchecked, never as a failure. CONTENT_MISMATCH / TRACKER_DESYNC need
an OpenAPI contract or the \`local\` tracker provider, neither wired yet.
`;

function parseArgs(argv) {
  const args = { config: 'repos.json', configExplicit: false, json: false, strict: false, code: true, providers: [], warm: true, color: process.stdout.isTTY };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') { args.config = argv[++i]; args.configExplicit = true; }
    else if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--no-code') args.code = false;
    else if (a === '--force') args.force = true;
    else if (a === '--write') args.write = true;
    else if (a === '--link-candidates') args.linkCandidates = true;
    else if (a === '--no-warm') args.warm = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--provider') args.providers.push(argv[++i]);
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

// One repo, no repos.json: when no --config was given, there is no repos.json in the current
// directory, and the current directory is a repo (a git checkout or a cairn repo), the
// workspace is that repo alone. Tools then live in `<repo>/_cairn/tools/`.
function singleRepoWorkspace(dir) {
  if (!fs.existsSync(path.join(dir, '.git')) && !fs.existsSync(path.join(dir, 'cairn.config.json'))) return null;
  const raw = { repos: [{ name: path.basename(dir) || 'repo', path: '.' }] };
  return { raw, repos: resolveRepos(raw, dir), workspaceDir: dir, implicit: true };
}

function loadWorkspace(config, explicit = true) {
  const configFile = path.resolve(config);
  if (!fs.existsSync(configFile) && !explicit) {
    const single = singleRepoWorkspace(path.dirname(configFile));
    if (single) return single;
  }
  if (!fs.existsSync(configFile)) {
    console.error(`Workspace config not found: ${configFile}`);
    console.error(`Run cairn context from the directory holding repos.json (or from inside a single repo), or pass --config <file>.`);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const repos = resolveRepos(raw, path.dirname(configFile));
  const missing = repos.filter((r) => !fs.existsSync(r.path));
  if (missing.length) {
    console.error(`Repo path not found: ${missing.map((r) => r.path).join(', ')}`);
    return null;
  }
  return { raw, repos, workspaceDir: path.dirname(configFile) };
}

function loadGraph(config, explicit) {
  const ws = loadWorkspace(config, explicit);
  if (!ws) return null;
  return { ...ws, graph: build(ws.repos) };
}

function codeSourceFor(ws) {
  return createCodeSource({ config: ws.raw.codeSource, workspaceDir: ws.workspaceDir });
}

const FINDING_COLOR = {
  OFF_CONVENTION: 'yellow',
  DANGLING: 'red',
  BROKEN_ANCHOR: 'red',
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
  if (result.unknownAnchors && result.unknownAnchors.length) {
    const why = [...new Set(result.unknownAnchors.map((u) => u.reason))].join('; ');
    lines.push(paint.dim(`${result.unknownAnchors.length} anchor(s) unknown (${why}) — run \`cairn context setup\` or check the repo path.`));
  }
  lines.push(paint.dim(`Not checked (${result.notCheckedReason}): ${result.notChecked.join(', ')}`));
  return lines.join('\n');
}

// One throwaway lookup per repo, so each repo's language server is installed and started once.
async function warmUp(source, repos) {
  const out = [];
  for (const repo of repos) {
    const t0 = Date.now();
    const r = await source.symbol(repo, '__cairn_warmup__');
    out.push({ repo: repo.name, ok: r.status !== 'unknown', ms: Date.now() - t0, ...(r.status === 'unknown' ? { reason: r.reason } : {}) });
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
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
    const loaded = loadGraph(args.config, args.configExplicit);
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
    const loaded = loadGraph(args.config, args.configExplicit);
    if (!loaded) return 2;
    const source = args.code ? codeSourceFor(loaded) : null;
    let result;
    try {
      // Only wire BROKEN_ANCHOR when a provider can answer `symbols`; otherwise it stays
      // in `notChecked`, as before, instead of listing every anchor as unknown.
      const opts = source && source.available('symbols')
        ? { resolveAnchor: await buildAnchorResolver({ graph: loaded.graph, repos: loaded.repos, source }) }
        : {};
      result = check(loaded.graph, opts);
    } finally {
      if (source) await source.close();
    }
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
    const loaded = loadGraph(args.config, args.configExplicit);
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

  if (sub === 'setup') {
    const ws = loadWorkspace(args.config, args.configExplicit);
    if (!ws) return 2;
    const wanted = args.providers.length ? (args.providers.includes('all') ? SETUP_PROVIDERS : args.providers) : SETUP_DEFAULT;
    const unknownId = wanted.find((id) => !SETUP_PROVIDERS.includes(id));
    if (unknownId) {
      console.error(`Unknown provider "${unknownId}". Known: ${SETUP_PROVIDERS.join(', ')}, all`);
      return 2;
    }
    const reports = {};
    let failed = false;
    for (const id of wanted) {
      try {
        reports[id] = setupProvider(id, { workspaceDir: ws.workspaceDir, repos: ws.repos });
      } catch (err) {
        reports[id] = { error: err.message };
        failed = true;
      }
    }
    // Pre-install the language servers: Serena fetches one per language on first use (~1 min),
    // which would otherwise land on an agent's first question. One throwaway lookup per repo.
    if (args.warm && reports.serena && !reports.serena.error) {
      const source = codeSourceFor(ws);
      try {
        reports.serena.warmed = await warmUp(source, ws.repos);
      } finally {
        await source.close();
      }
    }
    if (args.json) {
      console.log(JSON.stringify(reports, null, 2));
    } else {
      console.log(paint.bold('cairn context setup'));
      for (const [id, r] of Object.entries(reports)) {
        if (r.error) console.log(`  ${paint.red('failed')}  ${id}: ${r.error}`);
        else {
          console.log(`  installed ${id} ${r.installed} → ${r.dir.replace(/\\/g, '/')}`);
          for (const f of r.ignored) console.log(`  gitignored  ${f}`);
          for (const w of r.warmed || []) console.log(`  ${w.ok ? 'warmed' : paint.yellow('not warmed')}  ${w.repo}${w.ok ? ` (${(w.ms / 1000).toFixed(1)} s)` : `: ${w.reason}`}`);
        }
      }
      console.log(paint.dim('  Nothing global was touched; your agent configs are untouched.'));
    }
    return failed ? 1 : 0;
  }

  if (sub === 'code') {
    const [what, repoName, name] = args.positional;
    if (!['summary', 'symbol', 'references', 'index'].includes(what) || !repoName || (['symbol', 'references'].includes(what) && !name)) {
      console.error('Usage: cairn context code summary <repo> | symbol <repo> <name> | references <repo> <Class/method> [--file <path>] | index <repo>');
      return 2;
    }
    const ws = loadWorkspace(args.config, args.configExplicit);
    if (!ws) return 2;
    const repo = ws.repos.find((r) => r.name === repoName);
    if (!repo) {
      console.error(`Unknown repo: ${repoName} (known: ${ws.repos.map((r) => r.name).join(', ')})`);
      return 2;
    }
    const source = codeSourceFor(ws);
    let result;
    try {
      result =
        what === 'summary' ? await source.summary(repo)
        : what === 'symbol' ? await source.symbol(repo, name)
        : what === 'references' ? await source.references(repo, name, { file: args.file })
        : await source.index(repo);
    } finally {
      await source.close();
    }
    if (args.json || what === 'summary' || what === 'references') console.log(JSON.stringify(result, null, 2));
    else if (result.status === 'unknown') console.log(paint.yellow(`unknown — ${result.reason}`) + paint.dim(`\n  ${result.hint}`));
    else if (what === 'index') console.log(`${result.project} ${result.reindexed ? 'indexed' : 'already fresh'}`);
    else if (result.status === 'missing') console.log(paint.red(`missing — no symbol ${name} in ${repoName}`));
    else for (const m of result.matches) console.log(`  ${m.label.padEnd(10)} ${m.name}  ${paint.dim(`${m.file}:${m.lines}`)}`);
    return result.status === 'unknown' ? 1 : 0;
  }

  if (sub === 'adopt') {
    const loaded = loadGraph(args.config, args.configExplicit);
    if (!loaded) return 2;
    const candidates = suggest(loaded.graph.nodes);
    const result = adopt.plan(loaded.graph, { candidates, linkCandidates: args.linkCandidates });
    const applied = args.write ? adopt.apply(result.items) : null;
    if (args.json) console.log(JSON.stringify({ write: Boolean(args.write), ...result, ...(applied || {}) }, null, 2));
    else {
      console.log(paint.bold(`cairn context adopt${args.write ? '' : ' (dry run — pass --write to apply)'}`));
      if (!result.items.length) console.log(paint.green('  Nothing to add.'));
      for (const i of result.items) {
        const failed = applied && applied.failed.find((f) => f.id === i.id);
        const keys = Object.entries(i.add).map(([k, v]) => `${k}: ${v}`).join(', ');
        console.log(`  ${failed ? paint.red('failed ') : applied ? paint.green('wrote  ') : paint.dim('would  ')} ${i.id}  ${paint.dim(i.hadFrontmatter ? '+' : 'new frontmatter:')} ${keys}${failed ? ' — ' + failed.reason : ''}`);
      }
      for (const s of result.skipped) console.log(`  ${paint.yellow('skipped')} ${s.id}  ${paint.dim(s.reason)}`);
      if (!args.linkCandidates && candidates.some((c) => c.reason === 'same relative path')) {
        console.log(paint.dim('  Same-path pairs in other repos were found; --link-candidates writes counterpartOf for them (review the pairs first).'));
      }
      console.log(paint.dim('  Next: ask the discovery agent to add `describes:` (it confirms symbols with code_symbol), then `cairn context check`.'));
    }
    return applied && applied.failed.length ? 1 : 0;
  }

  if (sub === 'register') {
    const ws = loadWorkspace(args.config, args.configExplicit);
    if (!ws) return 2;
    const results = registerAll(ws.repos, ws.implicit ? null : path.resolve(args.config), { force: args.force, dryRun: args.dryRun });
    if (args.json) console.log(JSON.stringify(results, null, 2));
    else {
      console.log(paint.bold(`cairn context register${args.dryRun ? ' (dry run)' : ''}`));
      for (const r of results) {
        const tag = { created: paint.green('created'), added: paint.green('added'), replaced: paint.yellow('replaced'), unchanged: paint.dim('unchanged'), differs: paint.yellow('differs'), invalid: paint.red('invalid') }[r.action];
        const note = r.action === 'differs' ? ' — an existing "cairn" entry is different; rerun with --force to replace it'
          : r.action === 'invalid' ? ' — not a JSON object (or mcpServers is not an object); left untouched' : '';
        console.log(`  ${tag.padEnd(18)} ${r.repo}  ${paint.dim(r.file.replace(/\\/g, '/'))}${note}`);
      }
      console.log(paint.dim('  Server name is "cairn" (the agent docs refer to mcp__cairn__*). Nothing global was touched.'));
    }
    return results.some((r) => r.action === 'differs' || r.action === 'invalid') ? 1 : 0;
  }

  if (sub === 'serve') {
    // stdout is the protocol channel: no banner, no console.log from here on.
    const server = createServer({
      load: () => {
        try {
          return loadWorkspace(args.config, args.configExplicit);
        } catch (err) {
          console.error(`cairn context serve: cannot load ${args.config}: ${err.message}`);
          return null;
        }
      },
    });
    await serveStdio(server); // resolves when the client closes stdin; long-lived children are stopped first
    return 0;
  }

  console.error(`Unknown subcommand: ${sub}`);
  process.stderr.write(HELP);
  return 2;
}

module.exports = { main, HELP, warmUp };
