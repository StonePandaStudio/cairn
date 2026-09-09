'use strict';

// Dependency-free test runner. `node test/run.js`.
//
// Coverage is deliberately concentrated on the two things that would fail
// silently: the markdown -> Jira markup conversion (it replaced a prose document
// that agents used to follow by hand) and the manifest state machine (it is the
// only thing standing between "generated" and "quietly hand-edited").

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createJiraServer, NoTransitionError } = require('../lib/tracker/jira-server');
const { createYouTrack } = require('../lib/tracker/youtrack');
const { createNone } = require('../lib/tracker/none');
const { createTracker } = require('../lib/tracker');
const cli = require('../lib/tracker/cli');
const manifest = require('../lib/manifest');
const { parseEnv, loadRepoConfig, normalizeStack } = require('../lib/config');

let passed = 0;
let failed = 0;
const only = process.argv[2];

function test(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('async tests must be registered with atest()');
    }
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

const asyncTests = [];
function atest(name, fn) {
  if (only && !name.includes(only)) return;
  asyncTests.push([name, fn]);
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-test-'));
  return dir;
}

// ------------------------------------------------------------------- markup

const jira = createJiraServer({ projectKey: 'TEST' }, { JIRA_BASE_URL: 'x', JIRA_USER: 'x', JIRA_PASSWORD: 'x' });

test('markup: headings', () => {
  assert.strictEqual(jira.toMarkup('# Title'), 'h1. Title');
  assert.strictEqual(jira.toMarkup('### Third'), 'h3. Third');
});

test('markup: bold and inline code', () => {
  assert.strictEqual(jira.toMarkup('**bold** and `code`'), '*bold* and {{code}}');
});

test('markup: italic maps to underscore, bold stays a star', () => {
  assert.strictEqual(jira.toMarkup('*just italic*'), '_just italic_');
  assert.strictEqual(jira.toMarkup('_also italic_'), '_also italic_');
  // bold must survive the italic pass unharmed
  assert.strictEqual(jira.toMarkup('**b** and *i*'), '*b* and _i_');
});

test('markup: strikethrough', () => {
  assert.strictEqual(jira.toMarkup('~~gone~~'), '-gone-');
});

test('markup: blockquote', () => {
  assert.strictEqual(jira.toMarkup('> a note'), 'bq. a note');
});

test('markup: pipe table becomes || header and | body, separator dropped', () => {
  const md = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
  assert.strictEqual(jira.toMarkup(md), '||A||B||\n|1|2|\n|3|4|');
});

test('markup: a bullet line is not mangled by the italic rule', () => {
  assert.strictEqual(jira.toMarkup('- **Method**: reuse `X`'), '* *Method*: reuse {{X}}');
});

test('markup: links', () => {
  assert.strictEqual(jira.toMarkup('[text](http://x)'), '[text|http://x]');
});

test('markup: bullets keep nesting depth', () => {
  assert.strictEqual(jira.toMarkup('- one'), '* one');
  assert.strictEqual(jira.toMarkup('  - two'), '** two');
  assert.strictEqual(jira.toMarkup('    - three'), '*** three');
});

test('markup: ordered lists', () => {
  assert.strictEqual(jira.toMarkup('1. first'), '# first');
  assert.strictEqual(jira.toMarkup('  2. second'), '## second');
});

test('markup: fenced code carries the language', () => {
  assert.strictEqual(jira.toMarkup('```ts\nconst a = 1;\n```'), '{code:ts}\nconst a = 1;\n{code}');
});

test('markup: code fence contents are left alone', () => {
  // Inside a fence, **stars** and `backticks` are code, not formatting.
  const out = jira.toMarkup('```\n**not bold**\n```');
  assert.strictEqual(out, '{code}\n**not bold**\n{code}');
});

test('markup: horizontal rule', () => {
  assert.strictEqual(jira.toMarkup('---'), '----');
});

// ------------------------------------------------------------------ config

test('config: parseEnv strips quotes and comments', () => {
  const env = parseEnv('# comment\nA=1\nB="two"\nC=\'three\'\n\nD=has=equals');
  assert.deepStrictEqual(env, { A: '1', B: 'two', C: 'three', D: 'has=equals' });
});

