'use strict';

// cairn docs — fill the `docs` key of cairn.config.json without hand-editing JSON.
//
// Only the `docs` value is replaced, as text: every other key, comment-free formatting and the
// file's indent stay as the user wrote them (the `workspace add` precedent). Entries cairn did not
// add are kept exactly as they were.

const fs = require('fs');
const path = require('path');
const { findRepoRoot, CONFIG_NAME } = require('./config');
const { normalizeDocs } = require('./docs');
const { makePaint, table } = require('./paint');

const HELP = `cairn docs — list the project's own documentation for the agents (the "docs" key)

Usage: cairn docs <command> [options]

  add <path>...        add a file, or a folder (one entry per .md file under it)
  list                 show the entries
  remove <path>...     drop an entry (a folder path also drops the entries under it)

Options:
  --about <text>       add: what the doc is about (default: the file's first heading)
  --when <text>        add: when to read it (default: "the task touches this area")
  --no-expand          add: keep a folder as one entry
  --dry-run            add, remove: show the change, write nothing
  --repo <dir>         the repo (default: the nearest one up from here)
  --json               list: emit JSON
  --no-color           disable ANSI colour

Only the "docs" key of cairn.config.json is edited. Paths are stored relative to the repo and may
point outside it ("../docs/adr"). Then run \`cairn sync\`: it carries the Project docs section into
ai/AGENTS.md.
`;

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);

