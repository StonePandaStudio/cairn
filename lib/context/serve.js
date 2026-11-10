'use strict';

// `cairn context serve` — an MCP server over the context resolver and the codeSource.
// One per workspace; agents in any repo of the workspace register it and ask
// cross-repo questions without opening the other repos. See DESIGN.md "Serve it".
//
// Hand-rolled on purpose (no MCP SDK — cairn stays zero-dependency): MCP over stdio
// is newline-delimited JSON-RPC 2.0, and this needs only initialize, ping,
// tools/list and tools/call. stdout carries the protocol and nothing else; anything
// human-readable goes to stderr.
//
// Requests are handled concurrently. Code answers come from providers: Serena keeps one
// long-lived, queued process per repo, so a first question about a repo can take a while
// (the language server starts); later ones are fast. All children stop when the client
// closes stdin.

const fs = require('fs');

const { build, check, counterparts } = require('./index');
const { createCodeSource } = require('./codesource');
const { buildAnchorResolver } = require('./anchors');

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'cairn-context', version: require('../../package.json').version };
const CODE_MEMO_MS = 10000;

const TOOLS = [
  {
    name: 'list_contexts',
    description:
      'List the authored context documents (ai/contexts/**) across the workspace repos. Returns node ids of the form <repo>:<path>, which the other tools take.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'Only this repo (a name from list of repos); omit for all.' } } },
  },
  {
    name: 'counterparts',
    description:
      'The documents in OTHER repos that describe the same thing as a node (declared via counterpartOf, plus inferred reverse links), with their content, so the other repo never has to be opened. Content is "unavailable" if the file cannot be read.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Node id, e.g. backend:ai/contexts/entities/invoice.md' } },
      required: ['id'],
    },
  },
  {
    name: 'check',
    description:
      'Report drift in the context layer: OFF_CONVENTION, DANGLING, MISSING_FRONTMATTER, CANDIDATE, and (with code=true) BROKEN_ANCHOR. Never an error — findings are information.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'boolean', description: 'Also verify `describes:` anchors against the code graph. Slower: may index repos.' } },
    },
  },
  {
    name: 'code_summary',
    description:
      'Architecture summary of one repo from the code-graph tool: languages, packages, entry points, routes, node/edge counts. No parsing happens in cairn. Status "unknown" if the tool is not installed.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
  },
  {
    name: 'code_symbol',
    description:
      'Does a code symbol (class, interface, function, type, …) with exactly this name exist in a repo? Returns found/missing with file and line range, or unknown if no code provider is installed. Answers come from the repo\'s language server, so they are compiler-grade; verified so far only for TypeScript/NestJS.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' }, name: { type: 'string', description: 'Exact symbol name, e.g. InvoiceService' } },
      required: ['repo', 'name'],
    },
  },
  {
    name: 'code_references',
    description:
      'Where is a symbol used? Returns the files and enclosing symbols that reference it, from the repo\'s language server (so path aliases and dependency-injected calls are resolved). File-level: it lists referencing places, it does not prove a change is safe. Test files are omitted unless include_tests is set. Status "ambiguous" lists candidates: repeat with `file`. Status "unknown" means no code provider is installed or it failed — never read that as "no references". Verified so far only for TypeScript/NestJS.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        symbol: { type: 'string', description: 'Name path, e.g. InvoiceService/payInvoice (Class/method). A bare name works when it is unique.' },
        file: { type: 'string', description: 'Repo-relative file of the symbol, to disambiguate.' },
        include_tests: { type: 'boolean', description: 'Also list references from test files (default false).' },
        limit: { type: 'integer', description: 'Max referencing files returned (default 50).' },
      },
      required: ['repo', 'symbol'],
    },
  },
];

const ok = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

function readContent(node) {
  try {
    return fs.readFileSync(node.absPath, 'utf8');
  } catch {
    return null;
  }
}