test('config: normalizeStack turns anything into a non-empty list', () => {
  assert.deepStrictEqual(normalizeStack('angular'), ['angular']);
  assert.deepStrictEqual(normalizeStack('nestjs, typeorm'), ['nestjs', 'typeorm']);
  assert.deepStrictEqual(normalizeStack(['nestjs', 'typeorm']), ['nestjs', 'typeorm']);
  assert.deepStrictEqual(normalizeStack(undefined), ['unknown']);
  assert.deepStrictEqual(normalizeStack(''), ['unknown']);
});

test('config: a config stack string is loaded as a list', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ stack: 'nestjs,typeorm' }));
  assert.deepStrictEqual(loadRepoConfig(dir).stack, ['nestjs', 'typeorm']);
});

test('config: missing cairn.config.json yields an unmanaged repo', () => {
  const dir = tmpRepo();
  const cfg = loadRepoConfig(dir, { fallbackVars: { jiraKey: 'GLO' } });
  assert.strictEqual(cfg.unmanaged, true);
  assert.strictEqual(cfg.tracker.provider, 'none');
  assert.strictEqual(cfg.vars.jiraKey, 'GLO');
});

test('config: tracker without projectKey is rejected', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'cairn.config.json'),
    JSON.stringify({ tracker: { provider: 'jira-server' } }),
  );
  assert.throws(() => loadRepoConfig(dir), /projectKey is missing/);
});

test('config: issue types default but stay overridable', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'cairn.config.json'),
    JSON.stringify({ tracker: { provider: 'jira-server', projectKey: 'PROOF', issueTypes: { story: 'Task' } } }),
  );
  const cfg = loadRepoConfig(dir);
  assert.strictEqual(cfg.tracker.issueTypes.story, 'Task');
  assert.strictEqual(cfg.tracker.issueTypes.subtask, 'Sub-task');
});

// ---------------------------------------------------------------- manifest

test('manifest: hash ignores line endings and BOM', () => {
  assert.strictEqual(manifest.hashContent('a\nb\n'), manifest.hashContent('a\r\nb\r\n'));
  assert.strictEqual(manifest.hashContent('a\n'), manifest.hashContent('﻿a\n'));
});

test('manifest: states are MANAGED / MODIFIED / DELETED', () => {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();

  fs.mkdirSync(path.join(dir, 'gen'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'gen/a.md'), 'alpha\n');
  fs.writeFileSync(path.join(dir, 'gen/b.md'), 'beta\n');
  manifest.record(m, 'gen/a.md', 'tpl/a.md', 'alpha\n');
  manifest.record(m, 'gen/b.md', 'tpl/b.md', 'beta\n');
  manifest.record(m, 'gen/c.md', 'tpl/c.md', 'gamma\n');
  manifest.writeManifest(dir, m);

  fs.writeFileSync(path.join(dir, 'gen/b.md'), 'beta, edited by hand\n');

  const states = Object.fromEntries(
    manifest.statusFor(dir, manifest.readManifest(dir)).map((f) => [f.path, f.state]),
  );
  assert.strictEqual(states['gen/a.md'], 'MANAGED');
  assert.strictEqual(states['gen/b.md'], 'MODIFIED');
  assert.strictEqual(states['gen/c.md'], 'DELETED');
});

test('manifest: OUTDATED needs a newer template hash', () => {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  fs.writeFileSync(path.join(dir, 'x.md'), 'v1\n');
  manifest.record(m, 'x.md', 'tpl/x.md', 'v1\n');
  manifest.writeManifest(dir, m);

  const current = manifest.statusFor(dir, manifest.readManifest(dir), {
    'tpl/x.md': manifest.hashContent('v1\n'),
  });
  assert.strictEqual(current[0].state, 'MANAGED');

  const bumped = manifest.statusFor(dir, manifest.readManifest(dir), {
    'tpl/x.md': manifest.hashContent('v2\n'),
  });
  assert.strictEqual(bumped[0].state, 'OUTDATED');
});

