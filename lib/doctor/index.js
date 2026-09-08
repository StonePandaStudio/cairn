'use strict';

// cairn doctor — reports drift across the shared scaffolding in several repos.
// Read-only: it never writes to the repos it inspects.
//
// Two independent axes are reported, and keeping them separate matters:
//
//   drift    cross-repo. Do these five copies of a file still agree?
//   managed  per-repo. Does what cairn wrote still match what is on disk?
//
// A file can be perfectly in sync across repos and still be hand-modified away
// from its template, or vice versa. Collapsing them into one status column hides
// both signals.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { matchRule, readFile } = require('./scan');
const { buildNormalizer } = require('./normalize');
const diff = require('./diff');
const { makePaint, stripAnsi, table } = require('../paint');
const { loadRepoConfig } = require('../config');
const { readManifest, statusFor } = require('../manifest');

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

const STATUS_COLOR = {
  IDENTICAL: 'green',
  COSMETIC: 'cyan',
  DRIFT: 'red',
  MISSING: 'yellow',
  STRANDED: 'magenta',
};

const MANAGED_COLOR = {
  MANAGED: 'green',
  OUTDATED: 'yellow',
  MODIFIED: 'red',
  DELETED: 'magenta',
};

// ------------------------------------------------------------------ workspace

// Resolve each workspace entry into a repo record. Vars come from the repo's own
// cairn.config.json when it has one, and fall back to the inline `vars` block in
// repos.json when it does not — so the doctor keeps working on repos that have
// not been migrated yet, and migration can happen one repo at a time.
function resolveRepos(config, configDir) {
  return config.repos.map((entry) => {
    const repoPath = path.resolve(configDir, entry.path);
    const repoConfig = loadRepoConfig(repoPath, { fallbackVars: entry.vars || null });
    return {
      name: entry.name,
      path: repoPath.replace(/\\/g, '/'),
      stack: entry.stack || repoConfig.stack,
      vars: { ...(repoConfig.vars || {}), ...(entry.vars || {}) },
      tracker: repoConfig.tracker,
      managed: !repoConfig.unmanaged,
      // local -> canonical. Lets a repo that named a file differently still be
      // compared against the cohort instead of showing up as MISSING+STRANDED.
      pathAliases: entry.pathAliases || {},
    };
  });
}

// ------------------------------------------------------------------- analysis

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

