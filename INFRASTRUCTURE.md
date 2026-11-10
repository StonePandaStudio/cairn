# Infrastructure — context layer + code graph

How the runtime pieces of `cairn context` fit together today. This is the *current*
state, not the plan: the why is in `DESIGN.md`, the order of work in `PLAN.md`.

**The diagram lives in [`infrastructure.mmd`](infrastructure.mmd)** (plain Mermaid, one
copy). View it with GitHub (renders `.mmd` files), the VS Code Mermaid extension, or
<https://mermaid.live>. This page only explains it.

**Keep the diagram in step with the code.** Update `infrastructure.mmd` in the same change
whenever you touch any of: `lib/context/serve.js` (tools, transport),
`lib/context/codesource.js` (capabilities, routing) or `lib/context/providers/*` (how a tool is
found, run, cached or invalidated),
`lib/context/index.js` (what the resolver reads), `lib/context/cli.js` (subcommands), or
where files live on disk (`_cairn/tools/`, `_cairn/cache/`).

## Reading it

- **Solid arrows** are runtime calls; **dotted arrows** are authored links or setup-time
  actions.
- **One server per agent session.** Each session spawns its own `cairn context serve`;
  they share the on-disk indexes.
- **cairn parses nothing.** The third-party binary does all code parsing, one spawn per
  call (`DESIGN.md` "The boundary").
- **Cross-repo links are authored** (`counterpartOf` in `ai/contexts/`). The tool's own
  cross-repo mode found no edges on snap-proof backend ↔ frontend.
- **Freshness is cairn's job.** The tool's watcher only covers a live MCP session, so the
  fingerprint gate decides whether to re-index before answering.
- **Not drawn:** the core workflow tooling (`init`, `render`, `sync`, `doctor`, the tracker
  client) — a separate concern from this layer.

- **Providers are pluggable and language-neutral.** The facade routes by capability
  (`symbols`, `references`, `summary`); a provider registers itself and owns its parsers or
  language servers, so a new language needs a provider (or a language server for Serena),
  not a core change. Routing: `codeSource.providers` in `repos.json`, else a preference
  order, else any registered provider with the capability.
- **Serena is the default provider** (`symbols`, `references`); codebase-memory-mcp is
  optional and only serves `summary` (+ `symbols` when Serena is absent). codebase-memory-mcp
  is not used for references: it does not resolve tsconfig `paths` aliases (20% caller
  recall on three NestJS repos). Serena measured 99% on the same repos, also when driven
  through cairn's own provider (TypeScript/NestJS only).
- **Serena is long-lived, one process per repo**, started on the first question: a cold
  language server takes ~20–60 s (first run in a new home also installs it), later calls
  ~0.3 s. Calls are queued per repo, a process that dies is restarted once, a hung call
  times out and its process tree is killed, and everything stops on `close()`/exit (Serena
  exits on stdin EOF and takes its language servers with it; no leftovers measured on
  Windows).
- **Read-only by construction.** `setup` writes `fixed_tools` into a private `SERENA_HOME`,
  so Serena exposes only five read tools (no editing, shell or memory tools).
- **Footprint:** a venv (~146 MB) plus ~27 MB per language server, inside the workspace's
  `_cairn/tools/`; Serena also writes `.serena/` into each repo it opens (gitignored by
  `setup`). On Windows the workspace path must stay under ~125 chars (pip MAX_PATH).

## Not built yet

`cairn sync` registering the server in each repo's MCP config, a Sourcegraph (HTTP)
provider, `cairn context adopt`, the `local` tracker provider, OpenAPI contract checks.
Pre-installing the language server during `setup` (to avoid the one-time cold start) is also
not done.

Agent docs: the core `code-scout` subagent (tools list includes `mcp__cairn__code_references` /
`code_symbol`) and the architect doc tell agents to prefer `code_references` for callers of a
named symbol, falling back to Grep on `unknown`. This assumes the MCP server is registered
under the name `cairn`; registration is still by hand (no `cairn sync` support yet).

## Language status

Only **TypeScript / NestJS** has been measured here. Other languages (Java, C#, …) are
"supported by the provider, untested here" until a real repo has been run through the
recall check.