test('manifest: a hand edit beats an outdated template in the report', () => {
  // MODIFIED must win: overwriting a hand edit is the destructive outcome, so it
  // is the one that has to be surfaced.
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  fs.writeFileSync(path.join(dir, 'x.md'), 'v1\n');
  manifest.record(m, 'x.md', 'tpl/x.md', 'v1\n');
  manifest.writeManifest(dir, m);
  fs.writeFileSync(path.join(dir, 'x.md'), 'hand edited\n');

  const states = manifest.statusFor(dir, manifest.readManifest(dir), {
    'tpl/x.md': manifest.hashContent('v2\n'),
  });
  assert.strictEqual(states[0].state, 'MODIFIED');
});

// ----------------------------------------------------------------- tracker

test('tracker: unknown provider is rejected by name', () => {
  assert.throws(() => createTracker({ provider: 'linear' }), /Unknown tracker provider "linear"/);
});

test('tracker: youtrack is a registered provider', () => {
  const t = createTracker({ provider: 'youtrack', projectKey: 'PROOF' }, { YOUTRACK_URL: 'x', YOUTRACK_TOKEN: 'x' });
  assert.strictEqual(t.name, 'youtrack');
  assert.deepStrictEqual(t.issueTypes, {});
});

atest('tracker: youtrack reports missing credentials rather than exiting', async () => {
  const t = createYouTrack({ projectKey: 'PROOF' }, {});
  await assert.rejects(() => t.listProjects(), /Missing YouTrack credentials/);
});

atest('tracker: youtrack without a project fails before any request', async () => {
  const t = createYouTrack({}, { YOUTRACK_URL: 'x', YOUTRACK_TOKEN: 'p' });
  await assert.rejects(() => t.listProjects(), /project is not set/);
});

test('tracker: youtrack falls back to YOUTRACK_PROJECT for the key', () => {
  const t = createYouTrack({}, { YOUTRACK_URL: 'x', YOUTRACK_TOKEN: 'x', YOUTRACK_PROJECT: 'PROOF' });
  assert.strictEqual(t.projectKey, 'PROOF');
});

test('tracker: youtrack passes markdown through untouched', () => {
  assert.strictEqual(createYouTrack({ projectKey: 'X' }).toMarkup('# Title\n**b**'), '# Title\n**b**');
});

atest('tracker: jira-server reports missing credentials rather than exiting', async () => {
  const t = createJiraServer({ projectKey: 'X' }, {});
  await assert.rejects(() => t.listProjects(), /Missing Jira credentials/);
});

atest('tracker: jira-server without a projectKey fails before any request', async () => {
  const t = createJiraServer({}, { JIRA_BASE_URL: 'x', JIRA_USER: 'u', JIRA_PASSWORD: 'p' });
  await assert.rejects(() => t.listProjects(), /projectKey is not set/);
});

atest('tracker: none provider never throws and reports skips', async () => {
  const t = createNone();
  assert.strictEqual(t.name, 'none');
  assert.strictEqual(await t.createIssue({ summary: 'x' }), null);
  assert.strictEqual((await t.setStatus('X-1', 'Done')).skipped, true);
  assert.strictEqual((await t.closeIssue('X-1')).failed, 0);
});

test('tracker: none passes markdown through untouched', () => {
  assert.strictEqual(createNone().toMarkup('# Title'), '# Title');
});

// --------------------------------------------------------------------- cli

test('cli: flags without a value are booleans', () => {
  const { flags, rest } = cli.parseFlags(['GLO-1', '--json', '--summary', 'Hi']);
  assert.deepStrictEqual(rest, ['GLO-1']);
  assert.strictEqual(flags.json, true);
  assert.strictEqual(flags.summary, 'Hi');
});

test('cli: a flag followed by another flag does not swallow it', () => {
  const { flags } = cli.parseFlags(['--markup', '--description', 'text']);
  assert.strictEqual(flags.markup, true);
  assert.strictEqual(flags.description, 'text');
});