// `load()` -> { raw, repos, workspaceDir } | null. Injected so the CLI owns config
// discovery and tests can hand in a fixture. Called on every tool call, so edits to
// ai/contexts/** and repos.json are seen without restarting the server.
function createServer({ load }) {
  let source = null;
  let sourceKey = null;

  const codeSourceFor = (ws) => {
    const key = `${ws.workspaceDir}|${JSON.stringify(ws.raw.codeSource || null)}`;
    if (key !== sourceKey) {
      if (source) source.close().catch(() => {}); // config changed: stop the old providers' children
      source = createCodeSource({ config: ws.raw.codeSource, workspaceDir: ws.workspaceDir, memoMs: CODE_MEMO_MS });
      sourceKey = key;
    }
    return source;
  };

  const findRepo = (ws, name) => ws.repos.find((r) => r.name === name);
  const unknownRepo = (ws, name) => fail(`Unknown repo "${name}". Known: ${ws.repos.map((r) => r.name).join(', ')}`);

  async function callTool(name, args) {
    const ws = load();
    if (!ws) return fail('Workspace not loaded: repos.json missing or a repo path does not exist (see server stderr).');

    switch (name) {
      case 'list_contexts': {
        if (args.repo && !findRepo(ws, args.repo)) return unknownRepo(ws, args.repo);
        const graph = build(ws.repos);
        const nodes = [...graph.nodes.values()]
          .filter((n) => !args.repo || n.repo === args.repo)
          .map((n) => ({ id: n.id, title: n.title, describes: n.data.describes || null, onConvention: n.onConvention }));
        return ok({ repos: ws.repos.map((r) => r.name), count: nodes.length, nodes });
      }

      case 'counterparts': {
        if (!args.id) return fail('`id` is required.');
        const graph = build(ws.repos);
        const found = counterparts(graph, args.id);
        if (found === null) return fail(`Unknown node "${args.id}". Use list_contexts for valid ids.`);
        return ok({
          id: args.id,
          counterparts: found.map((n) => {
            const content = readContent(n);
            return {
              id: n.id,
              inferred: n.inferred,
              title: n.title,
              describes: n.data.describes || null,
              content: content === null ? 'unavailable' : content,
            };
          }),
        });
      }

      case 'check': {
        const graph = build(ws.repos);
        const opts = {};
        if (args.code) {
          const src = codeSourceFor(ws);
          if (src.available('symbols')) opts.resolveAnchor = await buildAnchorResolver({ graph, repos: ws.repos, source: src });
        }
        return ok(check(graph, opts));
      }

      case 'code_summary': {
        const repo = findRepo(ws, args.repo);
        if (!repo) return unknownRepo(ws, args.repo);
        return ok(await codeSourceFor(ws).summary(repo));
      }

      case 'code_symbol': {
        const repo = findRepo(ws, args.repo);
        if (!repo) return unknownRepo(ws, args.repo);
        if (!args.name) return fail('`name` is required.');
        return ok(await codeSourceFor(ws).symbol(repo, args.name));
      }

      case 'code_references': {
        const repo = findRepo(ws, args.repo);
        if (!repo) return unknownRepo(ws, args.repo);
        if (!args.symbol) return fail('`symbol` is required.');
        return ok(
          await codeSourceFor(ws).references(repo, args.symbol, {
            file: args.file,
            includeTests: Boolean(args.include_tests),
            limit: Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50,
          }),
        );
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  }

  // One JSON-RPC message in, one response out (or null for a notification).
  async function handle(msg) {
    const isRequest = msg && msg.id !== undefined && msg.id !== null;
    const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: isRequest ? msg.id : null, error: { code, message } });

    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(-32600, 'Invalid Request');
    if (!isRequest) return null; // notifications/initialized, notifications/cancelled, …

    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params && msg.params.protocolVersion;
        return reply({
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const p = msg.params || {};
        if (!TOOLS.some((t) => t.name === p.name)) return error(-32602, `Unknown tool: ${p.name}`);
        try {
          return reply(await callTool(p.name, p.arguments || {}));
        } catch (err) {
          // A bug in a tool must not kill the session — report it as a tool error.
          return reply(fail(`${p.name} failed: ${err.message}`));
        }
      }
      default:
        return error(-32601, `Method not found: ${msg.method}`);
    }
  }

  // Raw line in -> serialized response line out (or null).
  async function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (Array.isArray(msg)) return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batching is not supported' } });
    const res = await handle(msg);
    return res ? JSON.stringify(res) : null;
  }

  // Stop anything a code provider left running (language servers). Safe to call twice.
  async function close() {
    if (source) await source.close();
    source = null;
    sourceKey = null;
  }

  // Synchronous best-effort version for a process 'exit' handler.
  function closeSync() {
    if (source) source.closeSync();
  }

  return { handle, handleLine, close, closeSync, tools: TOOLS };
}

// Serve over stdio. Resolves once the client closes stdin and the server has stopped its
// children. Requests are handled concurrently; each response is one line.
function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    let buf = '';
    const inflight = new Set();
    // Last resort if the process is killed or exits abruptly: do not leave language servers behind.
    const onExit = () => server.closeSync();
    process.on('exit', onExit);

    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const p = server.handleLine(line).then((out) => { if (out) output.write(out + '\n'); }).finally(() => inflight.delete(p));
        inflight.add(p);
      }
    });
    input.on('end', async () => {
      await Promise.allSettled([...inflight]);
      await server.close();
      process.removeListener('exit', onExit);
      resolve();
    });
  });
}

module.exports = { createServer, serveStdio, TOOLS };
