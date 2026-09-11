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

test('tracker: providerEnv names the .env vars per provider', () => {
  const { providerEnv } = require('../lib/tracker');
  assert.deepStrictEqual(providerEnv('jira-server'), ['JIRA_BASE_URL', 'JIRA_USER', 'JIRA_PASSWORD']);
  assert.deepStrictEqual(providerEnv('youtrack'), ['YOUTRACK_URL', 'YOUTRACK_TOKEN', 'YOUTRACK_PROJECT']);
  assert.deepStrictEqual(providerEnv('none'), []);
  assert.deepStrictEqual(providerEnv('youtrack', 'CAIRN_'), ['CAIRN_YOUTRACK_URL', 'CAIRN_YOUTRACK_TOKEN', 'CAIRN_YOUTRACK_PROJECT']);
});

atest('tracker: envPrefix moves which .env vars a provider reads', async () => {
  // Unprefixed vars are present but the provider is told to look for CAIRN_* —
  // so it must report the prefixed names as missing, not the bare ones.
  const prefixed = createYouTrack(
    { projectKey: 'P', envPrefix: 'CAIRN_' },
    { YOUTRACK_URL: 'u', YOUTRACK_TOKEN: 't' },
  );
  await assert.rejects(
    () => prefixed.listStatuses(),
    /Missing YouTrack credentials: CAIRN_YOUTRACK_URL, CAIRN_YOUTRACK_TOKEN/,
  );

  // With the matching prefixed vars set, assertConfig passes (any later failure
  // is a network error, not a credentials error).
  const ok = createYouTrack(
    { projectKey: 'P', envPrefix: 'CAIRN_' },
    { CAIRN_YOUTRACK_URL: 'http://x', CAIRN_YOUTRACK_TOKEN: 't' },
  );
  await assert.rejects(() => ok.listStatuses(), (e) => !/Missing YouTrack credentials/.test(e.message));
});

atest('init: --env-prefix is written into the tracker config', async () => {
  const { main } = require('../lib/init');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  main(['--repo', dir, '--stack', 'nestjs', '--tracker', 'youtrack', '--project-key', 'PROOF', '--env-prefix', 'CAIRN_', '--no-color']);
  console.log = log;
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'cairn.config.json'), 'utf8'));
  assert.strictEqual(cfg.tracker.envPrefix, 'CAIRN_');
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

