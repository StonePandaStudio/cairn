#!/usr/bin/env node
'use strict';

// ai-kit doctor — reports drift across the shared ai/ + .claude/ scaffolding in
// several repos. Read-only: it never writes to the repos it inspects.
//
//   node doctor.js                     table for every shared-file rule
//   node doctor.js --diff <relPath>    hunks for one file across repos
//   node doctor.js --json              machine-readable output
//   node doctor.js --strict            exit 1 when drift or gaps are found

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { matchRule, readFile } = require('./lib/scan');
const { buildNormalizer } = require('./lib/normalize');
const diff = require('./lib/diff');

// ---------------------------------------------------------------- CLI parsing

function parseArgs(argv) {
  const args = {
    config: path.join(__dirname, 'repos.json'),
    json: false,
    diff: null,
    strict: false,
    color: process.stdout.isTTY,
    issueTypes: false,
    context: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--diff') args.diff = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '--color') args.color = true;
    else if (a === '--normalize-issue-type') args.issueTypes = true;
    else if (a === '--context') args.context = Number(argv[++i]);
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const HELP = `ai-kit doctor — shared-file drift report

Usage: node doctor.js [options]

  --config <file>            repo/rule config (default: ./repos.json)
  --diff <relPath>           show hunks for one shared file across repos
  --json                     emit JSON instead of the table
  --strict                   exit 1 if any DRIFT / MISSING / STRANDED found
  --normalize-issue-type     also fold Story/Task issue-type wording together
  --context <n>              context lines around hunks (default 2)
  --no-color                 disable ANSI colour
`;

// ------------------------------------------------------------------- plumbing

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function makePaint(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    blue: wrap(34),
    magenta: wrap(35),
    cyan: wrap(36),
  };
}

const STATUS_COLOR = {
  IDENTICAL: 'green',
  COSMETIC: 'cyan',
  DRIFT: 'red',
  MISSING: 'yellow',
  STRANDED: 'magenta',
};

// ------------------------------------------------------------------ analysis

// Repos a rule applies to, split into comparison groups. `all` compares every
// repo against every other; `stack` only compares backend-with-backend etc.
function cohortGroups(rule, repos) {
  if (rule.cohort === 'stack') {
    const byStack = new Map();
    for (const repo of repos) {
      const key = repo.stack || 'unknown';
      if (!byStack.has(key)) byStack.set(key, []);
      byStack.get(key).push(repo);
    }
    return [...byStack.entries()].map(([name, members]) => ({ name, repos: members }));
  }
  return [{ name: 'all', repos }];
}

function analyzeFile(relPath, groupRepos, contents, normalize) {
  const present = [];
  const absent = [];
  for (const repo of groupRepos) {
    if (contents.has(repo.name)) present.push(repo);
    else absent.push(repo);
  }

  // Cluster by normalized content: each cluster is one distinct real variant.
  const clusters = new Map();
  for (const repo of present) {
    const raw = contents.get(repo.name);
    const norm = normalize(raw, repo);
    const key = hash(norm);
    if (!clusters.has(key)) {
      clusters.set(key, { key, text: norm, lines: diff.splitLines(norm), repos: [] });
    }
    clusters.get(key).repos.push(repo.name);
  }
  const clusterList = [...clusters.values()].sort(
    (a, b) => b.repos.length - a.repos.length || b.lines.length - a.lines.length,
  );
  clusterList.forEach((c, i) => {
    c.label = String.fromCharCode(65 + i);
  });

  const rawKeys = new Set(present.map((r) => hash(contents.get(r.name).replace(/\r\n?/g, '\n'))));

  // Everything is measured against the most widely shared variant.
  const reference = clusterList[0] || null;
  let worstChanged = 0;
  let worstSimilarity = 1;
  for (const cluster of clusterList.slice(1)) {
    const stats = diff.diffStats(reference.lines, cluster.lines);
    cluster.changed = stats.added + stats.removed;
    cluster.similarity = diff.similarity(stats, reference.lines.length, cluster.lines.length);
    cluster.approx = stats.approx;
    worstChanged = Math.max(worstChanged, cluster.changed);
    worstSimilarity = Math.min(worstSimilarity, cluster.similarity);
  }

  let status;
  if (present.length === 1 && groupRepos.length > 1) status = 'STRANDED';
  else if (clusterList.length > 1) status = 'DRIFT';
  else if (absent.length > 0) status = 'MISSING';
  else if (rawKeys.size > 1) status = 'COSMETIC';
  else status = 'IDENTICAL';

  return {
    path: relPath,
    status,
    present: present.map((r) => r.name),
    missing: absent.map((r) => r.name),
    clusters: clusterList.map((c) => ({
      label: c.label,
      repos: c.repos,
      lines: c.lines.length,
      changed: c.changed || 0,
      similarity: c.similarity === undefined ? 1 : c.similarity,
      approx: !!c.approx,
    })),
    changedLines: worstChanged,
    similarity: worstSimilarity,
    cosmeticOnly: clusterList.length === 1 && rawKeys.size > 1,
  };
}

function analyze(config, opts) {
  const normalize = buildNormalizer(config.repos, {
    ...(config.normalize || {}),
    issueTypes: opts.issueTypes || (config.normalize || {}).issueTypes,
  });

  const sections = [];
  for (const rule of config.shared) {
    for (const group of cohortGroups(rule, config.repos)) {
      if (group.repos.length < 2) continue;

      // Union of relative paths any repo in the group has for this rule.
      const byPath = new Map();
      for (const repo of group.repos) {
        for (const rel of matchRule(repo.path, rule)) {
          const text = readFile(repo.path, rel);
          if (text === null) continue;
          if (!byPath.has(rel)) byPath.set(rel, new Map());
          byPath.get(rel).set(repo.name, text);
        }
      }

      const files = [...byPath.keys()]
        .sort()
        .map((rel) => analyzeFile(rel, group.repos, byPath.get(rel), normalize));

      if (files.length) {
        sections.push({
          rule: rule.glob,
          note: rule.note || null,
          cohort: rule.cohort === 'stack' ? `stack:${group.name}` : 'all',
          repos: group.repos.map((r) => r.name),
          files,
        });
      }
    }
  }
  return sections;
}

// -------------------------------------------------------------------- report

function table(rows, headers, paint) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(String(r[i])).length)),
  );
  const line = (cells) =>
    cells
      .map((cell, i) => String(cell) + ' '.repeat(widths[i] - stripAnsi(String(cell)).length))
      .join('  ')
      .trimEnd();
  const out = [paint.bold(line(headers)), paint.dim(widths.map((w) => '─'.repeat(w)).join('  '))];
  for (const row of rows) out.push(line(row));
  return out.join('\n');
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function render(sections, config, paint) {
  const out = [];
  out.push(
    paint.bold('ai-kit doctor') +
      paint.dim(` — ${config.repos.length} repos: ${config.repos.map((r) => r.name).join(', ')}`),
  );

  for (const section of sections) {
    out.push('');
    out.push(
      paint.bold(section.rule) +
        paint.dim(`  [cohort ${section.cohort}: ${section.repos.join(', ')}]`),
    );
    if (section.note) out.push(paint.dim(`  ${section.note}`));
    out.push('');

    const rows = section.files.map((f) => {
      const color = paint[STATUS_COLOR[f.status]];
      const drift =
        f.status === 'DRIFT'
          ? `${f.changedLines} ln  ${(f.similarity * 100).toFixed(0)}% same`
          : f.cosmeticOnly
            ? paint.dim('vars only')
            : paint.dim('—');
      const variants =
        f.clusters.length > 1
          ? f.clusters.map((c) => `${c.label}:${c.repos.join('+')}`).join('  ')
          : paint.dim('—');
      const gap = f.missing.length ? paint.yellow(`missing: ${f.missing.join(', ')}`) : '';
      return [
        '  ' + f.path,
        color(f.status),
        `${f.present.length}/${section.repos.length}`,
        drift,
        variants,
        gap,
      ];
    });
    out.push(table(rows, ['  FILE', 'STATUS', 'HAVE', 'DRIFT', 'VARIANTS', 'GAP'], paint));
  }

  // ---- roll-up
  const all = sections.flatMap((s) => s.files.map((f) => ({ ...f, rule: s.rule })));
  const counts = {};
  for (const f of all) counts[f.status] = (counts[f.status] || 0) + 1;

  out.push('');
  out.push(paint.bold('Summary'));
  out.push(
    '  ' +
      Object.keys(STATUS_COLOR)
        .filter((k) => counts[k])
        .map((k) => paint[STATUS_COLOR[k]](`${k} ${counts[k]}`))
        .join('   '),
  );

  const drifted = all
    .filter((f) => f.status === 'DRIFT')
    .sort((a, b) => b.changedLines - a.changedLines)
    .slice(0, 8);
  if (drifted.length) {
    out.push('');
    out.push(paint.bold('Worst drift — extract these last, they need real merging'));
    for (const f of drifted) {
      out.push(`  ${paint.red(String(f.changedLines).padStart(4))} ln  ${f.path}`);
    }
  }

  const stranded = all.filter((f) => f.status === 'STRANDED' || f.status === 'MISSING');
  if (stranded.length) {
    out.push('');
    out.push(paint.bold('Promotion candidates — one repo has it, others do not'));
    for (const f of stranded) {
      out.push(`  ${f.path}  ${paint.dim(`in ${f.present.join(', ')}`)}`);
    }
  }

  const easy = all.filter((f) => f.status === 'IDENTICAL' || f.status === 'COSMETIC');
  if (easy.length) {
    out.push('');
    out.push(
      paint.green(`${easy.length} files are already identical modulo project vars`) +
        paint.dim(' — extract these first, zero merge cost.'),
    );
  }

  return out.join('\n');
}