atest('cli: every legacy command name still resolves', async () => {
  // The five repos reference these strings in prose. If an alias is dropped, the
  // failure surfaces as an agent running a command that does not exist.
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'cairn.config.json'),
    JSON.stringify({ tracker: { provider: 'none' } }),
  );
  const legacy = [
    ['create-task', 'summary'],
    ['create-story', 'summary'],
    ['create-subtask', 'GLO-1', 'summary'],
    ['close-story', 'GLO-1'],
    ['set-status', 'GLO-1', 'Done'],
    ['set-assignee', 'GLO-1', 'someone'],
    ['append-description', 'GLO-1', 'text'],
    ['get', 'GLO-1'],
    ['list-projects'],
    ['list-statuses'],
  ];
  for (const argv of legacy) {
    const code = await cli.run(argv, { cwd: dir, out: () => {}, err: () => {} });
    assert.strictEqual(code, 0, `${argv[0]} returned ${code}`);
  }
});

atest('cli: a no-op tracker never prints a confirmation line on stdout', async () => {
  // `KEY -> Status` on stdout is how agents confirm the board moved. A null
  // tracker printing it would report work that did not happen.
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ tracker: { provider: 'none' } }));
  let stdout = '';
  let stderr = '';
  for (const argv of [['set-status', 'GLO-1', 'Done'], ['close-story', 'GLO-1']]) {
    await cli.run(argv, {
      cwd: dir,
      out: (m) => {
        stdout += m;
      },
      err: (m) => {
        stderr += m;
      },
    });
  }
  assert.strictEqual(stdout, '', `expected no stdout, got: ${stdout}`);
  assert.match(stderr, /provider is "none"/);
});

atest('cli: an unknown command exits 2', async () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ tracker: { provider: 'none' } }));
  const code = await cli.run(['frobnicate'], { cwd: dir, out: () => {}, err: () => {} });
  assert.strictEqual(code, 2);
});

atest('cli: no cairn.config.json anywhere exits 2 with guidance', async () => {
  const dir = tmpRepo();
  let message = '';
  const code = await cli.run(['get', 'GLO-1'], {
    cwd: dir,
    out: () => {},
    err: (m) => {
      message += m;
    },
  });
  assert.strictEqual(code, 2);
  assert.match(message, /cairn init/);
});

// ------------------------------------------------------------------ doctor

test('doctor: cohort "stack" groups by the framework, not the add-ons', () => {
  const { resolveRepos, cohortGroups } = require('../lib/doctor');
  const root = tmpRepo();
  const workspace = {
    repos: [
      { name: 'a', path: path.join(root, 'a'), stack: ['nestjs', 'typeorm'] },
      { name: 'b', path: path.join(root, 'b'), stack: ['nestjs', 'prisma'] },
      { name: 'c', path: path.join(root, 'c'), stack: 'angular' },
    ],
  };
  for (const r of workspace.repos) fs.mkdirSync(path.join(root, r.name), { recursive: true });
  const repos = resolveRepos(workspace, root);
  assert.deepStrictEqual(repos[0].stack, ['nestjs', 'typeorm']);

  const groups = cohortGroups({ cohort: 'stack' }, repos);
  const nest = groups.find((g) => g.name === 'nestjs');
  assert.strictEqual(nest.repos.length, 2, 'both nestjs repos land in one cohort despite different ORMs');
  assert.ok(groups.find((g) => g.name === 'angular'));
});

test('doctor: aliased paths fold onto the canonical name', () => {
  const { resolveRepos, analyze } = require('../lib/doctor');
  const root = tmpRepo();
  const mk = (name, files) => {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, name, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
  };
  mk('a', { '.claude/commands/code-review.md': 'same\n' });
  mk('b', { '.claude/commands/review-code.md': 'same\n' });

  const workspace = {
    repos: [
      { name: 'a', path: path.join(root, 'a'), stack: 's' },
      {
        name: 'b',
        path: path.join(root, 'b'),
        stack: 's',
        pathAliases: { '.claude/commands/review-code.md': '.claude/commands/code-review.md' },
      },
    ],
    shared: [{ glob: '.claude/commands/*.md', cohort: 'all' }],
    normalize: {},
  };
  const repos = resolveRepos(workspace, root);
  const sections = analyze(repos, workspace, {});
  const files = sections[0].files;
  assert.strictEqual(files.length, 1, 'alias should produce one entry, not two');
  assert.strictEqual(files[0].path, '.claude/commands/code-review.md');
  assert.strictEqual(files[0].status, 'IDENTICAL');
});