function parseArgs(argv) {
  const args = { positional: [], expand: true, dryRun: false, json: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--about') args.about = argv[++i];
    else if (a === '--when') args.when = argv[++i];
    else if (a === '--no-expand') args.expand = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--repo') args.repo = argv[++i];
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

// ---- editing the "docs" value as text ---------------------------------------------------------

// Index just past the string that starts at `i` (a double quote).
function skipString(text, i) {
  for (i++; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

// Index just past the JSON value that starts at `i`.
function skipValue(text, i) {
  const c = text[i];
  if (c === '"') return skipString(text, i);
  if (c === '[' || c === '{') {
    let depth = 0;
    for (; i < text.length; i++) {
      if (text[i] === '"') i = skipString(text, i) - 1;
      else if (text[i] === '[' || text[i] === '{') depth++;
      else if (text[i] === ']' || text[i] === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return text.length;
  }
  while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
  return i;
}

// Where the top-level property `key` sits in the text of a JSON object:
// { valueStart, valueEnd } of its value, or null; `lastEnd` is the end of the last property
// (-1 for an empty object) and `close` the index of the closing brace.
function locate(text, key) {
  let i = text.indexOf('{');
  const found = { value: null, lastEnd: -1, close: text.lastIndexOf('}') };
  if (i < 0) return found;
  i++;
  while (i < found.close) {
    while (i < found.close && /[\s,]/.test(text[i])) i++;
    if (i >= found.close || text[i] !== '"') break;
    const keyEnd = skipString(text, i);
    const name = JSON.parse(text.slice(i, keyEnd));
    i = keyEnd;
    while (i < text.length && /[\s:]/.test(text[i])) i++;
    const end = skipValue(text, i);
    if (name === key) found.value = { start: i, end };
    found.lastEnd = end;
    i = end;
  }
  return found;
}

function detectIndent(text) {
  const m = /\n([ \t]+)"/.exec(text);
  return m ? m[1] : '  ';
}

function formatEntry(entry) {
  if (typeof entry === 'string') return JSON.stringify(entry);
  return `{ ${Object.entries(entry).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
}

function formatDocs(entries, indent) {
  if (!entries.length) return '[]';
  return `[\n${entries.map((e) => `${indent}${indent}${formatEntry(e)}`).join(',\n')}\n${indent}]`;
}

// The config text with `docs` set to `entries`: replaced in place, or added as the last property.
function withDocs(text, entries) {
  const indent = detectIndent(text);
  const body = formatDocs(entries, indent);
  const at = locate(text, 'docs');
  if (at.value) return text.slice(0, at.value.start) + body + text.slice(at.value.end);
  if (at.close < 0) throw new Error(`${CONFIG_NAME} is not a JSON object`);
  const property = `${JSON.stringify('docs')}: ${body}`;
  if (at.lastEnd < 0) return `${text.slice(0, at.close).replace(/\s*$/, '')}\n${indent}${property}\n${text.slice(at.close)}`;
  return `${text.slice(0, at.lastEnd)},\n${indent}${property}${text.slice(at.lastEnd)}`;
}

// ---- helpers ----------------------------------------------------------------------------------

const toRel = (repo, p) => path.relative(repo, path.resolve(p)).replace(/\\/g, '/') || '.';
const entryPath = (e) => String(typeof e === 'string' ? e : e.path).trim().replace(/\\/g, '/').replace(/\/+$/, '');

function firstHeading(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
  const m = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text);
  return m ? m[1].trim().slice(0, 120) : null;
}

function markdownUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') && !SKIP_DIRS.has(ent.name)) walk(path.join(d, ent.name));
      } else if (/\.md$/i.test(ent.name)) out.push(path.join(d, ent.name));
    }
  };
  walk(dir);
  return out;
}

function openRepo(args) {
  const start = args.repo ? path.resolve(args.repo) : process.cwd();
  const repo = args.repo ? start : findRepoRoot(start);
  const file = repo && path.join(repo, CONFIG_NAME);
  if (!file || !fs.existsSync(file)) {
    console.error(`No ${CONFIG_NAME} found — run \`cairn init\` first`);
    return null;
  }
  const text = fs.readFileSync(file, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    return null;
  }
  return { repo, file, text, existing: Array.isArray(raw.docs) ? raw.docs : [], raw };
}

function save(ctx, entries, dryRun) {
  normalizeDocs(entries, CONFIG_NAME); // a UserError here stops before anything is written
  if (dryRun) return;
  fs.writeFileSync(ctx.file, withDocs(ctx.text, entries), 'utf8');
}

// ---- commands ---------------------------------------------------------------------------------

function add(args, paint) {
  const targets = args.positional.slice(1);
  if (!targets.length) {
    console.error('Usage: cairn docs add <path>... [--about text] [--when text] [--no-expand] [--dry-run]');
    return 2;
  }
  const ctx = openRepo(args);
  if (!ctx) return 2;
  if (ctx.raw.docs !== undefined && !Array.isArray(ctx.raw.docs)) {
    console.error(`${ctx.file}: docs must be an array — fix it by hand first`);
    return 2;
  }

  const have = new Set(ctx.existing.map(entryPath));
  const entries = [...ctx.existing];
  const report = [];
  const push = (abs, isFolder, missing = false) => {
    const rel = toRel(ctx.repo, abs);
    if (have.has(rel)) {
      report.push({ state: 'exists', rel });
      return;
    }
    const state = missing ? 'missing' : 'added';
    const about = args.about || (isFolder ? null : firstHeading(abs));
    const entry = about || args.when ? { path: rel, ...(about ? { about } : {}), ...(args.when ? { when: args.when } : {}) } : rel;
    have.add(rel);
    entries.push(entry);
    report.push({ state, rel, about });
  };

  for (const target of targets) {
    const abs = path.resolve(target);
    if (!fs.existsSync(abs)) {
      push(abs, false, true);
      continue;
    }
    if (!fs.statSync(abs).isDirectory()) {
      push(abs, false);
      continue;
    }
    const files = args.expand ? markdownUnder(abs) : [];
    if (!files.length) push(abs, true);
    else files.forEach((f) => push(f, false));
  }

  try {
    save(ctx, entries, args.dryRun);
  } catch (err) {
    if (err.userError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }

  for (const r of report) {
    if (r.state === 'added') console.log(`  ${paint.green('added')}   ${r.rel}${r.about ? paint.dim(`  — ${r.about}`) : ''}`);
    else if (r.state === 'exists') console.log(`  ${paint.dim('exists')}  ${r.rel}  (left alone)`);
    else console.log(`  ${paint.yellow('missing')} ${r.rel}  — does not exist yet; listed anyway`);
  }
  const added = report.filter((r) => r.state !== 'exists').length;
  if (args.dryRun) console.log(paint.dim(`Dry run: ${added} entr${added === 1 ? 'y' : 'ies'} would be added; nothing written.`));
  else if (added) console.log(`\nWrote ${CONFIG_NAME} (docs: ${entries.length}). Next: \`cairn sync\` carries the Project docs section into ai/AGENTS.md.`);
  else console.log('Nothing to add.');
  return 0;
}

function list(args, paint) {
  const ctx = openRepo(args);
  if (!ctx) return 2;
  let docs;
  try {
    docs = normalizeDocs(ctx.existing, CONFIG_NAME) || [];
  } catch (err) {
    if (!err.userError) throw err;
    console.error(err.message);
    return 2;
  }
  const rows = docs.map((d) => ({ ...d, exists: fs.existsSync(path.join(ctx.repo, d.path)) }));
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (!rows.length) {
    console.log(paint.dim('No docs listed. Add some with: cairn docs add <path>'));
    return 0;
  }
  console.log(table(rows.map((r) => [r.exists ? r.path : paint.yellow(`${r.path} (missing)`), r.about, r.when]), ['path', 'about', 'when'], paint));
  return 0;
}

function remove(args, paint) {
  const given = args.positional.slice(1);
  if (!given.length) {
    console.error('Usage: cairn docs remove <path>... [--dry-run]');
    return 2;
  }
  const ctx = openRepo(args);
  if (!ctx) return 2;
  const stored = ctx.existing.map(entryPath);
  // A path as listed in the config, else as typed from the current folder.
  const targets = given.map((g) => {
    const asListed = entryPath(g);
    return stored.some((p) => p === asListed || p.startsWith(`${asListed}/`)) ? asListed : toRel(ctx.repo, g);
  });
  const hit = (p) => targets.some((t) => p === t || p.startsWith(`${t}/`));
  const dropped = ctx.existing.filter((e) => hit(entryPath(e)));
  const kept = ctx.existing.filter((e) => !hit(entryPath(e)));
  const unknown = targets.filter((t) => !stored.some((p) => p === t || p.startsWith(`${t}/`)));
  for (const t of unknown) console.error(`Not in docs: ${t}`);
  if (!dropped.length) return 2;
  try {
    save(ctx, kept, args.dryRun);
  } catch (err) {
    if (err.userError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
  for (const e of dropped) console.log(`  ${paint.red('removed')} ${entryPath(e)}`);
  console.log(args.dryRun ? paint.dim('Dry run: nothing written.') : `\nWrote ${CONFIG_NAME}. The files themselves are untouched. Next: \`cairn sync\`.`);
  return unknown.length ? 2 : 0;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  const [sub] = args.positional;
  if (args.help || !sub || sub === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const paint = makePaint(args.color);
  if (sub === 'add') return add(args, paint);
  if (sub === 'list') return list(args, paint);
  if (sub === 'remove') return remove(args, paint);
  console.error(`Unknown docs command: ${sub}`);
  process.stderr.write(HELP);
  return 2;
}

module.exports = { main, withDocs, locate };