function renderDiff(config, target, opts, paint) {
  const normalize = buildNormalizer(config.repos, {
    ...(config.normalize || {}),
    issueTypes: opts.issueTypes || (config.normalize || {}).issueTypes,
  });

  const variants = new Map();
  for (const repo of config.repos) {
    const text = readFile(repo.path, target);
    if (text === null) continue;
    const norm = normalize(text, repo);
    const key = hash(norm);
    if (!variants.has(key)) variants.set(key, { lines: diff.splitLines(norm), repos: [] });
    variants.get(key).repos.push(repo.name);
  }

  if (variants.size === 0) return paint.yellow(`No repo has ${target}`);

  const list = [...variants.values()].sort((a, b) => b.repos.length - a.repos.length);
  const out = [paint.bold(target) + paint.dim(`  ${list.length} variant(s), normalized`)];
  const [reference, ...rest] = list;
  out.push(paint.green(`  A (reference): ${reference.repos.join(', ')}`));

  if (rest.length === 0) {
    out.push(paint.dim('  No normalized differences.'));
    return out.join('\n');
  }

  rest.forEach((cluster, i) => {
    const label = String.fromCharCode(66 + i);
    out.push('');
    out.push(paint.bold(`  ${label}: ${cluster.repos.join(', ')}`) + paint.dim('  (A → ' + label + ')'));
    const ops = diff.diffOps(reference.lines, cluster.lines);
    if (!ops) {
      out.push(paint.yellow('  file too large for line-level diff'));
      return;
    }
    for (const hunk of diff.hunks(ops, opts.context)) {
      out.push(paint.dim('  ┄┄┄'));
      for (const [kind, line] of hunk) {
        if (kind === '=') out.push(paint.dim(`    ${line}`));
        else if (kind === '-') out.push(paint.red(`  - ${line}`));
        else out.push(paint.green(`  + ${line}`));
      }
    }
  });
  return out.join('\n');
}

// ----------------------------------------------------------------------- main

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  const config = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
  const missingRepos = config.repos.filter((r) => !fs.existsSync(r.path));
  if (missingRepos.length) {
    console.error(`Repo path not found: ${missingRepos.map((r) => r.path).join(', ')}`);
    process.exit(2);
  }

  const paint = makePaint(opts.color);

  if (opts.diff) {
    console.log(renderDiff(config, opts.diff.replace(/\\/g, '/'), opts, paint));
    return;
  }

  const sections = analyze(config, opts);

  if (opts.json) {
    console.log(JSON.stringify({ repos: config.repos.map((r) => r.name), sections }, null, 2));
  } else {
    console.log(render(sections, config, paint));
  }

  if (opts.strict) {
    const bad = sections
      .flatMap((s) => s.files)
      .some((f) => f.status === 'DRIFT' || f.status === 'MISSING' || f.status === 'STRANDED');
    if (bad) process.exit(1);
  }
}

main();