// A rule can declare prerequisites. `requires: { tracker: true }` skips repos
// with no issue tracker, so glossr-cli lacking a Jira client reads as "not
// applicable" rather than as a gap someone should go fill.
//
// A repo with no cairn.config.json has an *unknown* tracker, not an absent one,
// and unknown must not be treated as none — doing so silently emptied every
// tracker-gated rule while the repos were still being migrated.
function repoMeetsRequirements(repo, rule) {
  const req = rule.requires;
  if (!req) return true;
  if (req.tracker === true && repo.managed && (!repo.tracker || repo.tracker.provider === 'none')) {
    return false;
  }
  if (req.stack && repo.stack !== req.stack) return false;
  return true;
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
    aliased: present
      .filter((r) => Object.values(r.pathAliases || {}).includes(relPath))
      .map((r) => r.name),
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

// Collect a repo's files for a rule, folding any aliased path onto its canonical
// name so renamed-but-equivalent files land in the same comparison bucket.
function collectRepoFiles(repo, rule, byPath) {
  const aliases = repo.pathAliases || {};
  for (const rel of matchRule(repo.path, rule)) {
    const text = readFile(repo.path, rel);
    if (text === null) continue;
    const key = aliases[rel] || rel;
    if (!byPath.has(key)) byPath.set(key, new Map());
    byPath.get(key).set(repo.name, text);
  }
}

function analyze(repos, config, opts) {
  const normalize = buildNormalizer(repos, {
    ...(config.normalize || {}),
    issueTypes: opts.issueTypes || (config.normalize || {}).issueTypes,
  });

  const sections = [];
  for (const rule of config.shared) {
    const eligible = repos.filter((r) => repoMeetsRequirements(r, rule));
    for (const group of cohortGroups(rule, eligible)) {
      if (group.repos.length < 2) continue;

      // Union of relative paths any repo in the group has for this rule.
      const byPath = new Map();
      for (const repo of group.repos) collectRepoFiles(repo, rule, byPath);

      const files = [...byPath.keys()]
        .sort()
        .map((rel) => analyzeFile(rel, group.repos, byPath.get(rel), normalize));

      if (files.length) {
        sections.push({
          rule: rule.glob,
          note: rule.note || null,
          cohort: rule.cohort === 'stack' ? `stack:${group.name}` : 'all',
          repos: group.repos.map((r) => r.name),
          skipped: repos.filter((r) => !eligible.includes(r)).map((r) => r.name),
          files,
        });
      }
    }
  }
  return sections;
}

// Per-repo manifest state. Repos with no manifest are simply not managed yet.
function analyzeManaged(repos) {
  const out = [];
  for (const repo of repos) {
    let manifest;
    try {
      manifest = readManifest(repo.path);
    } catch (err) {
      out.push({ repo: repo.name, error: err.message, files: [] });
      continue;
    }
    if (!manifest) continue;
    out.push({ repo: repo.name, files: statusFor(repo.path, manifest), error: null });
  }
  return out;
}

// --------------------------------------------------------------------- report

function render(sections, managed, repos, paint) {
  const out = [];
  out.push(
    paint.bold('cairn doctor') +
      paint.dim(` — ${repos.length} repos: ${repos.map((r) => r.name).join(', ')}`),
  );

  const unmanaged = repos.filter((r) => !r.managed);
  if (unmanaged.length) {
    out.push(
      paint.dim(
        `  no cairn.config.json yet (falling back to repos.json vars): ${unmanaged
          .map((r) => r.name)
          .join(', ')}`,
      ),
    );
  }

  for (const section of sections) {
    out.push('');
    out.push(
      paint.bold(section.rule) +
        paint.dim(`  [cohort ${section.cohort}: ${section.repos.join(', ')}]`),
    );
    if (section.note) out.push(paint.dim(`  ${section.note}`));
    if (section.skipped && section.skipped.length) {
      out.push(paint.dim(`  n/a: ${section.skipped.join(', ')}`));
    }
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
      const notes = [];
      if (f.missing.length) notes.push(paint.yellow(`missing: ${f.missing.join(', ')}`));
      if (f.aliased.length) notes.push(paint.dim(`aliased in ${f.aliased.join(', ')}`));
      return [
        '  ' + f.path,
        color(f.status),
        `${f.present.length}/${section.repos.length}`,
        drift,
        variants,
        notes.join('  '),
      ];
    });
    out.push(table(rows, ['  FILE', 'STATUS', 'HAVE', 'DRIFT', 'VARIANTS', 'GAP'], paint));
  }

  // ---- generated files, from each repo's manifest
  if (managed.length) {
    out.push('');
    out.push(paint.bold('Generated files') + paint.dim('  [from _cairn/manifest.json]'));
    out.push('');
    const rows = [];
    for (const repo of managed) {
      if (repo.error) {
        rows.push(['  ' + repo.repo, paint.red('ERROR'), repo.error, '']);
        continue;
      }
      for (const f of repo.files) {
        rows.push([
          '  ' + repo.repo,
          paint[MANAGED_COLOR[f.state]](f.state),
          f.path,
          paint.dim(f.source),
        ]);
      }
    }
    out.push(table(rows, ['  REPO', 'STATE', 'FILE', 'SOURCE'], paint));
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

function renderDiff(repos, config, target, opts, paint) {
  const normalize = buildNormalizer(repos, {
    ...(config.normalize || {}),
    issueTypes: opts.issueTypes || (config.normalize || {}).issueTypes,
  });

  const variants = new Map();
  for (const repo of repos) {
    // Honour aliases here too, so --diff on a canonical path finds a renamed copy.
    const aliasEntry = Object.entries(repo.pathAliases || {}).find(
      ([, canonical]) => canonical === target,
    );
    const localName = aliasEntry ? aliasEntry[0] : target;
    const text = readFile(repo.path, localName);
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
    out.push(paint.bold(`  ${label}: ${cluster.repos.join(', ')}`) + paint.dim(`  (A → ${label})`));
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

const HELP = `cairn doctor — shared-file drift report

Usage: cairn doctor [options]

  --config <file>            workspace config (default: ./repos.json)
  --diff <relPath>           show hunks for one shared file across repos
  --json                     emit JSON instead of the table
  --strict                   exit 1 on drift, gaps, or hand-modified generated files
  --normalize-issue-type     also fold Story/Task issue-type wording together
  --context <n>              context lines around hunks (default 2)
  --no-color                 disable ANSI colour
`;

function parseArgs(argv) {
  const args = {
    // Resolved against cwd in main(). The workspace config is the user's, not the
    // package's — an installed cairn has no repos.json of its own to fall back to.
    config: 'repos.json',
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
      return { error: 2 };
    }
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.error) return opts.error;
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const configFile = path.resolve(opts.config);
  if (!fs.existsSync(configFile)) {
    console.error(`Workspace config not found: ${configFile}`);
    console.error(`Run cairn doctor from the directory holding repos.json, or pass --config <file>.`);
    return 2;
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const repos = resolveRepos(config, path.dirname(configFile));

  const missingRepos = repos.filter((r) => !fs.existsSync(r.path));
  if (missingRepos.length) {
    console.error(`Repo path not found: ${missingRepos.map((r) => r.path).join(', ')}`);
    return 2;
  }

  const paint = makePaint(opts.color);

  if (opts.diff) {
    console.log(renderDiff(repos, config, opts.diff.replace(/\\/g, '/'), opts, paint));
    return 0;
  }

  const sections = analyze(repos, config, opts);
  const managed = analyzeManaged(repos);

  if (opts.json) {
    console.log(JSON.stringify({ repos: repos.map((r) => r.name), sections, managed }, null, 2));
  } else {
    console.log(render(sections, managed, repos, paint));
  }

  if (opts.strict) {
    const drifted = sections
      .flatMap((s) => s.files)
      .some((f) => f.status === 'DRIFT' || f.status === 'MISSING' || f.status === 'STRANDED');
    const broken = managed.some(
      (m) => m.error || m.files.some((f) => f.state === 'MODIFIED' || f.state === 'DELETED'),
    );
    if (drifted || broken) return 1;
  }
  return 0;
}

module.exports = { main, analyze, analyzeManaged, resolveRepos, render, HELP, stripAnsi };