test('doctor: an unmanaged repo is not treated as tracker:none', () => {
  // Regression guard. Filtering unknown-tracker repos out of tracker-gated rules
  // silently emptied those sections while repos were still being migrated.
  const { resolveRepos, analyze } = require('../lib/doctor');
  const root = tmpRepo();
  for (const name of ['a', 'b']) {
    const abs = path.join(root, name, 'ai/scripts/jira.js');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x\n');
  }
  const workspace = {
    repos: [
      { name: 'a', path: path.join(root, 'a'), stack: 's' },
      { name: 'b', path: path.join(root, 'b'), stack: 's' },
    ],
    shared: [{ glob: 'ai/scripts/*.js', cohort: 'all', requires: { tracker: true } }],
    normalize: {},
  };
  const sections = analyze(resolveRepos(workspace, root), workspace, {});
  assert.strictEqual(sections.length, 1, 'rule should still apply to unmigrated repos');
});

test('doctor: a configured tracker:none repo IS excluded', () => {
  const { resolveRepos, analyze } = require('../lib/doctor');
  const root = tmpRepo();
  for (const name of ['a', 'b']) {
    const abs = path.join(root, name, 'ai/scripts/jira.js');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x\n');
    fs.writeFileSync(
      path.join(root, name, 'cairn.config.json'),
      JSON.stringify({ tracker: { provider: 'none' } }),
    );
  }
  const workspace = {
    repos: [
      { name: 'a', path: path.join(root, 'a'), stack: 's' },
      { name: 'b', path: path.join(root, 'b'), stack: 's' },
    ],
    shared: [{ glob: 'ai/scripts/*.js', cohort: 'all', requires: { tracker: true } }],
    normalize: {},
  };
  const sections = analyze(resolveRepos(workspace, root), workspace, {});
  assert.strictEqual(sections.length, 0);
});

// -------------------------------------------------------------------- init

atest('init: writes config, shim and manifest', async () => {
  const { main } = require('../lib/init');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  const code = main(['--repo', dir, '--stack', 'backend', '--tracker', 'jira-server', '--project-key', 'PROOF', '--story-type', 'Task', '--no-color']);
  console.log = log;

  assert.strictEqual(code, 0);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'cairn.config.json'), 'utf8'));
  assert.strictEqual(cfg.tracker.projectKey, 'PROOF');
  assert.strictEqual(cfg.tracker.issueTypes.story, 'Task');
  assert.ok(fs.existsSync(path.join(dir, '_cairn/scripts/jira.js')));

  const m = manifest.readManifest(dir);
  assert.ok(m.files['_cairn/scripts/jira.js']);
  // cairn.config.json is hand-editable, so it must NOT be manifested.
  assert.ok(!m.files['cairn.config.json']);
  assert.deepStrictEqual(
    manifest.statusFor(dir, m).map((f) => f.state),
    ['MANAGED'],
  );
});

atest('init: youtrack config omits the Jira-only issueTypes block', async () => {
  const { main } = require('../lib/init');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  const code = main(['--repo', dir, '--stack', 'backend', '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  console.log = log;

  assert.strictEqual(code, 0);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'cairn.config.json'), 'utf8'));
  assert.strictEqual(cfg.tracker.provider, 'youtrack');
  assert.strictEqual(cfg.tracker.projectKey, 'PROOF');
  assert.strictEqual(cfg.tracker.issueTypes, undefined);
});

atest('init: --stack is written as a list, comma-separated input split', async () => {
  const { main } = require('../lib/init');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  main(['--repo', dir, '--stack', 'nestjs,typeorm', '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  console.log = log;
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'cairn.config.json'), 'utf8'));
  assert.deepStrictEqual(cfg.stack, ['nestjs', 'typeorm']);
});