atest('init: re-run leaves an already-shimmed client alone', async () => {
  const { main } = require('../lib/init');
  const log = console.log;
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'ai/scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/scripts/jira.js'), '// copied client\n');
  console.log = () => {};
  main(['--repo', dir, '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  const shimmed = fs.readFileSync(path.join(dir, 'ai/scripts/jira.js'), 'utf8');

  main(['--repo', dir, '--force', '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  console.log = log;
  assert.strictEqual(fs.readFileSync(path.join(dir, 'ai/scripts/jira.js'), 'utf8'), shimmed);
});

atest('init: a hand-edited shim is kept unless --force-shims', async () => {
  const { main } = require('../lib/init');
  const log = console.log;
  const err = console.error;
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'ai/scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/scripts/jira.js'), '// copied client\n');
  console.log = () => {};
  console.error = () => {};
  main(['--repo', dir, '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);

  const p = path.join(dir, 'ai/scripts/jira.js');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\n// local tweak\n');

  // --force (config only) — the edited shim is left alone
  main(['--repo', dir, '--force', '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  assert.match(fs.readFileSync(p, 'utf8'), /local tweak/);

  // --force-shims — now it is replaced with the clean shim
  main(['--repo', dir, '--force-shims', '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
  console.log = log;
  console.error = err;
  const after = fs.readFileSync(p, 'utf8');
  assert.doesNotMatch(after, /local tweak/);
  assert.match(after, /@stonepandastudio\/cairn/);
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

// -------------------------------------------------------------------- render

const engine = require('../lib/render/engine');

test('render/engine: var, dotted path, and missing var', () => {
  assert.strictEqual(engine.render('Hi {{ name }}', { name: 'Al' }), 'Hi Al');
  assert.strictEqual(engine.render('{{ a.b.c }}', { a: { b: { c: 3 } } }), '3');
  assert.strictEqual(engine.render('[{{ nope }}]', {}), '[]');
});

test('render/engine: if / else', () => {
  assert.strictEqual(engine.render('{{#if x}}Y{{else}}N{{/if}}', { x: 1 }), 'Y');
  assert.strictEqual(engine.render('{{#if x}}Y{{else}}N{{/if}}', { x: [] }), 'N');
});

test('render/engine: each with @index_1 and this, standalone tags trimmed', () => {
  const out = engine.render('start\n{{#each xs}}\n{{@index_1}}. {{this.n}}\n{{/each}}\nend', {
    xs: [{ n: 'a' }, { n: 'b' }],
  });
  assert.strictEqual(out, 'start\n1. a\n2. b\nend');
});

test('render/engine: cairn comments are stripped, partials resolved and re-rendered', () => {
  const out = engine.render(
    '# T\n\n<!-- cairn preset: x -->\n{{! also gone }}\nreal {{> stack/y }}',
    { k: 'K' },
    (n) => (n === 'stack/y' ? '<!-- cairn: hdr -->\n[[{{ k }}]]' : null),
  );
  assert.strictEqual(out, '# T\n\nreal [[K]]');
});

atest('render: scaffolds ai/ from presets, greenfield-guarded', async () => {
  const { main: init } = require('../lib/init');
  const renderCli = require('../lib/render/cli');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  try {
    init(['--repo', dir, '--stack', 'nextjs,react,tailwind,drizzle', '--tracker', 'none', '--render', '--no-color']);

    const review = path.join(dir, 'ai/agents/reviewer.md');
    assert.ok(fs.existsSync(review), 'reviewer.md rendered');
    assert.ok(fs.existsSync(path.join(dir, '.claude/commands/plan-task.md')));
    assert.ok(fs.existsSync(path.join(dir, 'ai/WORKFLOW.md')));

    const body = fs.readFileSync(review, 'utf8');
    assert.doesNotMatch(body, /\{\{/, 'no unrendered handlebars');
    assert.doesNotMatch(body, /cairn preset:/, 'no preset header comment');
    assert.match(body, /NextjsReviewerAgent/, 'agent name substituted');
    assert.match(body, /'use server'/, 'nextjs review-checklist slot concatenated in');
    assert.match(body, /Drizzle query builder/, 'drizzle review-checklist slot concatenated in');

    const m = manifest.readManifest(dir);
    assert.ok(m.files['ai/agents/reviewer.md'] && m.files['ai/WORKFLOW.md']);

    // render also stores the merge base cairn sync will diff against.
    assert.strictEqual(
      fs.readFileSync(path.join(dir, '_cairn/base/ai/agents/reviewer.md'), 'utf8'),
      fs.readFileSync(review, 'utf8'),
      'base is a verbatim copy of the render',
    );

    const before = fs.readFileSync(review, 'utf8');
    renderCli.renderInto(dir, { paint: require('../lib/paint').makePaint(false) });
    assert.strictEqual(fs.readFileSync(review, 'utf8'), before, 're-render is a no-op');

    fs.writeFileSync(review, before + '\n<!-- mine -->\n');
    const { kept } = require('../lib/render').planRender({
      config: loadRepoConfig(dir, { required: true }),
      presetsDir: renderCli.PRESETS_DIR,
      manifest: m,
      repoPath: dir,
    });
    assert.ok(
      kept.some((k) => k.rel === 'ai/agents/reviewer.md' && /hand-edited/.test(k.reason)),
      'a hand edit is kept, not clobbered',
    );
  } finally {
    console.log = log;
  }
});

atest('render: create-brief.md documents omitting the task ID only for a remote tracker', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    const remote = tmpRepo();
    init(['--repo', remote, '--stack', 'nestjs', '--tracker', 'youtrack', '--project-key', 'CI', '--render', '--no-color']);
    const remoteBrief = fs.readFileSync(path.join(remote, '.claude/commands/create-brief.md'), 'utf8');
    assert.match(remoteBrief, /free-text title/, 'title-seeding hint present');
    assert.match(remoteBrief, /Omit the task ID/, 'omit-task hint present for a remote tracker');
    assert.match(remoteBrief, /YouTrack/);

    const none = tmpRepo();
    init(['--repo', none, '--stack', 'react', '--tracker', 'none', '--render', '--no-color']);
    const noneBrief = fs.readFileSync(path.join(none, '.claude/commands/create-brief.md'), 'utf8');
    assert.match(noneBrief, /free-text title/, 'title-seeding hint present regardless of tracker');
    assert.doesNotMatch(noneBrief, /Omit the task ID/, 'no tracker to mint a key, so no omit-task hint');

    // The hint is create_brief-specific — every other step stays generic.
    const execPlan = fs.readFileSync(path.join(remote, '.claude/commands/execute-plan.md'), 'utf8');
    assert.doesNotMatch(execPlan, /free-text title|Omit the task ID/);
  } finally {
    console.log = log;
  }
});

// --------------------------------------------------------------------- sync

const sync = require('../lib/sync');

// Build a repo with one managed file: base in _cairn/base/, `ours` on disk, and
// a manifest entry whose hash is what cairn "wrote last" (defaults to `ours`).
function syncFixture(rel, { base, ours, writtenHash, source = 'core/agents/x.md' }) {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (ours !== null) fs.writeFileSync(abs, ours);
  if (base !== undefined) manifest.writeBase(dir, rel, base);
  manifest.record(m, rel, source, ours || '');
  if (writtenHash !== undefined) m.files[rel].hash = writtenHash;
  manifest.writeManifest(dir, m);
  return { dir, entry: m.files[rel], manifest: m };
}

function plan1(rel, fixtureOpts, theirs, opts = {}) {
  const { dir, entry } = syncFixture(rel, fixtureOpts);
  const targets = new Map([[rel, { content: theirs, source: entry.source }]]);
  return { dir, action: sync.planFile(rel, entry, dir, targets, { adoptBase: false, ...opts }) };
}

test('sync: base == ours == theirs is a no-op', () => {
  const { action } = plan1('ai/x.md', { base: 'a\nb\nc\n', ours: 'a\nb\nc\n' }, 'a\nb\nc\n');
  assert.strictEqual(action.outcome, sync.OUTCOME.UNCHANGED);
  assert.strictEqual(action.write, undefined);
});

test('sync: only the template moved -> fast-forward', () => {
  const { action } = plan1(
    'ai/x.md',
    { base: 'a\nb\nc\n', ours: 'a\nb\nc\n' },
    'a\nb\nc\nd\n',
  );
  assert.strictEqual(action.outcome, sync.OUTCOME.FAST_FORWARD);
  assert.strictEqual(action.write, 'a\nb\nc\nd\n');
  assert.strictEqual(action.base, 'a\nb\nc\nd\n');
});

test('sync: local edit, steady template -> kept as MODIFIED, not written', () => {
  const { action } = plan1(
    'ai/x.md',
    { base: 'a\nb\nc\n', ours: 'a\nB\nc\n' },
    'a\nb\nc\n',
  );
  assert.strictEqual(action.outcome, sync.OUTCOME.MODIFIED);
  assert.strictEqual(action.write, undefined);
});

test('sync: non-overlapping edits three-way merge cleanly', () => {
  // ours adds a line at the top, the template adds one at the bottom.
  const base = 'l1\nl2\nl3\nl4\nl5\n';
  const ours = 'top\nl1\nl2\nl3\nl4\nl5\n';
  const theirs = 'l1\nl2\nl3\nl4\nl5\nbottom\n';
  const { action } = plan1('ai/x.md', { base, ours }, theirs);
  assert.strictEqual(action.outcome, sync.OUTCOME.MERGED);
  assert.strictEqual(action.write, 'top\nl1\nl2\nl3\nl4\nl5\nbottom\n');
  assert.strictEqual(action.base, theirs);
  assert.ok(!action.conflict);
});

test('sync: overlapping edits leave conflict markers, exit non-zero, converge next run', () => {
  const base = 'l1\nl2\nl3\n';
  const ours = 'l1\nOURS\nl3\n';
  const theirs = 'l1\nTHEIRS\nl3\n';
  const { action } = plan1('ai/x.md', { base, ours }, theirs);
  assert.strictEqual(action.outcome, sync.OUTCOME.CONFLICT);
  assert.ok(action.conflict, 'flagged as a conflict');
  assert.match(action.write, /<<<<<<< /);
  assert.match(action.write, />>>>>>> /);
  // base advances to theirs so a re-run treats the resolution as a plain local
  // edit rather than merging the same template change twice.
  assert.strictEqual(action.base, theirs);

  // After the human removes the markers, the next sync is a quiet MODIFIED and
  // the conflict flag clears.
  const resolved = plan1(
    'ai/x.md',
    { base: theirs, ours: 'l1\nRESOLVED\nl3\n', source: action.source },
    theirs,
  );
  // simulate the flag being set from the previous run
  resolved.action = sync.planFile(
    'ai/x.md',
    { hash: manifest.hashContent('l1\nRESOLVED\nl3\n'), source: 'core/agents/x.md', conflict: true },
    resolved.dir,
    new Map([['ai/x.md', { content: theirs, source: 'core/agents/x.md' }]]),
    { adoptBase: false },
  );
  assert.strictEqual(resolved.action.outcome, sync.OUTCOME.MODIFIED);
  assert.ok(resolved.action.clearConflict, 'conflict flag cleared once markers are gone');
});

test('sync: a file deleted locally is restored from the current render', () => {
  const { action } = plan1('ai/x.md', { base: 'a\n', ours: null }, 'a\nb\n');
  assert.strictEqual(action.outcome, sync.OUTCOME.RESTORED);
  assert.strictEqual(action.write, 'a\nb\n');
});

test('sync: a preset file the manifest lacks is CREATED, greenfield-guarded', () => {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  manifest.record(m, 'ai/kept.md', 'core/agents/x.md', 'k\n');
  fs.mkdirSync(path.join(dir, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/kept.md'), 'k\n');
  manifest.writeBase(dir, 'ai/kept.md', 'k\n');
  manifest.writeManifest(dir, m);

  // A second target the manifest has never seen. One is absent (create it), one
  // already sits on disk unmanaged (leave it).
  fs.writeFileSync(path.join(dir, 'ai/squatter.md'), 'not ours\n');
  const { planSync } = sync;
  const orig = require('../lib/render').renderTargets;
  require('../lib/render').renderTargets = () => ({
    targets: [
      ['ai/kept.md', 'k\n', 'core/agents/x.md'],
      ['ai/new.md', 'fresh\n', 'core/agents/y.md'],
      ['ai/squatter.md', 'rendered\n', 'core/agents/z.md'],
    ],
  });
  try {
    const { actions } = planSync({ config: {}, presetsDir: 'x', manifest: m, repoPath: dir });
    const byRel = Object.fromEntries(actions.map((a) => [a.rel, a.outcome]));
    assert.strictEqual(byRel['ai/new.md'], sync.OUTCOME.CREATED);
    assert.strictEqual(byRel['ai/squatter.md'], undefined, 'an unmanaged file on disk is left alone');
  } finally {
    require('../lib/render').renderTargets = orig;
  }
});

test('sync: a path the presets no longer emit is ORPHANED, never touched', () => {
  const { dir, entry } = syncFixture('ai/gone.md', { base: 'x\n', ours: 'x\n' });
  const action = sync.planFile('ai/gone.md', entry, dir, new Map(), { adoptBase: false });
  assert.strictEqual(action.outcome, sync.OUTCOME.ORPHANED);
  assert.strictEqual(action.write, undefined);
});

test('sync: no base + hand-edited needs --adopt-base', () => {
  const noBase = plan1('ai/x.md', { base: undefined, ours: 'edited\n', writtenHash: manifest.hashContent('orig\n') }, 'orig2\n');
  assert.strictEqual(noBase.action.outcome, sync.OUTCOME.NO_BASE);

  const adopted = plan1(
    'ai/x.md',
    { base: undefined, ours: 'edited\n', writtenHash: manifest.hashContent('orig\n') },
    'orig\n',
    { adoptBase: true },
  );
  // ours becomes the base; template == old written hash != ours, so it merges.
  assert.notStrictEqual(adopted.action.outcome, sync.OUTCOME.NO_BASE);
});

test('sync: no base but untouched since render seeds the base and fast-forwards', () => {
  const { action } = plan1(
    'ai/x.md',
    { base: undefined, ours: 'v1\n', writtenHash: manifest.hashContent('v1\n') },
    'v2\n',
  );
  assert.strictEqual(action.outcome, sync.OUTCOME.FAST_FORWARD);
  assert.strictEqual(action.write, 'v2\n');
});

atest('sync: CLI applies a fast-forward, updates the manifest, exits 0', async () => {
  const { main: init } = require('../lib/init');
  const syncCli = require('../lib/sync/cli');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  try {
    init(['--repo', dir, '--stack', 'nextjs,react', '--tracker', 'none', '--render', '--no-color']);
    const wf = path.join(dir, 'ai/WORKFLOW.md');

    // Make the stored base stale so the current render reads as a template change,
    // with the working file matching that stale base (no local edit).
    const stale = 'stale\n' + fs.readFileSync(wf, 'utf8');
    manifest.writeBase(dir, 'ai/WORKFLOW.md', stale);
    fs.writeFileSync(wf, stale);
    const m = manifest.readManifest(dir);
    m.files['ai/WORKFLOW.md'].hash = manifest.hashContent(stale);
    manifest.writeManifest(dir, m);

    const rendered = require('../lib/render').renderTargets({
      config: loadRepoConfig(dir, { required: true }),
      presetsDir: syncCli.PRESETS_DIR,
    }).targets.find(([rel]) => rel === 'ai/WORKFLOW.md')[1];

    const code = syncCli.main(['--repo', dir, '--no-color']);
    assert.strictEqual(code, 0);
    assert.strictEqual(fs.readFileSync(wf, 'utf8'), rendered, 'file fast-forwarded to the render');
    assert.strictEqual(
      fs.readFileSync(path.join(dir, '_cairn/base/ai/WORKFLOW.md'), 'utf8'),
      rendered,
      'base advanced',
    );
    assert.strictEqual(
      manifest.readManifest(dir).files['ai/WORKFLOW.md'].hash,
      manifest.hashContent(rendered),
    );
  } finally {
    console.log = log;
  }
});

atest('sync: CLI writes conflict markers, exits 3, and doctor reports CONFLICT', async () => {
  const { main: init } = require('../lib/init');
  const syncCli = require('../lib/sync/cli');
  const { statusFor, readManifest } = require('../lib/manifest');
  const dir = tmpRepo();
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    init(['--repo', dir, '--stack', 'nextjs,react', '--tracker', 'none', '--render', '--no-color']);
    const agents = path.join(dir, 'ai/AGENTS.md');
    const original = fs.readFileSync(agents, 'utf8');

    // Stale base differs from the render on line 1; the working file differs from
    // the base on the same line -> a genuine overlap.
    const staleBase = original.replace(/^.*\n/, 'BASE LINE ONE\n');
    const ourEdit = original.replace(/^.*\n/, 'OUR LINE ONE\n');
    manifest.writeBase(dir, 'ai/AGENTS.md', staleBase);
    fs.writeFileSync(agents, ourEdit);
    const m = manifest.readManifest(dir);
    m.files['ai/AGENTS.md'].hash = manifest.hashContent(ourEdit);
    manifest.writeManifest(dir, m);

    const code = syncCli.main(['--repo', dir, '--no-color']);
    assert.strictEqual(code, 3, 'conflict exit code');
    assert.match(fs.readFileSync(agents, 'utf8'), /<<<<<<< /, 'markers written in place');

    const state = statusFor(dir, readManifest(dir)).find((f) => f.path === 'ai/AGENTS.md');
    assert.strictEqual(state.state, 'CONFLICT');
  } finally {
    console.log = log;
    console.error = err;
  }
});

atest('sync: --dry-run writes nothing', async () => {
  const { main: init } = require('../lib/init');
  const syncCli = require('../lib/sync/cli');
  const dir = tmpRepo();
  const log = console.log;
  console.log = () => {};
  try {
    init(['--repo', dir, '--stack', 'nextjs', '--tracker', 'none', '--render', '--no-color']);
    const wf = path.join(dir, 'ai/WORKFLOW.md');
    const stale = 'stale\n' + fs.readFileSync(wf, 'utf8');
    manifest.writeBase(dir, 'ai/WORKFLOW.md', stale);
    fs.writeFileSync(wf, stale);

    const snapshot = fs.readFileSync(wf, 'utf8');
    const baseSnapshot = fs.readFileSync(path.join(dir, '_cairn/base/ai/WORKFLOW.md'), 'utf8');
    syncCli.main(['--repo', dir, '--dry-run', '--no-color']);
    assert.strictEqual(fs.readFileSync(wf, 'utf8'), snapshot);
    assert.strictEqual(fs.readFileSync(path.join(dir, '_cairn/base/ai/WORKFLOW.md'), 'utf8'), baseSnapshot);
  } finally {
    console.log = log;
  }
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