atest('init: replaces a legacy ai/scripts/jira.js but never invents one', async () => {
  const { main } = require('../lib/init');
  const log = console.log;

  const withLegacy = tmpRepo();
  fs.mkdirSync(path.join(withLegacy, 'ai/scripts'), { recursive: true });
  fs.writeFileSync(path.join(withLegacy, 'ai/scripts/jira.js'), '// 237 lines of copied client\n');
  console.log = () => {};
  main(['--repo', withLegacy, '--no-color']);
  console.log = log;
  assert.match(fs.readFileSync(path.join(withLegacy, 'ai/scripts/jira.js'), 'utf8'), /@stonepandastudio\/cairn/);

  const without = tmpRepo();
  console.log = () => {};
  main(['--repo', without, '--no-color']);
  console.log = log;
  assert.ok(!fs.existsSync(path.join(without, 'ai/scripts/jira.js')), 'should not create an unreferenced path');
});

atest('init: replaces every legacy client the repo carries', async () => {
  const { main } = require('../lib/init');
  const log = console.log;
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'ai/scripts'), { recursive: true });
  for (const n of ['jira.js', 'youtrack.js', 'task-tracker.js']) {
    fs.writeFileSync(path.join(dir, 'ai/scripts', n), '// copied client\n');
  }
  console.log = () => {};
  main(['--repo', dir, '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  console.log = log;

  const m = manifest.readManifest(dir);
  for (const n of ['jira.js', 'youtrack.js', 'task-tracker.js']) {
    assert.match(fs.readFileSync(path.join(dir, 'ai/scripts', n), 'utf8'), /@stonepandastudio\/cairn/);
    assert.ok(m.files[`ai/scripts/${n}`], `${n} should be manifested`);
  }
});

atest('init: refuses to clobber an existing config without --force', async () => {
  const { main } = require('../lib/init');
  const dir = tmpRepo();
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  main(['--repo', dir, '--no-color']);
  fs.writeFileSync(path.join(dir, 'cairn.config.json'), '{"stack":"hand-edited"}');
  const code = main(['--repo', dir, '--no-color']);
  console.log = log;
  console.error = err;

  assert.strictEqual(code, 2);
  assert.match(fs.readFileSync(path.join(dir, 'cairn.config.json'), 'utf8'), /hand-edited/);
});

atest('init: --dry-run writes nothing', async () => {
  const { main } = require('../lib/init');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  const code = main(['--repo', dir, '--dry-run', '--no-color']);
  console.log = log;
  assert.strictEqual(code, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'cairn.config.json')));
  assert.ok(!fs.existsSync(path.join(dir, '_cairn')));
});

// ----------------------------------------------------------------- presets

// Nothing renders these yet, so a slot with no variant supplying it would sit
// undetected until the renderer lands and silently produced a document with a
// hole in it. Cheap to check now.
test('presets: every declared slot is supplied by every variant', () => {
  const root = path.join(__dirname, '..', 'presets');
  const problems = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const main = path.join(dir, 'code-guidelines.md');
    if (!fs.existsSync(main)) continue;

    const declared = [
      ...fs.readFileSync(main, 'utf8').matchAll(/\{\{>\s*slot:\s*([\w-]+)\s*\}\}/g),
    ].map((m) => m[1]);
    if (!declared.length) continue;

    const variantDir = path.join(dir, 'variants');
    if (!fs.existsSync(variantDir)) {
      problems.push(`${entry.name}: declares slots but has no variants/`);
      continue;
    }
    const variants = fs.readdirSync(variantDir);
    assert.ok(variants.length >= 2, `${entry.name}: a slot with one variant is not a slot`);

    for (const v of variants) {
      const supplied = [
        ...fs
          .readFileSync(path.join(variantDir, v), 'utf8')
          .matchAll(/^##\s*slot:\s*([\w-]+)\s*$/gm),
      ].map((m) => m[1]);
      for (const slot of declared) {
        if (!supplied.includes(slot)) problems.push(`${entry.name}/${v}: missing slot "${slot}"`);
      }
      for (const slot of supplied) {
        if (!declared.includes(slot)) problems.push(`${entry.name}/${v}: unknown slot "${slot}"`);
      }
    }
  }

  assert.deepStrictEqual(problems, []);
});

// ------------------------------------------------------------------- runner

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed++;
      console.log(`  ok   ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${name}`);
      console.log(`       ${err.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
