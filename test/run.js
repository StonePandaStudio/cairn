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

// Serve canned JSON for `fetch` calls, recording each one. Restores on completion.
async function withFetch(routes, fn) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const hit = Object.entries(routes).find(([k]) => u.startsWith(k));
    const body = hit ? hit[1] : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  };
  try {
    await fn(calls);
  } finally {
    global.fetch = orig;
  }
}

const ytEnv = { YOUTRACK_URL: 'https://yt.example', YOUTRACK_TOKEN: 't', YOUTRACK_PROJECT: 'CI' };

atest('tracker: youtrack link resolves the issue id, then posts a "depends on" command', async () => {
  await withFetch({ '/api/issues/CI-14': { id: '2-14' } }, async (calls) => {
    const res = await createYouTrack({}, ytEnv).link({ key: 'CI-14', dependsOn: 'CI-20' });
    assert.deepStrictEqual(res, { key: 'CI-14', dependsOn: 'CI-20' });
    const cmd = calls.find((c) => c.url === '/api/commands');
    assert.strictEqual(cmd.method, 'POST');
    assert.deepStrictEqual(cmd.body, { issues: [{ id: '2-14' }], query: 'depends on CI-20' });
  });
});

atest('tracker: youtrack link rejects missing keys and self-dependency before any request', async () => {
  await withFetch({}, async (calls) => {
    const t = createYouTrack({}, ytEnv);
    await assert.rejects(() => t.link({ dependsOn: 'CI-1' }), /requires a key/);
    await assert.rejects(() => t.link({ key: 'CI-1' }), /requires dependsOn/);
    await assert.rejects(() => t.link({ key: 'CI-1', dependsOn: 'CI-1' }), /depend on itself/);
    assert.strictEqual(calls.length, 0);
  });
});

atest('tracker: youtrack get reports subtask and Depend links from one links fetch', async () => {
  const links = [
    { direction: 'INWARD', linkType: { name: 'Subtask' }, issues: [{ idReadable: 'CI-1' }] },
    { direction: 'OUTWARD', linkType: { name: 'Subtask' }, issues: [{ idReadable: 'CI-3' }] },
    { direction: 'INWARD', linkType: { name: 'Depend' }, issues: [{ idReadable: 'CI-20' }] },
    { direction: 'OUTWARD', linkType: { name: 'Depend' }, issues: [{ idReadable: 'CI-30' }] },
  ];
  await withFetch(
    { '/api/issues/CI-2/links': links, '/api/issues/CI-2': { idReadable: 'CI-2', summary: 's', customFields: [] } },
    async (calls) => {
      const issue = await createYouTrack({}, ytEnv).get('CI-2');
      assert.strictEqual(issue.parent, 'CI-1');
      assert.deepStrictEqual(issue.subtasks, ['CI-3']);
      assert.deepStrictEqual(issue.dependsOn, ['CI-20']);
      assert.deepStrictEqual(issue.requiredFor, ['CI-30']);
      assert.strictEqual(calls.filter((c) => c.url.includes('/links')).length, 1);
    },
  );
});

atest('tracker: link is a skip on none and an explicit error on jira-server', async () => {
  assert.strictEqual((await createNone().link({ key: 'X-1', dependsOn: 'X-2' })).skipped, true);
  await assert.rejects(
    () => createJiraServer({ projectKey: 'X' }, {}).link({ key: 'X-1', dependsOn: 'X-2' }),
    /not implemented for jira-server/,
  );
});

// ---------------------------------------------------------------- overrides

const localMod = require('../lib/local');

const SLOT = [
  '### Controllers',
  '- thin controllers',
  '- bind inputs plainly',
  '',
  '### Services',
  '- one service per feature',
  '#### Transactions',
  '- wrap writes',
  '',
  '### DTOs',
  '- one file per DTO',
].join('\n');

const ov = (text, replace = false) => ({ replace, text });

test('overrides: a section replaces the preset section of the same heading; the rest is untouched', () => {
  const { text, matched } = localMod.applySlotOverride(SLOT, ov('### Controllers\n- bind with a schema\n- add guards'));
  assert.ok(text.includes('- bind with a schema'));
  assert.ok(!text.includes('- bind inputs plainly') && !text.includes('- thin controllers'));
  assert.ok(text.includes('### Services') && text.includes('- one file per DTO'), 'other sections kept');
  assert.ok(text.includes('### Controllers\n- bind with a schema\n- add guards\n\n### Services'), 'spacing between sections is preserved');
  assert.deepStrictEqual(matched, ['3|controllers']);
});

test('overrides: replacing a section replaces what is nested under it; a deeper heading can be overridden alone', () => {
  const parent = localMod.applySlotOverride(SLOT, ov('### Services\n- services are stateless')).text;
  assert.ok(!parent.includes('#### Transactions') && !parent.includes('- wrap writes'), 'nested section goes with its parent');
  const child = localMod.applySlotOverride(SLOT, ov('#### Transactions\n- wrap writes and reads')).text;
  assert.ok(child.includes('- wrap writes and reads') && child.includes('- one service per feature'));
});

test('overrides: a new heading is appended; <!-- remove --> deletes a section; no headings appends text; replace is the whole slot', () => {
  const added = localMod.applySlotOverride(SLOT, ov('### Billing\n- use the ledger')).text;
  assert.ok(added.endsWith('### Billing\n- use the ledger'));
  assert.ok(added.includes('- one file per DTO\n\n### Billing'));

  const removed = localMod.applySlotOverride(SLOT, ov('### DTOs\n<!-- remove -->')).text;
  assert.ok(!removed.includes('DTOs') && !removed.includes('one file per DTO'));
  assert.ok(removed.includes('### Services'));

  assert.strictEqual(localMod.applySlotOverride('- a\n- b', ov('- c')).text, '- a\n- b\n\n- c');
  assert.strictEqual(localMod.applySlotOverride(SLOT, ov('only this', true)).text, 'only this');
  assert.strictEqual(localMod.applySlotOverride('- a', ov('')).text, '- a');
});

test('overrides: a heading inside a fenced code block is not a section', () => {
  const upstream = '### A\n```\n### not a heading\n```\n- keep\n\n### B\n- b';
  const { text } = localMod.applySlotOverride(upstream, ov('### B\n- changed'));
  assert.ok(text.includes('### not a heading') && text.includes('- keep') && text.includes('- changed'));
});

test('overrides: file parsing drops author comments, honours the replace marker', () => {
  assert.deepStrictEqual(localMod.parseOverrideFile('<!-- my note -->\n### A\n- x\n'), { replace: false, text: '### A\n- x' });
  assert.deepStrictEqual(localMod.parseOverrideFile('<!-- replace -->\n- all\n'), { replace: true, text: '- all' });
  assert.deepStrictEqual(localMod.parseOverrideFile('\r\n### A\r\n- x\r\n'), { replace: false, text: '### A\n- x' });
});

function rendered(config, rel, extra = {}) {
  const render = require('../lib/render');
  return render.renderTargets({ config, presetsDir: 'presets', ...extra }).targets.find((t) => t[0] === rel)[1];
}

test('overrides: a repo\'s ai/local/slots/ changes the rendered agent; no overrides renders exactly as before', () => {
  const config = { stack: ['nestjs', 'typeorm'], tracker: { provider: 'none' } };
  const dir = tmpRepo();
  const plain = rendered(config, 'ai/agents/developer.md', { repoPath: dir });
  assert.strictEqual(plain, rendered(config, 'ai/agents/developer.md'), 'an empty ai/local changes nothing');

  fs.mkdirSync(path.join(dir, 'ai/local/slots'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ai/local/slots/implementation-reference.md'),
    '<!-- project rules -->\n### Controllers\n- Bind inputs with `@Body({ schema })`\n',
  );
  const out = rendered(config, 'ai/agents/developer.md', { repoPath: dir });
  assert.ok(out.includes('- Bind inputs with `@Body({ schema })`'));
  assert.ok(!out.includes('Thin controllers'), 'preset Controllers section replaced');
  assert.ok(out.includes('### Services') && out.includes('### DTOs'), 'every other preset section is still there');
  assert.ok(!out.includes('project rules'), 'author comment not rendered');
  // The same slot feeds the architect only if its template uses it.
  assert.strictEqual(rendered(config, 'ai/agents/reviewer.md', { repoPath: dir }), rendered(config, 'ai/agents/reviewer.md'));
});

test('overrides: ai/local/agents/<name>.md is appended under "Project-specific"; the template engine runs on it', () => {
  const config = { stack: ['react'], tracker: { provider: 'youtrack', projectKey: 'CI' } };
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'ai/local/agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/local/agents/developer.md'), 'Run `npm run lint` before reporting. Tracker: {{ tracker.exampleKey }}.\n');
  const out = rendered(config, 'ai/agents/developer.md', { repoPath: dir });
  assert.match(out, /\n---\n\n## Project-specific\n\nRun `npm run lint` before reporting\. Tracker: CI\.\n$/);
  assert.ok(!rendered(config, 'ai/agents/architect.md', { repoPath: dir }).includes('Project-specific'));
});

test('overrides: an in-memory overlay previews overrides that are not on disk', () => {
  const config = { stack: ['nestjs'], tracker: { provider: 'none' } };
  const out = rendered(config, 'ai/agents/developer.md', {
    localOverrides: { slots: { 'implementation-reference': '### Testing\n- jest only' } },
  });
  assert.ok(out.includes('- jest only'));
});

// ----------------------------------------------------- override inspection

test('overrides: inspect reports unknown slots and agents, new overrides, upstream drift and sections that stopped matching', () => {
  const { inspectOverrides, needsAttention, recordOverrides } = require('../lib/local/inspect');
  const { hashContent } = manifest;
  const config = { stack: ['nestjs'], tracker: { provider: 'none' } };
  const dir = tmpRepo();
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put('ai/local/slots/implementation-reference.md', '### Controllers\n- x\n');
  put('ai/local/slots/not-a-slot.md', '- y\n');
  put('ai/local/agents/developer.md', 'rule\n');
  put('ai/local/agents/ghost.md', 'rule\n');

  const find = (items, name, kind) => items.find((i) => i.name === name && i.kind === kind);
  let items = inspectOverrides({ repoPath: dir, config, presetsDir: 'presets', manifest: { files: {} } });
  assert.strictEqual(find(items, 'implementation-reference', 'slot').state, 'new');
  assert.strictEqual(find(items, 'not-a-slot', 'slot').state, 'unknown-slot');
  assert.strictEqual(find(items, 'developer', 'agent').state, 'ok');
  assert.strictEqual(find(items, 'ghost', 'agent').state, 'unknown-agent');
  assert.deepStrictEqual(items.filter(needsAttention).map((i) => i.name).sort(), ['ghost', 'not-a-slot']);

  // Sync records the new one; afterwards it is ok.
  const m = { files: {} };
  assert.ok(recordOverrides(m, items));
  assert.deepStrictEqual(Object.keys(m.overrides), ['slots/implementation-reference']);
  items = inspectOverrides({ repoPath: dir, config, presetsDir: 'presets', manifest: m });
  assert.strictEqual(find(items, 'implementation-reference', 'slot').state, 'ok');

  // The preset moves under it.
  const drifted = { files: {}, overrides: { 'slots/implementation-reference': { ...m.overrides['slots/implementation-reference'], upstream: hashContent('older preset text') } } };
  const d = find(inspectOverrides({ repoPath: dir, config, presetsDir: 'presets', manifest: drifted }), 'implementation-reference', 'slot');
  assert.strictEqual(d.state, 'upstream-changed');
  assert.match(d.message, /cairn override ack implementation-reference/);

  // A section the override replaced no longer exists in the preset.
  const gone = { files: {}, overrides: { 'slots/implementation-reference': { upstream: m.overrides['slots/implementation-reference'].upstream, matched: ['3|controllers', '3|renamed away'] } } };
  const g = find(inspectOverrides({ repoPath: dir, config, presetsDir: 'presets', manifest: gone }), 'implementation-reference', 'slot');
  assert.strictEqual(g.state, 'section-gone');
  assert.match(g.message, /"renamed away"/);
});

// --------------------------------------------------------------- extract

const extractFx = () => {
  const render = require('../lib/render');
  const config = { stack: ['nestjs'], tracker: { provider: 'none' } };
  const base = render.renderTargets({ config, presetsDir: 'presets' }).targets.find((t) => t[0] === 'ai/agents/developer.md')[1];
  return { config, base, extract: (ours) => require('../lib/local/extract').extractOverrides({ rel: 'ai/agents/developer.md', ours, base, config, presetsDir: 'presets', repoPath: null }) };
};

test('extract: an edit inside a slot section becomes a one-section override that reproduces the edit', () => {
  const { base, extract } = extractFx();
  const ours = base.replace('- Thin controllers: delegate all business logic to services', '- Thin controllers: delegate everything');
  const r = extract(ours);
  assert.deepStrictEqual(Object.keys(r.slots), ['implementation-reference']);
  assert.match(r.slots['implementation-reference'], /^### Controllers\n/);
  assert.ok(r.slots['implementation-reference'].includes('delegate everything'));
  assert.ok(!r.slots['implementation-reference'].includes('### Services'), 'only the changed section is written');
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.verified, true);
});

test('extract: text added at the very end becomes the agent append; an edit outside any slot is reported, not guessed', () => {
  const { base, extract } = extractFx();
  const appended = extract(base.trimEnd() + '\n\n- Always run the linter.\n');
  assert.strictEqual(appended.agent, '- Always run the linter.');
  assert.deepStrictEqual(appended.slots, {});

  const outside = extract(base.replace('Hands-on coder.', 'Hands-on, careful coder.'));
  assert.deepStrictEqual(outside.slots, {});
  assert.strictEqual(outside.agent, null);
  assert.strictEqual(outside.unplaced.length, 1);
  assert.match(outside.unplaced[0], /\+Hands-on, careful coder\./);
  assert.strictEqual(outside.verified, false);

  assert.strictEqual(extract(base).verified, true, 'no edit, nothing to extract');
});

test('extract: derived overrides cover list slots, added sections and removed sections', () => {
  const { deriveSlotOverride, } = require('../lib/local/extract');
  const apply = (oldT, newT) => localMod.applySlotOverride(oldT, localMod.parseOverrideFile(deriveSlotOverride(oldT, newT))).text;
  assert.strictEqual(deriveSlotOverride('- a\n- b', '- a\n- b\n- c'), '- c', 'an addition to a list is an append');
  assert.match(deriveSlotOverride('- a\n- b', '- a\n- B'), /^<!-- replace -->\n- a\n- B$/, 'any other change to a list is a replace');
  assert.strictEqual(deriveSlotOverride('- a', '- a'), null);

  const old = '### One\n- 1\n\n### Two\n- 2\n\n### Three\n- 3';
  for (const next of [
    '### One\n- 1\n\n### Two\n- changed\n\n### Three\n- 3',
    '### One\n- 1\n\n### Three\n- 3',
    '### One\n- 1\n\n### Two\n- 2\n\n### Three\n- 3\n\n### Four\n- 4',
  ]) {
    assert.strictEqual(apply(old, next), next, `round trip: ${JSON.stringify(next)}`);
  }
});

atest('override: status, ack and extract work end to end through the command', async () => {
  const { main: init } = require('../lib/init');
  const cli = require('../lib/override/cli');
  const syncCli = require('../lib/sync/cli');
  const dir = tmpRepo();
  const err = console.error;
  console.error = () => {};
  try {
    captureLog(() => init(['--repo', dir, '--stack', 'nestjs', '--tracker', 'none', '--render', '--no-color']));
    assert.match(captureLog(() => cli.main(['status', '--repo', dir, '--no-color'])).out, /No overrides/);

    // Hand edit a generated file, then extract it into ai/local/.
    const dev = path.join(dir, 'ai/agents/developer.md');
    fs.writeFileSync(dev, fs.readFileSync(dev, 'utf8').replace('- Thin controllers: delegate all business logic to services', '- Thin controllers: delegate everything'));
    const dry = captureLog(() => cli.main(['extract', 'ai/agents/developer.md', '--repo', dir, '--dry-run', '--no-color']));
    assert.strictEqual(dry.result, 0);
    assert.match(dry.out, /would write\s+ai\/local\/slots\/implementation-reference\.md/);
    assert.ok(!fs.existsSync(path.join(dir, 'ai/local')), 'dry run writes nothing');

    const real = captureLog(() => cli.main(['extract', 'ai/agents/developer.md', '--repo', dir, '--no-color']));
    assert.strictEqual(real.result, 0);
    assert.match(real.out, /Verified/);
    const written = fs.readFileSync(path.join(dir, 'ai/local/slots/implementation-reference.md'), 'utf8');
    assert.ok(written.startsWith('### Controllers') && written.includes('delegate everything'));

    // A second extract will not clobber what it just wrote.
    assert.strictEqual(captureLog(() => cli.main(['extract', 'ai/agents/developer.md', '--repo', dir, '--no-color'])).result, 3);

    // The recovery path: with the override in place, --reset regenerates the file
    // and it ends up byte-for-byte what the hand edit was.
    const edited = fs.readFileSync(dev, 'utf8');
    assert.strictEqual(captureLog(() => syncCli.main(['--repo', dir, '--no-color', '--reset', 'ai/agents/developer.md'])).result, 0);
    assert.strictEqual(fs.readFileSync(dev, 'utf8').replace(/\r\n/g, '\n'), edited.replace(/\r\n/g, '\n'));

    // status sees it; ack accepts an unknown slot only if it is a real override.
    assert.match(captureLog(() => cli.main(['status', '--repo', dir, '--no-color'])).out, /ok\s+ai\/local\/slots\/implementation-reference\.md/);
    assert.strictEqual(cli.main(['ack', 'nope', '--repo', dir, '--no-color']), 2);
    assert.strictEqual(captureLog(() => cli.main(['ack', 'implementation-reference', '--repo', dir, '--no-color'])).result, 0);
  } finally {
    console.error = err;
  }
});

// ------------------------------------------------------------------- scout

test('model: the required tier renders as a name, and a versioned id loses its version', () => {
  const render = require('../lib/render');
  const reviewer = (model) => {
    const config = { stack: ['react'], tracker: { provider: 'none' }, ...(model ? { model } : {}) };
    return render.renderTargets({ config, presetsDir: 'presets' }).targets.find((t) => t[0] === 'ai/agents/reviewer.md')[1];
  };
  assert.match(reviewer(), /\*\*Sonnet\*\* is recommended/);
  assert.match(reviewer('opus'), /\*\*Opus\*\* is recommended/);
  assert.match(reviewer('claude-sonnet-5'), /\*\*Sonnet\*\* is recommended/);
  assert.ok(!/claude-/.test(reviewer('claude-sonnet-5')));
});

// ------------------------------------------------------------ stage moves

const stageConfig = (statuses, extra = {}) => ({
  stack: ['nestjs'],
  tracker: { provider: 'youtrack', projectKey: 'CI', ...(statuses ? { statuses, statusesSet: Object.keys(statuses) } : { statusesSet: [] }) },
  ...extra,
});
const doc = (config, rel) => rendered(config, rel);

test('config: only the stages a repo named count as configured; defaults fill the rest', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ tracker: { provider: 'youtrack', projectKey: 'CI', statuses: { review: 'Review' } } }));
  const t = loadRepoConfig(dir).tracker;
  assert.deepStrictEqual(t.statusesSet, ['review']);
  assert.strictEqual(t.statuses.review, 'Review');
  assert.strictEqual(t.statuses.inProgress, 'In Progress', 'default is filled in but not "set"');
});

test('stage moves: a repo that names no stages renders no move commands, and says "Later stage moves are manual"', () => {
  const config = stageConfig(null);
  const reviewer = doc(config, 'ai/agents/reviewer.md');
  assert.ok(reviewer.includes('Does not sync to the tracker'));
  assert.ok(!/R\.0|--if-exists/.test(reviewer));
  assert.ok(!/--if-exists/.test(doc(config, 'ai/agents/architect.md')));
  const wf = doc(config, 'ai/WORKFLOW.md');
  assert.ok(wf.includes('Later stage moves are manual'));
  assert.ok(!wf.includes('--if-exists') && !wf.includes('Stage names'));
});

test('stage moves: review is opt-in and moves the issue at the start of the review, with the missing-stage rule', () => {
  const config = stageConfig({ review: 'Review' });
  const reviewer = doc(config, 'ai/agents/reviewer.md');
  assert.match(reviewer, /### R\.0 — Mark the issue as in review/);
  assert.ok(reviewer.includes('npx cairn tracker set-status [key] "Review" --if-exists'));
  assert.ok(reviewer.indexOf('R.0') < reviewer.indexOf('### R.1'), 'before anything else');
  assert.match(reviewer, /skipped: stage "Review" does not exist on this board/);
  assert.match(reviewer, /do not move the issue to any other stage/);
  assert.ok(!reviewer.includes('Does not sync to the tracker'));
  assert.match(reviewer, /The verdict never changes the stage/);

  const wf = doc(config, 'ai/WORKFLOW.md');
  assert.match(wf, /\| `code_review\(task, step\)` \| at the start of the review, .*`Review` with `npx cairn tracker set-status <key> "Review" --if-exists`/);
  assert.ok(wf.includes('Stage moves after `Review` are manual'));
  assert.ok(wf.includes('**Stage names** come from `tracker.statuses`'));
  assert.ok(!/--if-exists/.test(doc(config, 'ai/agents/architect.md')), 'review alone does not turn on the planning move');
});

test('stage moves: enrich_description moves to the configured in-progress stage, independently of review', () => {
  const config = stageConfig({ inProgress: 'Develop' });
  const architect = doc(config, 'ai/agents/architect.md');
  const a5 = architect.slice(architect.indexOf('#### A.5'), architect.indexOf('### Mode B'));
  assert.match(a5, /^#### A\.5 — Move the issue to `Develop`/);
  assert.ok(!architect.includes('#### B.5'), 'plan_task no longer moves the stage');
  assert.ok(a5.includes('npx cairn tracker set-status [key] "Develop" --if-exists'));
  assert.match(a5, /skipped: stage "Develop" does not exist on this board/);
  assert.match(doc(config, 'ai/WORKFLOW.md'), /\| `enrich_description\(task, step\)` \| .*`Develop` with `npx cairn tracker set-status <key> "Develop" --if-exists`/);
  assert.ok(doc(config, 'ai/agents/reviewer.md').includes('Does not sync to the tracker'));
});

test('stage moves: no tracker, or a custom workflow, is left alone', () => {
  const none = { stack: ['nestjs'], tracker: { provider: 'none', statuses: { review: 'Review' }, statusesSet: ['review'] } };
  assert.ok(!doc(none, 'ai/agents/reviewer.md').includes('--if-exists'));

  const custom = stageConfig({ review: 'Review' }, {
    workflow: { steps: [{ id: 'review', fn: 'code_review', command: 'code-review', role: 'reviewer', oneLine: 'x', trackerAction: 'my own wording' }] },
  });
  const wf = doc(custom, 'ai/WORKFLOW.md');
  assert.ok(wf.includes('my own wording') && !/\| `code_review\(task, step\)` \|[^\n]*--if-exists/.test(wf));
});

// A fetch stub that routes on "METHOD path" prefixes; unmatched is a 404.
async function withRoutes(routes, fn) {
  const orig = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const key = `${opts.method || 'GET'} ${u}`;
    calls.push(key);
    const hit = Object.entries(routes).find(([k]) => key.startsWith(k));
    const [status, body] = hit ? (Array.isArray(hit[1]) && typeof hit[1][0] === 'number' ? hit[1] : [200, hit[1]]) : [404, { error: 'not routed' }];
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  try {
    await fn(calls);
  } finally {
    global.fetch = orig;
  }
}

const YT_STAGES = {
  'GET /api/admin/projects/CI/customFields': [{ field: { name: 'Stage' }, bundle: { id: 'b1' } }],
  'GET /api/admin/customFieldSettings/bundles/state/b1': { values: [{ name: 'Backlog' }, { name: 'Develop' }, { name: 'Done' }] },
  'GET /api/issues/CI-1': { customFields: [{ name: 'Stage', value: { name: 'Develop' } }] },
};

atest('stage moves: youtrack names the board\'s stages when asked for one it does not have; other failures stay plain errors', async () => {
  const { UnknownStatusError, TrackerError } = require('../lib/tracker');
  await withRoutes({ ...YT_STAGES, 'POST /api/issues/CI-1': [400, { error: 'bad value' }] }, async () => {
    const t = createYouTrack({}, ytEnv);
    await assert.rejects(() => t.setStatus('CI-1', 'Review'), (e) => {
      assert.ok(e instanceof UnknownStatusError);
      assert.deepStrictEqual(e.available, ['Backlog', 'Develop', 'Done']);
      assert.match(e.message, /valid: Backlog, Develop, Done/);
      return true;
    });
    // A stage that does exist but whose POST failed is a real error, not "skip me".
    await assert.rejects(() => t.setStatus('CI-1', 'Done'), (e) => e instanceof TrackerError && !(e instanceof UnknownStatusError));
    assert.deepStrictEqual(await t.setStatus('CI-1', 'Develop'), { key: 'CI-1', from: 'Develop', to: 'Develop', changed: false });
  });
});

atest('stage moves: jira tells a stage the board lacks from one it has but cannot reach', async () => {
  const { UnknownStatusError, NoTransitionError } = require('../lib/tracker');
  const env = { JIRA_BASE_URL: 'https://j.example', JIRA_USER: 'u', JIRA_PASSWORD: 'p' };
  const routes = {
    'GET /rest/api/2/issue/TEST-1/transitions': { transitions: [] },
    'GET /rest/api/2/issue/TEST-1?fields=status': { fields: { status: { name: 'To Do' } } },
    'GET /rest/api/2/project/TEST/statuses': [{ name: 'Task', statuses: [{ name: 'To Do' }, { name: 'Done' }] }],
  };
  await withRoutes(routes, async () => {
    const j = createJiraServer({ projectKey: 'TEST' }, env);
    await assert.rejects(() => j.setStatus('TEST-1', 'Review'), (e) => e instanceof UnknownStatusError && e.available.includes('Done'));
    await assert.rejects(() => j.setStatus('TEST-1', 'Done'), (e) => e instanceof NoTransitionError);
  });
});

function trackerRepo(statuses) {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ tracker: { provider: 'youtrack', projectKey: 'CI', ...(statuses ? { statuses } : {}) } }));
  return dir;
}

async function runCli(dir, argv) {
  const lines = { out: [], err: [] };
  const saved = { ...process.env };
  Object.assign(process.env, { YOUTRACK_URL: 'https://yt.example', YOUTRACK_TOKEN: 't', YOUTRACK_PROJECT: 'CI' });
  try {
    const code = await cli.run(argv, { cwd: dir, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) });
    return { code, out: lines.out.join('\n'), err: lines.err.join('\n') };
  } finally {
    process.env = saved;
  }
}

atest('stage moves: set-status --if-exists skips a missing stage with a message and exit 0; without the flag it fails', async () => {
  const dir = trackerRepo();
  await withRoutes({ ...YT_STAGES, 'POST /api/issues/CI-1': [400, { error: 'bad value' }] }, async (calls) => {
    const soft = await runCli(dir, ['set-status', 'CI-1', 'Review', '--if-exists']);
    assert.strictEqual(soft.code, 0);
    assert.match(soft.err, /^skipped: stage "Review" does not exist on this board, so CI-1 was not moved\. Valid stages: Backlog, Develop, Done\./);
    assert.strictEqual(soft.out, '', 'nothing on stdout that reads as "moved"');

    const hard = await runCli(dir, ['set-status', 'CI-1', 'Review']);
    assert.strictEqual(hard.code, 1);
    assert.match(hard.err, /valid: Backlog, Develop, Done/);

    const ok = await runCli(dir, ['set-status', 'CI-1', 'Develop', '--if-exists']);
    assert.strictEqual(ok.code, 0);
    assert.strictEqual(ok.out, 'CI-1 already Develop');
  });
});

atest('stage moves: check-statuses reports each configured stage against the board and fails on a missing one', async () => {
  await withRoutes(YT_STAGES, async () => {
    const good = await runCli(trackerRepo({ inProgress: 'Develop' }), ['check-statuses']);
    assert.strictEqual(good.code, 0);
    assert.match(good.out, /inProgress\s+"Develop"\s+ok/);
    assert.match(good.out, /review\s+not configured/);
    assert.match(good.out, /todo\s+"To Do"\s+not on the board \(cairn's default; unused/);
    assert.match(good.out, /board stages: Backlog, Develop, Done/);

    const bad = await runCli(trackerRepo({ inProgress: 'Develop', review: 'Review' }), ['check-statuses']);
    assert.strictEqual(bad.code, 1);
    assert.match(bad.out, /review\s+"Review"\s+MISSING from the board/);
    assert.match(bad.err, /1 configured stage\(s\) do not exist/);
  });
});

test('scout: model defaults to haiku and follows agents.scout.model', () => {
  const render = require('../lib/render');
  const model = (agents) => {
    const config = { stack: ['react'], tracker: { provider: 'none' }, ...(agents ? { agents } : {}) };
    const scout = render.renderTargets({ config, presetsDir: 'presets' }).targets.find((t) => t[0] === '.claude/agents/code-scout.md');
    return scout[1].match(/^model: (.*)$/m)[1];
  };
  assert.strictEqual(model(), 'haiku');
  assert.strictEqual(model({ scout: { model: 'sonnet' } }), 'sonnet');
  assert.strictEqual(model({ architect: { name: 'Arch' } }), 'haiku');
});

test('scout: only tier aliases are accepted, never a versioned id or anything that could break the frontmatter', () => {
  const dir = tmpRepo();
  const load = (model) => {
    fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ agents: { scout: { model } } }));
    return loadRepoConfig(dir);
  };
  for (const ok of ['haiku', 'sonnet', 'opus', 'inherit']) assert.strictEqual(load(ok).agents.scout.model, ok);
  assert.throws(() => load('claude-sonnet-5-5'), /must be one of: haiku, sonnet, opus, inherit/);
  assert.throws(() => load('haiku\ntools: Bash'), /must be one of/);
  assert.throws(() => load(''), /must be one of/);
});

test('scout: the prompt demands evidence for locations and for absences', () => {
  const render = require('../lib/render');
  const config = { stack: ['react'], tracker: { provider: 'none' } };
  const text = render.renderTargets({ config, presetsDir: 'presets' }).targets.find((t) => t[0] === '.claude/agents/code-scout.md')[1];
  assert.ok(/Cite only what you saw/.test(text));
  assert.ok(/at least two different terms/.test(text));
  assert.ok(/tried: <term>/.test(text));
});

// ------------------------------------------------------------------- epics

const epics = require('../lib/tracker/epics');

test('epics: public refs parse; internal keys and junk do not', () => {
  assert.deepStrictEqual(epics.parseRef('CI-E1'), { kind: 'epic', project: 'CI', epic: 1 });
  assert.deepStrictEqual(epics.parseRef('ci-e12'), { kind: 'epic', project: 'CI', epic: 12 });
  assert.deepStrictEqual(epics.parseRef('CI-1-4'), { kind: 'story', project: 'CI', epic: 1, story: 4 });
  assert.strictEqual(epics.parseRef('CI-79'), null);
  assert.strictEqual(epics.parseRef('none'), null);
  assert.strictEqual(epics.parseRef(undefined), null);
});

test('epics: only well-formed ref- labels count as a public ref', () => {
  assert.strictEqual(epics.refFromLabels(['bug', 'ref-needed', 'ref-CI-1-4']), 'CI-1-4');
  assert.strictEqual(epics.refFromLabels(['ref-needed']), null);
  assert.strictEqual(epics.refFromLabels(), null);
});

// An in-memory tracker with just the primitives epics.js uses.
function fakeTracker(issues) {
  const byKey = new Map(issues.map((i) => [i.key, { labels: [], status: 'To Do', epic: null, ...i }]));
  return {
    name: 'fake',
    projectKey: 'CI',
    byKey,
    async get(key) { return byKey.get(key); },
    async addLabel(key, label) { byKey.get(key).labels.push(label); },
    async listEpics() { return [...byKey.values()].filter((i) => i.isEpic); },
    async epicChildren(epic) { return [...byKey.values()].filter((i) => i.epic === epic); },
    async findByLabel(label) {
      const hit = [...byKey.values()].find((i) => i.labels.includes(label));
      return hit ? hit.key : null;
    },
    async closeIssue(key, status) { byKey.get(key).status = status; return { key, results: [{ key, to: status, ok: true }], failed: 0 }; },
    async setStatus(key, status) { byKey.get(key).status = status; return { key, to: status, changed: true }; },
  };
}

atest('epics: epic refs number per project, stories number per epic, refs never change', async () => {
  const t = fakeTracker([
    { key: 'CI-10', isEpic: true },
    { key: 'CI-11', isEpic: true },
    { key: 'CI-20', epic: 'CI-10' },
    { key: 'CI-21', epic: 'CI-10' },
    { key: 'CI-22', epic: 'CI-11' },
  ]);
  assert.strictEqual(await epics.assignEpicRef(t, 'CI-10'), 'CI-E1');
  assert.strictEqual(await epics.assignEpicRef(t, 'CI-11'), 'CI-E2');
  assert.strictEqual(await epics.assignEpicRef(t, 'CI-10'), 'CI-E1', 'second call keeps the ref');
  assert.strictEqual(await epics.assignStoryRef(t, 'CI-20', 'CI-10'), 'CI-1-1');
  assert.strictEqual(await epics.assignStoryRef(t, 'CI-21', 'CI-10'), 'CI-1-2');
  assert.strictEqual(await epics.assignStoryRef(t, 'CI-22', 'CI-11'), 'CI-2-1');
  t.byKey.get('CI-20').epic = 'CI-11'; // moved: keeps CI-1-1
  assert.strictEqual(await epics.assignStoryRef(t, 'CI-20', 'CI-11'), 'CI-1-1');
});

atest('epics: a story under an epic with no public ref gets none', async () => {
  const t = fakeTracker([{ key: 'CI-10', isEpic: true }, { key: 'CI-20', epic: 'CI-10' }]);
  assert.strictEqual(await epics.assignStoryRef(t, 'CI-20', 'CI-10'), null);
  assert.deepStrictEqual(t.byKey.get('CI-20').labels, []);
});

atest('epics: resolveKey maps public refs to tracker keys and leaves internal keys alone', async () => {
  const t = fakeTracker([{ key: 'CI-79', labels: ['ref-CI-1-4'] }]);
  assert.strictEqual(await epics.resolveKey(t, 'CI-1-4'), 'CI-79');
  assert.strictEqual(await epics.resolveKey(t, 'CI-79'), 'CI-79');
  await assert.rejects(() => epics.resolveKey(t, 'CI-9-9'), /No issue has public ref CI-9-9/);
});

test('epics: step refs parse as <story ref>.<n>', () => {
  assert.deepStrictEqual(epics.parseRef('CI-1-4.2'), { kind: 'step', project: 'CI', epic: 1, story: 4, step: 2 });
  assert.strictEqual(epics.refFromLabels(['ref-CI-1-4.2']), 'CI-1-4.2');
});

atest('epics: step 2 of story 4 in epic 1 resolves, and step 1 is the story itself', async () => {
  const t = fakeTracker([
    { key: 'CI-79', labels: ['ref-CI-1-4'] },
    { key: 'CI-90', labels: ['ref-CI-1-4.2'] },
  ]);
  assert.strictEqual(await epics.resolveKey(t, 'CI-1-4.2'), 'CI-90');
  assert.strictEqual(await epics.resolveKey(t, 'CI-1-4.1'), 'CI-79');
});

atest('epics: a new step takes the next free number from 2, or the one asked for', async () => {
  const t = fakeTracker([
    { key: 'CI-79', labels: ['ref-CI-1-4'] },
    { key: 'CI-90', parent: 'CI-79' },
    { key: 'CI-91', parent: 'CI-79' },
    { key: 'CI-92', parent: 'CI-79' },
  ]);
  t.subtaskList = async (p) => [...t.byKey.values()].filter((i) => i.parent === p);
  assert.strictEqual(await epics.assignStepRef(t, 'CI-90', 'CI-79'), 'CI-1-4.2');
  assert.strictEqual(await epics.assignStepRef(t, 'CI-91', 'CI-79'), 'CI-1-4.3');
  assert.strictEqual(await epics.assignStepRef(t, 'CI-92', 'CI-79', 5), 'CI-1-4.5');
  t.byKey.set('CI-93', { key: 'CI-93', parent: 'CI-79', labels: [] });
  await assert.rejects(() => epics.assignStepRef(t, 'CI-93', 'CI-79', 3), /already taken/);
  await assert.rejects(() => epics.assignStepRef(t, 'CI-93', 'CI-79', 1), /from 2/);
});

atest('epics: a step under a story with no public ref gets none', async () => {
  const t = fakeTracker([{ key: 'CI-79' }, { key: 'CI-90', parent: 'CI-79' }]);
  t.subtaskList = async () => [];
  assert.strictEqual(await epics.assignStepRef(t, 'CI-90', 'CI-79'), null);
});

test('epics: findDuplicateRefs reports a ref carried twice', () => {
  const dupes = epics.findDuplicateRefs([
    { key: 'CI-1', labels: ['ref-CI-E1'] },
    { key: 'CI-2', labels: ['ref-CI-E1'] },
    { key: 'CI-3', labels: ['ref-CI-E2'] },
  ]);
  assert.deepStrictEqual(dupes, [{ ref: 'CI-E1', keys: ['CI-1', 'CI-2'] }]);
});

atest('epics: closeEpic refuses over open stories, --force cascades', async () => {
  const mk = () => fakeTracker([
    { key: 'CI-10', isEpic: true },
    { key: 'CI-20', epic: 'CI-10', status: 'Done' },
    { key: 'CI-21', epic: 'CI-10', status: 'In Progress' },
  ]);
  const t = mk();
  const refused = await epics.closeEpic(t, 'CI-10', 'Done');
  assert.deepStrictEqual(refused.blocked, ['CI-21']);
  assert.strictEqual(t.byKey.get('CI-10').status, 'To Do');
  const forced = await epics.closeEpic(mk(), 'CI-10', 'Done', { force: true });
  assert.deepStrictEqual(forced.blocked, []);
  assert.strictEqual(forced.failed, 0);
});

atest('epics: jira makes no extra request unless an epic is involved', async () => {
  const env = { JIRA_BASE_URL: 'https://j.example', JIRA_USER: 'u', JIRA_PASSWORD: 'p' };
  await withFetch({ '/rest/api/2/issue': { key: 'TEST-1' } }, async (calls) => {
    await createJiraServer({ projectKey: 'TEST' }, env).createIssue({ summary: 's' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(Object.keys(calls[0].body.fields).some((f) => f.startsWith('customfield')), false);
  });
});

atest('epics: jira looks up Epic Link once and links the story on create', async () => {
  const env = { JIRA_BASE_URL: 'https://j.example', JIRA_USER: 'u', JIRA_PASSWORD: 'p' };
  const fields = [{ id: 'customfield_10008', name: 'Epic Link' }];
  await withFetch({ '/rest/api/2/field': fields, '/rest/api/2/issue': { key: 'TEST-2' } }, async (calls) => {
    const j = createJiraServer({ projectKey: 'TEST' }, env);
    await j.createIssue({ summary: 's', epicKey: 'TEST-1' });
    await j.createIssue({ summary: 's', epicKey: 'TEST-1' });
    assert.strictEqual(calls.filter((c) => c.url === '/rest/api/2/field').length, 1);
    assert.strictEqual(calls.find((c) => c.method === 'POST').body.fields.customfield_10008, 'TEST-1');
  });
});

atest('epics: jira without an Epic Link field says so instead of guessing', async () => {
  const env = { JIRA_BASE_URL: 'https://j.example', JIRA_USER: 'u', JIRA_PASSWORD: 'p' };
  await withFetch({ '/rest/api/2/field': [] }, async () => {
    await assert.rejects(
      () => createJiraServer({ projectKey: 'TEST' }, env).setEpic('TEST-2', 'TEST-1'),
      /no "Epic Link" field/,
    );
  });
});

atest('epics: none provider treats every epic operation as a no-op', async () => {
  const t = createNone();
  assert.strictEqual(await t.createEpic({ summary: 'x' }), null);
  assert.deepStrictEqual(await t.epicChildren('X-1'), []);
  assert.strictEqual((await t.setEpic('X-1', 'X-2')).skipped, true);
});

atest('epics: youtrack get reports an epic parent only when the parent is an Epic', async () => {
  const link = (type) => [{
    direction: 'INWARD',
    linkType: { name: 'Subtask' },
    issues: [{ idReadable: 'CI-1', customFields: [{ name: 'Type', value: { name: type } }] }],
  }];
  for (const [type, epic] of [['Epic', 'CI-1'], ['Task', null]]) {
    await withFetch(
      { '/api/issues/CI-2/links': link(type), '/api/issues/CI-2': { idReadable: 'CI-2', summary: 's', customFields: [], tags: [{ name: 'ref-CI-1-4' }] } },
      async () => {
        const issue = await createYouTrack({}, ytEnv).get('CI-2');
        assert.strictEqual(issue.parent, 'CI-1');
        assert.strictEqual(issue.epic, epic);
        assert.deepStrictEqual(issue.labels, ['ref-CI-1-4']);
      },
    );
  }
});

test('render: request-change exists only with both a workspace and a remote tracker', () => {
  const render = require('../lib/render');
  const root = workspaceFixture(
    { repos: [{ name: 'backend', path: 'backend' }, { name: 'frontend', path: 'frontend' }] },
    { backend: { stack: ['nestjs'] }, frontend: { stack: ['react'] } },
  );
  const repoPath = path.join(root, 'frontend');
  const rels = (config, rp) =>
    render.renderTargets({ config, presetsDir: 'presets', repoPath: rp }).targets.map((t) => t[0]);
  const yt = { stack: ['react'], tracker: { provider: 'youtrack', projectKey: 'CI' } };
  const none = { stack: ['react'], tracker: { provider: 'none' } };

  assert.ok(rels(yt, repoPath).includes('.claude/commands/request-change.md'));
  assert.ok(!rels(none, repoPath).includes('.claude/commands/request-change.md'), 'no tracker');
  assert.ok(!rels(yt, null).includes('.claude/commands/request-change.md'), 'no workspace');

  const cmd = render.renderTargets({ config: yt, presetsDir: 'presets', repoPath }).targets.find(
    (t) => t[0] === '.claude/commands/request-change.md',
  )[1];
  assert.ok(/^---\ndescription: .*YouTrack/.test(cmd), 'frontmatter, provider named');
  assert.ok(!/\{\{/.test(cmd), 'no unresolved template tags');
  assert.ok(cmd.includes('ReactArchitectAgent'));
});

test('render: the tracker gets a digest, not the description file', () => {
  const render = require('../lib/render');
  const root = workspaceFixture(
    { repos: [{ name: 'backend', path: 'backend' }, { name: 'frontend', path: 'frontend' }] },
    { backend: { stack: ['nestjs'] }, frontend: { stack: ['react'] } },
  );
  const yt = { stack: ['react'], tracker: { provider: 'youtrack', projectKey: 'CI' } };
  const pick = (cfg, rp, rel) =>
    render.renderTargets({ config: cfg, presetsDir: 'presets', repoPath: rp }).targets.find((t) => t[0] === rel)[1];

  const wf = pick(yt, null, 'ai/WORKFLOW.md');
  assert.ok(/### What goes to the tracker/.test(wf));
  assert.ok(/under about 600 characters/.test(wf));
  assert.ok(!/← the enriched description[;\s|]/.test(wf), 'no longer says to paste the enriched description');
  assert.ok(!/Exception: `\/request-change`/.test(wf), 'request exception only inside a workspace');
  assert.ok(/Exception: `\/request-change`/.test(pick(yt, path.join(root, 'frontend'), 'ai/WORKFLOW.md')));

  const arch = pick(yt, null, 'ai/agents/architect.md');
  assert.ok(/never the description file itself/.test(arch));

  const none = pick({ stack: ['react'], tracker: { provider: 'none' } }, null, 'ai/WORKFLOW.md');
  assert.ok(!/What goes to the tracker/.test(none));
});

test('render: step 1 is the parent issue, children start at step 2', () => {
  const render = require('../lib/render');
  const yt = { stack: ['react'], tracker: { provider: 'youtrack', projectKey: 'CI' } };
  const pick = (rel) =>
    render.renderTargets({ config: yt, presetsDir: 'presets', repoPath: null }).targets.find((t) => t[0] === rel)[1];

  const wf = pick('ai/WORKFLOW.md');
  assert.ok(/Step 1 is the parent issue itself/.test(wf));
  assert.ok(/marker equal to the folder key/.test(wf));
  assert.ok(/step 1: create the parent issue if new and use it as the step's issue, no child/.test(wf));
  assert.ok(!/always create the child issue/.test(wf), 'no unconditional child per step');

  const arch = pick('ai/agents/architect.md');
  assert.ok(/create no child for it/.test(arch));
  assert.ok(/Step 2\+: create a\s+child issue/.test(arch));
});

// ------------------------------------------------------------------ presets

test('presets: listPresets reads every folder but core, with kind and what it ships', () => {
  const { listPresets } = require('../lib/presets');
  const all = listPresets();
  const names = all.map((p) => p.name);
  assert.ok(!names.includes('core'), 'core is applied to everyone, not a choice');
  for (const n of ['nestjs', 'react', 'typeorm', 'tailwind', 'spring', 'jpa-flyway', 'css-modules', 'docker']) assert.ok(names.includes(n), n);
  const nest = all.find((p) => p.name === 'nestjs');
  assert.strictEqual(nest.kind, 'framework');
  assert.ok(nest.ships.includes('slots'));
  assert.strictEqual(all.find((p) => p.name === 'tailwind').kind, 'styling');
  assert.ok(all.every((p) => p.kind !== 'other'), 'every bundled preset carries a preset.json');
});

test('presets: a folder without preset.json is still listed, as kind "other"', () => {
  const { listPresets } = require('../lib/presets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-presets-'));
  fs.mkdirSync(path.join(dir, 'svelte', 'slots'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'core'));
  assert.deepStrictEqual(listPresets(dir), [{ name: 'svelte', kind: 'other', description: '', ships: ['slots'] }]);
});

test('presets: validateStack accepts real presets and the deliberate preset-less names', () => {
  const { validateStack } = require('../lib/presets');
  assert.deepStrictEqual(validateStack(['nestjs', 'typeorm']), { errors: [], warnings: [] });
  assert.deepStrictEqual(validateStack(['cli']), { errors: [], warnings: [] });
  assert.deepStrictEqual(validateStack(['unknown']), { errors: [], warnings: [] });
});

test('presets: a likely typo warns with a suggestion, an unrelated name warns without one', () => {
  const { validateStack } = require('../lib/presets');
  const typo = validateStack(['react', 'tailwnd']);
  assert.strictEqual(typo.errors.length, 0, 'a warning must not block');
  assert.ok(/no preset "tailwnd".*did you mean "tailwind"\?/.test(typo.warnings[0]));
  const other = validateStack(['zzzzzz']);
  assert.ok(/no preset "zzzzzz"/.test(other.warnings[0]) && !/did you mean/.test(other.warnings[0]));
});

test('presets: core as an entry and a repeated name are errors', () => {
  const { validateStack } = require('../lib/presets');
  assert.ok(/always applied/.test(validateStack(['core', 'react']).errors[0]));
  assert.ok(/more than once/.test(validateStack(['react', 'react']).errors[0]));
});

test('presets: checkStack prints warnings but only errors return false', () => {
  const { checkStack } = require('../lib/presets');
  const lines = [];
  const err = (l) => lines.push(l);
  assert.strictEqual(checkStack(['react', 'tailwnd'], { err }), true);
  assert.ok(lines[0].startsWith('warning: stack:'));
  lines.length = 0;
  assert.strictEqual(checkStack(['react', 'react'], { err }), false);
  assert.ok(lines[0].startsWith('error: stack:'));
});

test('presets: init and render refuse a stack that lists a name twice', () => {
  const { main: init } = require('../lib/init');
  const dir = tmpRepo();
  const errs = [];
  const orig = console.error;
  console.error = (l) => errs.push(l);
  try {
    assert.strictEqual(init(['--repo', dir, '--stack', 'react,react', '--tracker', 'none', '--no-color']), 2);
  } finally {
    console.error = orig;
  }
  assert.ok(errs.some((l) => /more than once/.test(l)));
  assert.ok(!fs.existsSync(path.join(dir, 'cairn.config.json')), 'nothing written on refusal');

  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'cairn.config.json'), JSON.stringify({ stack: ['react', 'react'], tracker: { provider: 'none' } }));
  console.error = () => {};
  try {
    assert.strictEqual(require('../lib/render/cli').main(['--repo', repo]), 2);
  } finally {
    console.error = orig;
  }
  assert.ok(!fs.existsSync(path.join(repo, 'ai')), 'render wrote nothing');
});

test('preset cli: list marks the primary and add-on presets of the repo, --json is structured', () => {
  const { main } = require('../lib/preset/cli');
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'cairn.config.json'),
    JSON.stringify({ stack: ['nestjs', 'typeorm', 'cli'], tracker: { provider: 'none' } }),
  );
  const out = [];
  const log = console.log;
  console.log = (l) => out.push(l);
  try {
    assert.strictEqual(main(['list', '--repo', dir, '--json']), 0);
    const parsed = JSON.parse(out.pop());
    assert.deepStrictEqual(parsed.stack, ['nestjs', 'typeorm', 'cli']);
    const byName = Object.fromEntries(parsed.presets.map((p) => [p.name, p.inUse]));
    assert.strictEqual(byName.nestjs, 'primary');
    assert.strictEqual(byName.typeorm, 'add-on');
    assert.strictEqual(byName.react, null);

    assert.strictEqual(main(['list', '--repo', dir, '--no-color']), 0);
    const text = out.join(String.fromCharCode(10));
    assert.ok(/nestjs.*primary/.test(text));
    assert.ok(/cli \(core only, deliberate\)/.test(text));
  } finally {
    console.log = log;
  }
});

test('preset cli: list works outside a repo, and an unknown subcommand exits 2', () => {
  const { main } = require('../lib/preset/cli');
  const out = [];
  const log = console.log;
  const errLog = console.error;
  const stderr = process.stderr.write;
  console.log = (l) => out.push(l);
  console.error = () => {};
  process.stderr.write = () => true;
  const cwd = process.cwd();
  process.chdir(os.tmpdir());
  try {
    assert.strictEqual(main(['list', '--no-color']), 0);
    assert.ok(!/In use/.test(out.join(String.fromCharCode(10))), 'no repo, no "In use" column');
    assert.strictEqual(main(['add', 'react']), 2);
  } finally {
    process.chdir(cwd);
    console.log = log;
    console.error = errLog;
    process.stderr.write = stderr;
  }
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

test('doctor: a workspace config with no `shared` list is analysed, not a crash', () => {
  const { resolveRepos, analyze } = require('../lib/doctor');
  const root = tmpRepo();
  fs.mkdirSync(path.join(root, 'a'), { recursive: true });
  const workspace = { repos: [{ name: 'a', path: path.join(root, 'a'), stack: 's' }] };
  assert.deepStrictEqual(analyze(resolveRepos(workspace, root), workspace, {}), []);
});

test('doctor: a malformed workspace config is a one-line error (exit 2), not a stack trace', () => {
  const root = tmpRepo();
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const run = (cfg, args) => {
    fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify(cfg));
    return require('child_process').spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
  };
  for (const [cfg, args, re] of [
    [{}, ['doctor'], /needs a "repos" array/],
    [{ repos: {} }, ['upgrade'], /needs a "repos" array/],
    [{}, ['context', 'check'], /needs a "repos" array/],
    [{ repos: [], shared: [{ cohort: 'all' }] }, ['doctor'], /"shared\[0\]\.glob" is required/],
  ]) {
    const r = run(cfg, args);
    assert.strictEqual(r.status, 2, args.join(' '));
    assert.match(r.stderr, re);
    assert.ok(!/^\s+at .*:\d+/m.test(r.stderr), 'no stack trace');
  }
});

// ------------------------------------------------------------ malformed JSON, every reader
// Every JSON file a user writes is read through lib/json.js: the file, the problem, exit 2.

test('json: readJsonFile names the file and the problem for empty, malformed, unreadable input', () => {
  const { readJsonFile } = require('../lib/json');
  const { UserError } = require('../lib/errors');
  const dir = tmpRepo();
  const f = (name, text) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, text);
    return p;
  };
  assert.throws(() => readJsonFile(f('e.json', '')), (e) => e instanceof UserError && /e\.json: the file is empty/.test(e.message));
  assert.throws(() => readJsonFile(f('w.json', '  \n')), /the file is empty/);
  assert.throws(() => readJsonFile(f('b.json', '{"a":')), (e) => e instanceof UserError && /b\.json: invalid JSON/.test(e.message));
  assert.throws(() => readJsonFile(dir), (e) => e instanceof UserError && /cannot read it/.test(e.message));
  assert.throws(() => readJsonFile(path.join(dir, 'missing.json')), /cannot read it — ENOENT/);
  assert.strictEqual(readJsonFile(path.join(dir, 'missing.json'), { optional: true }), undefined);
  assert.deepStrictEqual(readJsonFile(f('bom.json', '﻿{"a":1}')), { a: 1 });
});

test('workspace config: a wrong shape is reported by key', () => {
  const { validateWorkspace } = require('../lib/workspace-config');
  const ok = { repos: [{ name: 'a', path: './a' }] };
  assert.strictEqual(validateWorkspace(ok, 'r.json'), ok);
  assert.doesNotThrow(() => validateWorkspace({ repos: [] }, 'r.json'));
  const cases = [
    [null, /must be an object/],
    [[], /must be an object/],
    [{}, /needs a "repos" array/],
    [{ repos: {} }, /needs a "repos" array/],
    [{ repos: [null] }, /"repos\[0\]" must be an object/],
    [{ repos: [{ path: './a' }] }, /"repos\[0\]\.name" is required/],
    [{ repos: [{ name: 'a' }] }, /"repos\[0\]\.path" is required/],
    [{ repos: [{ name: 5, path: './a' }] }, /"repos\[0\]\.name" must be a non-empty string/],
    [{ repos: [{ name: 'a', path: '' }] }, /"repos\[0\]\.path" must be a non-empty string/],
    [{ repos: [{ name: 'a', path: './a', stack: 3 }] }, /"repos\[0\]\.stack" must be a string or an array/],
    [{ repos: [{ name: 'a', path: './a', vars: [] }] }, /"repos\[0\]\.vars" must be an object/],
    [{ repos: [{ name: 'a', path: './a', pathAliases: { x: 1 } }] }, /pathAliases\["x"\]" must be a non-empty string/],
    [{ repos: [{ name: 'a', path: './a' }, { name: 'a', path: './b' }] }, /duplicates another repo called "a"/],
    [{ repos: [], shared: {} }, /"shared" must be an array/],
    [{ repos: [], shared: [{ cohort: 'all' }] }, /"shared\[0\]\.glob" is required/],
    [{ repos: [], shared: [{ glob: 'x', cohort: 'some' }] }, /"shared\[0\]\.cohort" must be one of: all, stack/],
    [{ repos: [], normalize: [] }, /"normalize" must be an object/],
    [{ repos: [], codeSource: 'serena' }, /"codeSource" must be an object/],
  ];
  for (const [cfg, re] of cases) assert.throws(() => validateWorkspace(cfg, 'r.json'), re, JSON.stringify(cfg));
});

test('repo config: a wrong type is a ConfigError naming the key, not a later crash', () => {
  const { loadRepoConfig, ConfigError } = require('../lib/config');
  const dir = tmpRepo();
  const load = (cfg) => {
    fs.writeFileSync(path.join(dir, 'cairn.config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
    return loadRepoConfig(dir);
  };
  assert.throws(() => load('{"stack":'), (e) => e instanceof ConfigError && /invalid JSON/.test(e.message));
  assert.throws(() => load(''), /the file is empty/);
  assert.throws(() => load('null'), /must be a JSON object/);
  assert.throws(() => load('[]'), /must be a JSON object/);
  for (const [cfg, re] of [
    [{ stack: 5 }, /"stack" must be a string or an array/],
    [{ stack: [1] }, /"stack" must be a string or an array/],
    [{ tdd: 'yes' }, /"tdd" must be true or false/],
    [{ tracker: [] }, /"tracker" must be an object/],
    [{ tracker: { provider: 3 } }, /"tracker\.provider" must be a non-empty string/],
    [{ tracker: { statuses: [] } }, /"tracker\.statuses" must be an object/],
    [{ agents: { architect: 'x' } }, /"agents\.architect" must be an object/],
    [{ agents: { architect: { name: 1 } } }, /"agents\.architect\.name" must be a non-empty string/],
    [{ commands: { build: 4 } }, /"commands\.build" must be a non-empty string/],
    [{ vars: 'x' }, /"vars" must be an object/],
    [{ workflow: {} }, /"workflow\.steps" is required/],
    [{ workflow: { steps: [{ command: 'x' }] } }, /"workflow\.steps\[0\]\.role" is required/],
    [{ workflow: { steps: [null] } }, /"workflow\.steps\[0\]" must be an object/],
  ]) assert.throws(() => load(cfg), (e) => e instanceof ConfigError && re.test(e.message), JSON.stringify(cfg));
  assert.doesNotThrow(() => load({ stack: ['nestjs'], tdd: true, tracker: { provider: 'none', envPrefix: '' } }));
});

test('manifest and package.json: unreadable or mis-typed files are errors, a missing one is not', () => {
  const { readManifest } = require('../lib/manifest');
  const { UserError } = require('../lib/errors');
  const versions = require('../lib/doctor/versions');
  const dir = tmpRepo();
  assert.strictEqual(readManifest(dir), null, 'no manifest is normal');
  fs.mkdirSync(path.join(dir, '_cairn'), { recursive: true });
  const mf = path.join(dir, '_cairn', 'manifest.json');
  for (const [text, re] of [
    ['', /the file is empty/],
    ['{', /invalid JSON/],
    ['[]', /must be a JSON object/],
    ['{"files":[]}', /"files" must be an object/],
    ['{"files":{"a.md":3}}', /files\["a\.md"\]" must be an object/],
  ]) {
    fs.writeFileSync(mf, text);
    assert.throws(() => readManifest(dir), (e) => e instanceof UserError && re.test(e.message), text);
  }
  fs.writeFileSync(mf, '{}');
  assert.deepStrictEqual(readManifest(dir).files, {});

  assert.strictEqual(versions.pinnedCairn(dir), null, 'no package.json is normal (not every repo is Node)');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"devDependencies":');
  assert.throws(() => versions.pinnedCairn(dir), (e) => e instanceof UserError && /package\.json: invalid JSON/.test(e.message));
  fs.writeFileSync(path.join(dir, 'package.json'), '[]');
  assert.throws(() => versions.pinnedCairn(dir), /must be a JSON object/);
});

test('cli: every command that reads repos.json reports a malformed one in one line, exit 2', () => {
  const root = tmpRepo();
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const spawn = (args) => require('child_process').spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
  const noStack = (text) => !/^\s+at .+:\d+:\d+\)?$/m.test(text);
  for (const [text, re] of [
    ['{"repos":', /invalid JSON/],
    ['', /the file is empty/],
    ['null', /must be an object/],
    ['{"repos":[{"name":"a"}]}', /"repos\[0\]\.path" is required/],
  ]) {
    fs.writeFileSync(path.join(root, 'repos.json'), text);
    for (const args of [['doctor'], ['doctor', '--json'], ['upgrade'], ['context', 'check'], ['context', 'build'], ['workspace', 'list'], ['workspace', 'remove', 'a']]) {
      const r = spawn(args);
      assert.strictEqual(r.status, 2, `${args.join(' ')} on ${JSON.stringify(text)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re, args.join(' '));
      assert.ok(noStack(r.stderr), `no stack trace from ${args.join(' ')}`);
    }
  }
});

test('cli: a malformed cairn.config.json or manifest stops render / sync / doctor with one line', () => {
  const root = tmpRepo();
  const repo = path.join(root, 'a');
  fs.mkdirSync(repo, { recursive: true });
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const spawn = (cwd, args) => require('child_process').spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(spawn(repo, ['init', '--stack', 'nestjs', '--tracker', 'none']).status, 0);
  assert.strictEqual(spawn(repo, ['render']).status, 0);
  fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify({ repos: [{ name: 'a', path: './a' }] }));
  const noStack = (text) => !/^\s+at .+:\d+:\d+\)?$/m.test(text);

  const cfg = path.join(repo, 'cairn.config.json');
  const good = fs.readFileSync(cfg, 'utf8');
  for (const bad of ['{', '', '[]', '{"tdd":"yes"}']) {
    fs.writeFileSync(cfg, bad);
    for (const [cwd, args] of [[repo, ['render', '--dry-run']], [repo, ['sync', '--dry-run']], [repo, ['override', 'status']], [repo, ['preset', 'list']], [root, ['doctor']]]) {
      const r = spawn(cwd, args);
      assert.ok(noStack(r.stdout + r.stderr), `${args.join(' ')} with config ${JSON.stringify(bad)}:\n${r.stdout}${r.stderr}`);
      assert.notStrictEqual(r.status, 0, `${args.join(' ')} accepted config ${JSON.stringify(bad)}`);
    }
  }
  fs.writeFileSync(cfg, good);

  const mf = path.join(repo, '_cairn', 'manifest.json');
  const goodManifest = fs.readFileSync(mf, 'utf8');
  for (const bad of ['{', '', '[]', '{"files":[]}']) {
    fs.writeFileSync(mf, bad);
    for (const [cwd, args] of [[repo, ['sync', '--dry-run']], [repo, ['render', '--dry-run']], [root, ['doctor']]]) {
      const r = spawn(cwd, args);
      assert.ok(noStack(r.stdout + r.stderr), `${args.join(' ')} with manifest ${JSON.stringify(bad)}:\n${r.stdout}${r.stderr}`);
      assert.notStrictEqual(r.status, 0, `${args.join(' ')} accepted manifest ${JSON.stringify(bad)}`);
    }
  }
  fs.writeFileSync(mf, goodManifest);
});

test('cli: upgrade and doctor exit 2 when a repo file cannot be read, even without --strict', () => {
  const root = tmpRepo();
  const repo = path.join(root, 'a');
  fs.mkdirSync(repo, { recursive: true });
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const spawn = (cwd, args) => require('child_process').spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(spawn(repo, ['init', '--stack', 'nestjs', '--tracker', 'none']).status, 0);
  assert.strictEqual(spawn(repo, ['render']).status, 0);
  fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify({ repos: [{ name: 'a', path: './a' }] }));
  assert.strictEqual(spawn(root, ['upgrade']).status, 0, 'a clean workspace is exit 0');
  fs.writeFileSync(path.join(repo, '_cairn', 'manifest.json'), '{');
  for (const args of [['upgrade'], ['doctor']]) {
    const r = spawn(root, args);
    assert.strictEqual(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /invalid JSON/);
  }
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
  const code = main(['--repo', dir, '--stack', 'nestjs', '--tracker', 'jira-server', '--project-key', 'PROOF', '--story-type', 'Task', '--no-color']);
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
  const code = main(['--repo', dir, '--stack', 'nestjs', '--tracker', 'youtrack', '--project-key', 'PROOF', '--no-color']);
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

atest('render: archive-tasks is universal; tracker-status/assign only render with a remote tracker, named after it', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    const remote = tmpRepo();
    init(['--repo', remote, '--stack', 'nestjs', '--tracker', 'youtrack', '--project-key', 'CI', '--render', '--no-color']);
    assert.ok(fs.existsSync(path.join(remote, '.claude/commands/archive-tasks.md')), 'archive-tasks renders with a remote tracker');
    assert.ok(fs.existsSync(path.join(remote, '.claude/commands/youtrack-status.md')), 'named after the tracker slug');
    assert.ok(fs.existsSync(path.join(remote, '.claude/commands/youtrack-assign.md')));
    const status = fs.readFileSync(path.join(remote, '.claude/commands/youtrack-status.md'), 'utf8');
    assert.match(status, /set-status/);
    assert.match(status, /npx cairn tracker close \[key\]/, 'points at the real `close` subcommand, not the old close-task alias');
    assert.doesNotMatch(status, /close-task/, 'close-task is not a real cairn tracker subcommand');
    assert.match(status, /npx cairn tracker/, 'leads with the always-resolvable npx path, not a maybe-missing ai/scripts/ shim');
    assert.match(status, /not guaranteed to exist/, 'warns that the legacy ai/scripts/ shim may not be present (a greenfield repo has none)');

    const none = tmpRepo();
    init(['--repo', none, '--stack', 'react', '--tracker', 'none', '--render', '--no-color']);
    assert.ok(fs.existsSync(path.join(none, '.claude/commands/archive-tasks.md')), 'archive-tasks renders with no tracker too');
    assert.ok(!fs.existsSync(path.join(none, '.claude/commands/tracker-status.md')));
    assert.ok(!fs.existsSync(path.join(none, '.claude/commands/tracker-assign.md')));
  } finally {
    console.log = log;
  }
});

atest('render: /fix-review renders for every config and the reviewer hands off to it in R.6', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    for (const [stack, tracker] of [['nestjs', 'youtrack'], ['react', 'none']]) {
      const dir = tmpRepo();
      init(['--repo', dir, '--stack', stack, '--tracker', tracker, '--project-key', 'CI', '--render', '--no-color']);
      const cmd = fs.readFileSync(path.join(dir, '.claude/commands/fix-review.md'), 'utf8');
      assert.ok(cmd.startsWith('---\ndescription:'), 'frontmatter on line 1 for the picker');
      assert.match(cmd, /--replan/);
      assert.match(cmd, /One round only/);
      assert.doesNotMatch(cmd, /\{\{/, 'no unrendered template tags');
      const reviewer = fs.readFileSync(path.join(dir, 'ai/agents/reviewer.md'), 'utf8');
      assert.match(reviewer, /### R\.6 — Offer the next step/);
      assert.match(reviewer, /`fix-review`/);
      assert.match(fs.readFileSync(path.join(dir, 'ai/AGENTS.md'), 'utf8'), /\/fix-review/);
    }
  } finally {
    console.log = log;
  }
});

atest('render: /discover and the discovery agent render for every stack; the stack slots say what to look for', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    const nest = tmpRepo();
    init(['--repo', nest, '--stack', 'nestjs,typeorm', '--tracker', 'none', '--render', '--no-color']);
    const cmd = fs.readFileSync(path.join(nest, '.claude/commands/discover.md'), 'utf8');
    assert.ok(cmd.startsWith('---'), 'starts with frontmatter');
    assert.match(cmd, /description: /, 'has a picker description');
    assert.match(cmd, /NestjsDiscoveryAgent/);
    const doc = fs.readFileSync(path.join(nest, 'ai/agents/discovery.md'), 'utf8');
    assert.match(doc, /@Entity\(\)/, 'typeorm slot filled');
    assert.match(doc, /Nest module/, 'nestjs slot filled');
    assert.match(doc, /Idempotent/);
    assert.doesNotMatch(doc, /\{\{/, 'no unrendered template syntax');
    assert.match(fs.readFileSync(path.join(nest, 'ai/AGENTS.md'), 'utf8'), /\/discover \[area\]/);

    // A stack with no discover-targets slot still renders, with that list empty.
    const tw = tmpRepo();
    init(['--repo', tw, '--stack', 'tailwind', '--tracker', 'none', '--render', '--no-color']);
    assert.ok(fs.existsSync(path.join(tw, '.claude/commands/discover.md')));
    assert.ok(fs.existsSync(path.join(tw, 'ai/agents/discovery.md')));
  } finally {
    console.log = log;
  }
});

atest('init: --validation-stack picks the nestjs validation library; rejects an unknown one', async () => {
  const { main: init, VALIDATION_STACKS } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    assert.deepStrictEqual(VALIDATION_STACKS, ['zod', 'class-validator']);

    const cv = tmpRepo();
    init(['--repo', cv, '--stack', 'nestjs', '--validation-stack', 'class-validator', '--render', '--no-color']);
    const cvCfg = JSON.parse(fs.readFileSync(path.join(cv, 'cairn.config.json'), 'utf8'));
    assert.strictEqual(cvCfg.validationStack, 'class-validator');
    const cvGuidelines = fs.readFileSync(path.join(cv, 'ai/infrastructure/code-guidelines.md'), 'utf8');
    assert.match(cvGuidelines, /class-validator|ResponseMapper/);
    assert.doesNotMatch(cvGuidelines, /createZodDto|nestjs-zod/);

    const dflt = tmpRepo();
    init(['--repo', dflt, '--stack', 'nestjs', '--render', '--no-color']);
    const dfltCfg = JSON.parse(fs.readFileSync(path.join(dflt, 'cairn.config.json'), 'utf8'));
    assert.strictEqual(dfltCfg.validationStack, 'zod', 'default with no flag is zod');

    const bad = tmpRepo();
    const err = console.error;
    let captured = '';
    console.error = (s) => { captured += s; };
    try {
      const exit = init(['--repo', bad, '--stack', 'nestjs', '--validation-stack', 'joi', '--no-color']);
      assert.strictEqual(exit, 2);
      assert.match(captured, /Unknown validation stack "joi"/);
    } finally {
      console.error = err;
    }
  } finally {
    console.log = log;
  }
});

atest('render: variant/validation-stack/<name> partials are isolated per choice, no cross-contamination', async () => {
  const render = require('../lib/render');
  const zod = render.renderTargets({ config: { stack: ['nestjs'], tracker: { provider: 'none' }, validationStack: 'zod' }, presetsDir: 'presets' });
  const cv = render.renderTargets({ config: { stack: ['nestjs'], tracker: { provider: 'none' }, validationStack: 'class-validator' }, presetsDir: 'presets' });
  const zodOut = zod.targets.find(([r]) => r === 'ai/infrastructure/code-guidelines.md')[1];
  const cvOut = cv.targets.find(([r]) => r === 'ai/infrastructure/code-guidelines.md')[1];
  assert.doesNotMatch(zodOut, /\{\{/, 'zod render has no unresolved tags');
  assert.doesNotMatch(cvOut, /\{\{/, 'class-validator render has no unresolved tags');
  assert.match(zodOut, /createZodDto/);
  assert.doesNotMatch(zodOut, /ResponseMapper/);
  assert.match(cvOut, /ResponseMapper/);
  assert.doesNotMatch(cvOut, /createZodDto/);
});

atest('render: nestjs code-guidelines.md validation slots resolve (were silently empty — {{> slot: x }} never matched the engine\'s {{> stack/x }} partial syntax)', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    const dir = tmpRepo();
    init(['--repo', dir, '--stack', 'nestjs', '--tracker', 'none', '--render', '--no-color']);
    const guidelines = fs.readFileSync(path.join(dir, 'ai/infrastructure/code-guidelines.md'), 'utf8');
    assert.doesNotMatch(guidelines, /\{\{[#>/]/, 'no unresolved template tags of any kind survive into the rendered file');
    for (const marker of ['Payload', 'createZodDto', 'ZodValidationPipe', 'ZodResponse', 'z.coerce.number']) {
      assert.match(guidelines, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${marker} present — the slot actually rendered content, not a gap`);
    }
  } finally {
    console.log = log;
  }
});

atest('render: architect.md Mode B re-opens review-step-N.md and amends rather than rewrites the plan', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    const dir = tmpRepo();
    init(['--repo', dir, '--stack', 'nestjs', '--tracker', 'youtrack', '--project-key', 'CI', '--render', '--no-color']);
    const architect = fs.readFileSync(path.join(dir, 'ai/agents/architect.md'), 'utf8');
    assert.match(architect, /check `ai\/tasks\/\[task\]\/review-step-\[step\]\.md`/, 'B.1 checks for a review file');
    assert.match(architect, /Blocking issues are required amendments/);
    assert.match(architect, /amend the existing plan file, don't rewrite it from scratch/, 'B.3 amends rather than overwriting');
    assert.match(architect, /Mark completed steps done/);
  } finally {
    console.log = log;
  }
});

atest('render: every command file has a description frontmatter block on line 1 for the picker', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  try {
    const dir = tmpRepo();
    init(['--repo', dir, '--stack', 'nestjs', '--tracker', 'youtrack', '--project-key', 'CI', '--render', '--no-color']);
    const commandsDir = path.join(dir, '.claude/commands');
    const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length >= 8, 'sanity: nestjs+youtrack renders at least the 5 workflow + 3 tracker/archive commands');
    for (const f of files) {
      const content = fs.readFileSync(path.join(commandsDir, f), 'utf8');
      assert.match(content, /^---\ndescription: \S.*\n/, `${f} starts with a description frontmatter block on line 1`);
      assert.doesNotMatch(content.split('\n')[1], /\*\*/, `${f}'s description has no leftover markdown bold`);
    }
  } finally {
    console.log = log;
  }
});

test('render: Codex skills reuse the enabled workflow and adapt code lookups', () => {
  const { renderTargets } = require('../lib/render');
  const config = { stack: ['nestjs'], tracker: { provider: 'youtrack', projectKey: 'CI' } };
  const targets = () => renderTargets({ config, presetsDir: 'presets' }).targets;
  const defaults = targets();
  assert.ok(!defaults.some(([rel]) => rel.startsWith('.agents/skills/')));
  config.codexSkills = true;
  const enabled = targets();
  assert.deepStrictEqual(enabled.slice(0, defaults.length), defaults);
  const skills = new Map(enabled.slice(defaults.length));
  const brief = skills.get('.agents/skills/create-brief/SKILL.md');
  assert.match(brief, /^---\nname: create-brief\ndescription: /);
  assert.match(brief, /ai\/agents\/architect\.md/);
  assert.match(brief, /code_references.*code_symbol/);
  assert.doesNotMatch(brief, /\$ARGUMENTS/);
  assert.ok(skills.has('.agents/skills/run-qa/SKILL.md'));
  assert.ok(skills.has('.agents/skills/youtrack-status/SKILL.md'));
});

atest('render: the QA pipeline is the core contract filled by the stack that ships qa-* slots', async () => {
  const { main: init } = require('../lib/init');
  const log = console.log;
  console.log = () => {};
  const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const QA_AGENTS = ['qa-architect.md', 'qa-developer.md', 'qa-orchestrator.md'];
  const QA_COMMANDS = ['plan-tests.md', 'execute-test-plan.md', 'run-qa.md'];
  try {
    const nest = tmpRepo();
    init(['--repo', nest, '--stack', 'nestjs', '--tracker', 'none', '--render', '--no-color']);
    for (const f of QA_AGENTS) assert.ok(fs.existsSync(path.join(nest, 'ai/agents', f)), `nestjs ships ${f}`);
    for (const f of QA_COMMANDS) assert.ok(fs.existsSync(path.join(nest, '.claude/commands', f)), `nestjs ships ${f}`);
    const nestPlanner = read(nest, 'ai/agents/qa-architect.md');
    assert.match(nestPlanner, /\*\*Sonnet\*\* is recommended/, '{{ model }} resolves the same as reviewer.md');
    assert.match(nestPlanner, /src\/feature\/\[target\]/, 'the nestjs target and plan format fill the slots');
    assert.match(read(nest, 'ai/agents/qa-developer.md'), /not a requirement\):\*\* Haiku/, 'the writer recommends Haiku as plain text');
    assert.match(read(nest, 'ai/agents/architect.md'), /conventions\.md/, 'the architect reads the test docs when the plan carries tests');

    const ng = tmpRepo();
    init(['--repo', ng, '--stack', 'angular', '--tracker', 'none', '--render', '--no-color']);
    for (const f of QA_AGENTS) assert.ok(fs.existsSync(path.join(ng, 'ai/agents', f)), `angular ships ${f} too`);
    assert.ok(!fs.existsSync(path.join(ng, 'ai/agents/qa.md')), 'the standalone qa.md is gone');
    const ngPlanner = read(ng, 'ai/agents/qa-architect.md');
    assert.match(ngPlanner, /data-testid/, 'the angular plan format fills the slots');
    assert.ok(!/src\/feature/.test(ngPlanner), 'no nestjs layout leaks into angular');
    assert.match(read(ng, 'ai/agents/qa-orchestrator.md'), /not supported/, 'angular has no `all` mode');

    // The orchestrator's sub-agents cannot ask the user anything: it asks once, and says so.
    const orch = read(nest, 'ai/agents/qa-orchestrator.md');
    assert.match(orch, /Confirm models once/);
    assert.match(orch, /model is\s+already confirmed/);

    const react = tmpRepo();
    init(['--repo', react, '--stack', 'react', '--tracker', 'none', '--render', '--no-color']);
    for (const f of QA_AGENTS) assert.ok(!fs.existsSync(path.join(react, 'ai/agents', f)), `react ships no ${f}`);
    for (const f of QA_COMMANDS) assert.ok(!fs.existsSync(path.join(react, '.claude/commands', f)));
    assert.ok(!/QA for existing code/.test(read(react, 'ai/AGENTS.md')));
    assert.match(read(nest, 'ai/AGENTS.md'), /QA for existing code/);
  } finally {
    console.log = log;
  }
});

test('tdd: off by default; on, the architect orders tests first and developer/reviewer require red then green', () => {
  const render = require('../lib/render');
  const agent = (role, tdd) => {
    const config = { stack: ['nestjs'], tracker: { provider: 'none' }, ...(tdd ? { tdd: true } : {}) };
    return render.renderTargets({ config, presetsDir: 'presets' }).targets.find((t) => t[0] === `ai/agents/${role}.md`)[1];
  };
  for (const role of ['architect', 'developer', 'reviewer']) {
    assert.ok(!/test-first/i.test(agent(role, false)), role + ' is test-after without tdd');
    assert.match(agent(role, true), /test-first/i, role + ' is test-first with tdd');
  }
  assert.match(agent('architect', false), /placed after the code they cover/);
  assert.match(agent('architect', false), /§ Test plan format/, 'the architect points at the per-file test shape');
  assert.match(agent('architect', true), /\*\*before\*\* the code that makes them pass/);
  assert.match(agent('developer', true), /RED \(<reason>\) → GREEN/);
  assert.match(agent('developer', true), /not red; fix the test/, 'red is defined, a compile error in the test is not red');
  assert.match(agent('reviewer', true), /only as passing is a blocking finding/);
  const qa = render.renderTargets({ config: { stack: ['nestjs'], tracker: { provider: 'none' }, tdd: true }, presetsDir: 'presets' })
    .targets.find((t) => t[0] === 'ai/agents/qa-architect.md')[1];
  assert.match(qa, /characterization tests/);
  assert.ok(!/RED \(/.test(qa), 'the backfill agents are not test-first');
});

test('sizing: opt-in; on, the architect estimates, proposes a split and re-checks the plan', () => {
  const render = require('../lib/render');
  const architect = (extra) =>
    render.renderTargets({ config: { stack: ['nestjs'], tracker: { provider: 'none' }, ...extra }, presetsDir: 'presets' })
      .targets.find((t) => t[0] === 'ai/agents/architect.md')[1];
  assert.ok(!/Size and split|Size check|## Size/.test(architect()), 'no size check without sizing');
  const on = architect({ sizing: { maxLoc: 250 } });
  assert.match(on, /\*\*12 files\*\* and \*\*250 lines\*\*/, 'a set limit is used, the other defaults');
  assert.match(on, /## Follow-up steps/);
  assert.match(on, /\*\*Size check\.\*\*/);
  assert.match(architect({ sizing: {} }), /\*\*12 files\*\* and \*\*400 lines\*\*/);
});

test('sizing: a non-positive or non-integer limit is rejected', () => {
  const { loadRepoConfig, ConfigError } = require('../lib/config');
  for (const sizing of [{ maxLoc: 0 }, { maxFiles: 1.5 }, 'big']) {
    const dir = tmpRepo();
    fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ stack: ['nestjs'], sizing }));
    assert.throws(() => loadRepoConfig(dir), ConfigError);
  }
});

test('commands.build: named in the developer when set, looked up when not', () => {
  const render = require('../lib/render');
  const dev = (extra) =>
    render.renderTargets({ config: { stack: ['nestjs'], tracker: { provider: 'none' }, ...extra }, presetsDir: 'presets' })
      .targets.find((t) => t[0] === 'ai/agents/developer.md')[1];
  assert.match(dev({ commands: { build: 'yarn build' } }), /Run `yarn build` to ensure/);
  assert.match(dev(), /the `build` script in `package.json`/);
});

test('local: an override under the pre-rename slot name still applies', () => {
  const { createLocalReader } = require('../lib/local');
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'ai/local/slots'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/local/slots/architect-mandatory-docs.md'), '- `docs/extra.md`\n');
  assert.ok(createLocalReader(dir).slot('mandatory-docs'), 'old file name is read for the renamed slot');
  fs.writeFileSync(path.join(dir, 'ai/local/slots/mandatory-docs.md'), '- `docs/new.md`\n');
  assert.match(createLocalReader(dir).slot('mandatory-docs').text, /docs\/new\.md/, 'the new name wins');
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

// A seed (project-owned after the first write, merged on sync) versus the default
// `core/agents/x.md`, which is cairn-owned and regenerated.
const SEED_SOURCE = 'presets:x/code-guidelines.md';

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
    { base: 'a\nb\nc\n', ours: 'a\nB\nc\n', writtenHash: manifest.hashContent('a\nb\nc\n') },
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
  const { action } = plan1('ai/x.md', { base, ours, source: SEED_SOURCE }, theirs);
  assert.strictEqual(action.outcome, sync.OUTCOME.MERGED);
  assert.strictEqual(action.write, 'top\nl1\nl2\nl3\nl4\nl5\nbottom\n');
  assert.strictEqual(action.base, theirs);
  assert.ok(!action.conflict);
});

test('sync: overlapping edits leave conflict markers, exit non-zero, converge next run', () => {
  const base = 'l1\nl2\nl3\n';
  const ours = 'l1\nOURS\nl3\n';
  const theirs = 'l1\nTHEIRS\nl3\n';
  const { action } = plan1('ai/x.md', { base, ours, source: SEED_SOURCE }, theirs);
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
    { base: theirs, ours: 'l1\nRESOLVED\nl3\n', source: SEED_SOURCE },
    theirs,
  );
  // simulate the flag being set from the previous run
  resolved.action = sync.planFile(
    'ai/x.md',
    { hash: manifest.hashContent('l1\nRESOLVED\nl3\n'), source: SEED_SOURCE, conflict: true },
    resolved.dir,
    new Map([['ai/x.md', { content: theirs, source: SEED_SOURCE }]]),
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

test('sync: a preset file the manifest lacks is CREATED, greenfield-guarded; a squatter is UNTRACKED, not invisible', () => {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  manifest.record(m, 'ai/kept.md', 'core/agents/x.md', 'k\n');
  fs.mkdirSync(path.join(dir, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/kept.md'), 'k\n');
  manifest.writeBase(dir, 'ai/kept.md', 'k\n');
  manifest.writeManifest(dir, m);

  // A second target the manifest has never seen. One is absent (create it), one
  // already sits on disk unmanaged — reported, not silently left alone or clobbered.
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
    assert.strictEqual(byRel['ai/squatter.md'], sync.OUTCOME.UNTRACKED);
    const squatterAction = actions.find((a) => a.rel === 'ai/squatter.md');
    assert.strictEqual(squatterAction.write, undefined, 'never written without --adopt-base');
  } finally {
    require('../lib/render').renderTargets = orig;
  }
});

test('sync: --adopt-base brings a squatter under management without clobbering it', () => {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  manifest.writeManifest(dir, m);
  fs.mkdirSync(path.join(dir, 'ai'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai/squatter.md'), 'legacy content\n');

  const { planSync } = sync;
  const orig = require('../lib/render').renderTargets;

  try {
    // First: template matches what's already on disk — adopting should be a
    // quiet UNCHANGED, and the squatter's content must survive untouched.
    require('../lib/render').renderTargets = () => ({
      targets: [['ai/squatter.md', 'legacy content\n', 'core/agents/z.md']],
    });
    {
      const { actions } = planSync({ config: {}, presetsDir: 'x', manifest: m, repoPath: dir, adoptBase: true });
      const action = actions.find((a) => a.rel === 'ai/squatter.md');
      assert.strictEqual(action.outcome, sync.OUTCOME.UNCHANGED);
      assert.strictEqual(action.source, 'core/agents/z.md');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'ai/squatter.md'), 'utf8'), 'legacy content\n');
    }

    // Apply it for real (same mock still active) so the manifest entry + base
    // actually land.
    const { actions: real } = sync.planSync({ config: {}, presetsDir: 'x', manifest: m, repoPath: dir, adoptBase: true });
    const { applyPlan } = require('../lib/sync/cli');
    const { makePaint } = require('../lib/paint');
    applyPlan(dir, m, real, makePaint(false));
    assert.ok(m.files['ai/squatter.md'], 'manifest entry created on first adopt');

    // Now the template moves. A plain sync (no --adopt-base needed this time,
    // it's tracked now) should fast-forward.
    require('../lib/render').renderTargets = () => ({
      targets: [['ai/squatter.md', 'new template\n', 'core/agents/z.md']],
    });
    const { actions } = planSync({ config: {}, presetsDir: 'x', manifest: m, repoPath: dir, adoptBase: false });
    const action = actions.find((a) => a.rel === 'ai/squatter.md');
    assert.strictEqual(action.outcome, sync.OUTCOME.FAST_FORWARD);
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
  const noBase = plan1('ai/x.md', { base: undefined, ours: 'edited\n', writtenHash: manifest.hashContent('orig\n'), source: SEED_SOURCE }, 'orig2\n');
  assert.strictEqual(noBase.action.outcome, sync.OUTCOME.NO_BASE);

  const adopted = plan1(
    'ai/x.md',
    { base: undefined, ours: 'edited\n', writtenHash: manifest.hashContent('orig\n'), source: SEED_SOURCE },
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

// Agent docs are regenerated from the template plus ai/local/, never merged.

// Agent docs are regenerated; everything else is merged.
const OWNED = 'core/agents/x.md';
const planOwned = (fixture, theirs, opts = {}) => plan1('ai/agents/x.md', { source: OWNED, ...fixture }, theirs, opts);

test('sync: an agent doc edited by hand while the template moved is HAND_EDITED, with a diff, and is not written', () => {
  const base = 'a\nb\nc\n';
  const { action } = planOwned(
    { base, ours: 'a\nB\nc\n', writtenHash: manifest.hashContent(base) },
    'a\nb\nc\nd\n',
  );
  assert.strictEqual(action.outcome, sync.OUTCOME.HAND_EDITED);
  assert.strictEqual(action.write, undefined);
  assert.match(action.diff, /^--- what cairn wrote\n\+\+\+ ai\/agents\/x\.md\n@@/);
  assert.match(action.diff, /-b\n\+B/);
});

test('sync: --reset takes the template for a hand-edited owned file', () => {
  const base = 'a\nb\nc\n';
  const { action } = planOwned(
    { base, ours: 'a\nB\nc\n', writtenHash: manifest.hashContent(base) },
    'a\nb\nc\nd\n',
    { reset: new Set(['ai/agents/x.md']) },
  );
  assert.strictEqual(action.outcome, sync.OUTCOME.RESET);
  assert.strictEqual(action.write, 'a\nb\nc\nd\n');
  assert.strictEqual(action.base, 'a\nb\nc\nd\n');
});

test('sync: an agent doc is never three-way merged, even when the edits would merge cleanly', () => {
  const base = 'l1\nl2\nl3\nl4\nl5\n';
  const { action } = planOwned(
    { base, ours: 'top\nl1\nl2\nl3\nl4\nl5\n', writtenHash: manifest.hashContent(base) },
    'l1\nl2\nl3\nl4\nl5\nbottom\n',
  );
  assert.strictEqual(action.outcome, sync.OUTCOME.HAND_EDITED);
});

test('sync: an agent doc nobody touched fast-forwards, and one already equal to the render just refreshes the manifest', () => {
  const ff = planOwned({ base: 'v1\n', ours: 'v1\n' }, 'v2\n').action;
  assert.strictEqual(ff.outcome, sync.OUTCOME.FAST_FORWARD);
  assert.strictEqual(ff.write, 'v2\n');

  // Markers resolved by hand until the file equals the template: nothing to write.
  const same = planOwned({ base: 'v1\n', ours: 'v2\n', writtenHash: manifest.hashContent('<<<<<<< junk\n') }, 'v2\n').action;
  assert.strictEqual(same.outcome, sync.OUTCOME.UNCHANGED);
  assert.strictEqual(same.write, undefined);
  assert.strictEqual(same.record, 'v2\n');
});

test('sync: markers left by an earlier sync are never overwritten with the template', () => {
  const dir = tmpRepo();
  const rel = 'ai/agents/x.md';
  const withMarkers = 'a\n<<<<<<< ours (your edits)\nX\n=======\nY\n>>>>>>> theirs (new template)\n';
  fs.mkdirSync(path.join(dir, 'ai/agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), withMarkers);
  const entry = { source: OWNED, hash: manifest.hashContent(withMarkers), conflict: true };
  const targets = new Map([[rel, { content: 'a\nY\n', source: OWNED }]]);
  const blocked = sync.planFile(rel, entry, dir, targets, { adoptBase: false });
  assert.strictEqual(blocked.outcome, sync.OUTCOME.CONFLICT);
  assert.strictEqual(blocked.write, undefined);
  const forced = sync.planFile(rel, entry, dir, targets, { adoptBase: false, reset: new Set([rel]) });
  assert.strictEqual(forced.write, 'a\nY\n');
});

atest('sync: a change in ai/local/ reaches the generated agent on the next sync; a hand edit is reported and --reset clears it', async () => {
  const { main: init } = require('../lib/init');
  const syncCli = require('../lib/sync/cli');
  const dir = tmpRepo();
  const dev = path.join(dir, 'ai/agents/developer.md');
  const quiet = (fn) => captureLog(fn);
  const err = console.error;
  console.error = () => {};
  try {
    quiet(() => init(['--repo', dir, '--stack', 'nestjs', '--tracker', 'none', '--render', '--no-color']));
    const rendered = fs.readFileSync(dev, 'utf8');
    assert.ok(rendered.includes('Thin controllers'));

    // 1. An override appears; sync rebuilds the agent, records the override, exits 0.
    fs.mkdirSync(path.join(dir, 'ai/local/slots'), { recursive: true });
    const slotFile = path.join(dir, 'ai/local/slots/implementation-reference.md');
    fs.writeFileSync(slotFile, '### Controllers\n- Bind inputs with a schema\n');
    const first = quiet(() => syncCli.main(['--repo', dir, '--no-color']));
    assert.strictEqual(first.result, 0);
    assert.match(first.out, /fast-forward\s+ai\/agents\/developer\.md/);
    const merged = fs.readFileSync(dev, 'utf8');
    assert.ok(merged.includes('- Bind inputs with a schema') && !merged.includes('Thin controllers'));
    assert.ok(merged.includes('### Services'), 'the rest of the preset is still there');
    assert.ok(manifest.readManifest(dir).overrides['slots/implementation-reference'], 'override recorded on first sight');

    // 2. Nothing changed: a second sync is quiet.
    const second = quiet(() => syncCli.main(['--repo', dir, '--no-color']));
    assert.strictEqual(second.result, 0);
    assert.ok(!/fast-forward|HAND-EDITED/.test(second.out));

    // 3. Someone edits the generated file, then the override changes. Sync refuses
    // to overwrite the edit, shows it, and exits 3.
    fs.writeFileSync(dev, merged.replace('### Services', '### Services\n- HAND EDIT'));
    fs.writeFileSync(slotFile, '### Controllers\n- Bind inputs with a schema, always\n');
    const third = quiet(() => syncCli.main(['--repo', dir, '--no-color']));
    assert.strictEqual(third.result, 3);
    assert.match(third.out, /HAND-EDITED\s+ai\/agents\/developer\.md/);
    assert.match(third.out, /\+- HAND EDIT/, 'the edit is shown as a diff');
    assert.ok(fs.readFileSync(dev, 'utf8').includes('- HAND EDIT'), 'the file is untouched');

    // 4. --reset takes the generated file; the override is in it, the hand edit is not.
    const fourth = quiet(() => syncCli.main(['--repo', dir, '--no-color', '--reset', 'ai/agents/developer.md']));
    assert.strictEqual(fourth.result, 0);
    const final = fs.readFileSync(dev, 'utf8');
    assert.ok(final.includes('with a schema, always') && !final.includes('HAND EDIT'));
    assert.strictEqual(quiet(() => syncCli.main(['--repo', dir, '--no-color'])).result, 0);

    // 5. --reset on a path cairn does not manage is an error, not a silent no-op.
    assert.strictEqual(syncCli.main(['--repo', dir, '--no-color', '--reset', 'ai/nope.md']), 2);
  } finally {
    console.error = err;
  }
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

test('sync: non-overlapping edits merge cleanly whatever mix of line endings the three sides use', () => {
  const { gitMergeFile } = require('../lib/sync');
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  const base = lines(30);
  const ours = base.map((l, i) => (i === 4 ? 'line 5 (local edit)' : l));
  const theirs = [...base.slice(0, 20), 'inserted by the template', ...base.slice(20)];
  const join = (a, eol) => a.join(eol) + eol;
  for (const [o, b, t] of [['\n', '\n', '\n'], ['\r\n', '\r\n', '\n'], ['\r\n', '\n', '\n'], ['\r\n', '\r\n', '\r\n'], ['\n', '\r\n', '\n']]) {
    const r = gitMergeFile(join(ours, o), join(base, b), join(theirs, t));
    const label = JSON.stringify([o, b, t]);
    assert.ok(r.ok, label);
    assert.strictEqual(r.conflicts, 0, `ours/base/theirs ${label} merges cleanly`);
    assert.ok(r.merged.includes('line 5 (local edit)') && r.merged.includes('inserted by the template'), label);
    // The merged file keeps the style `ours` had.
    const expectCr = o === '\r\n';
    assert.strictEqual(/\r\n/.test(r.merged), expectCr, `${label}: line endings follow ours`);
    assert.ok(!/(^|[^\r])\n/.test(r.merged) || !expectCr, `${label}: no stray bare LF in a CRLF file`);
  }
});

test('sync: a real overlap still conflicts, with markers in the file\'s own line endings', () => {
  const { gitMergeFile } = require('../lib/sync');
  const eol = '\r\n';
  const doc = (mid) => ['a', 'b', mid, 'd', 'e'].join(eol) + eol;
  const r = gitMergeFile(doc('ours'), doc('base'), doc('theirs').replace(/\r\n/g, '\n'));
  assert.ok(r.ok);
  assert.strictEqual(r.conflicts, 1);
  assert.match(r.merged, /<{7} ours \(your edits\)\r\n/);
  assert.match(r.merged, />{7} theirs \(new template\)\r\n/);
});

atest('sync: --only restores one file, leaves the rest alone, and rejects a path it does not know', async () => {
  const { main: init } = require('../lib/init');
  const syncCli = require('../lib/sync/cli');
  const dir = tmpRepo();
  const log = console.log;
  const errLog = console.error;
  console.log = () => {};
  try {
    init(['--repo', dir, '--stack', 'react', '--tracker', 'none', '--render', '--no-color']);
    const scout = path.join(dir, '.claude/agents/code-scout.md');
    const reviewer = path.join(dir, 'ai/agents/reviewer.md');
    fs.rmSync(scout);
    fs.rmSync(reviewer);
    // Pretend an older cairn rendered this repo, so a stamp would be visible.
    const old = manifest.readManifest(dir);
    old.cairnVersion = '0.0.1';
    fs.writeFileSync(manifest.manifestPath(dir), JSON.stringify(old, null, 2));

    assert.strictEqual(syncCli.main(['--repo', dir, '--no-color', '--only', '.claude\\agents\\code-scout.md']), 0);
    assert.ok(fs.existsSync(scout), 'the named file is restored');
    assert.ok(!fs.existsSync(reviewer), 'every other file is untouched');
    assert.strictEqual(manifest.readManifest(dir).cairnVersion, '0.0.1', 'a partial sync does not stamp the version');

    console.error = () => {};
    assert.strictEqual(syncCli.main(['--repo', dir, '--no-color', '--only', 'ai/agents/nope.md']), 2);
    assert.ok(!fs.existsSync(reviewer));
  } finally {
    console.log = log;
    console.error = errLog;
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
    const agents = path.join(dir, 'ai/infrastructure/code-guidelines.md');
    const original = fs.readFileSync(agents, 'utf8');

    // Stale base differs from the render on line 1; the working file differs from
    // the base on the same line -> a genuine overlap.
    const staleBase = original.replace(/^.*\n/, 'BASE LINE ONE\n');
    const ourEdit = original.replace(/^.*\n/, 'OUR LINE ONE\n');
    manifest.writeBase(dir, 'ai/infrastructure/code-guidelines.md', staleBase);
    fs.writeFileSync(agents, ourEdit);
    const m = manifest.readManifest(dir);
    m.files['ai/infrastructure/code-guidelines.md'].hash = manifest.hashContent(ourEdit);
    manifest.writeManifest(dir, m);

    const code = syncCli.main(['--repo', dir, '--no-color']);
    assert.strictEqual(code, 3, 'conflict exit code');
    assert.match(fs.readFileSync(agents, 'utf8'), /<<<<<<< /, 'markers written in place');

    const state = statusFor(dir, readManifest(dir)).find((f) => f.path === 'ai/infrastructure/code-guidelines.md');
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

// ------------------------------------------------------------------- context

const frontmatter = require('../lib/context/frontmatter');
const context = require('../lib/context');

test('context/frontmatter: scalars, booleans, inline and block arrays', () => {
  const text = [
    '---',
    'counterpartOf: frontend:ai/contexts/entities/invoice.md',
    'unmanaged: true',
    'empty:',
    'inline: [a, b, c]',
    'block:',
    '  - x',
    '  - y',
    '---',
    '# Invoice',
    'body text',
  ].join('\n');
  const { data, body } = frontmatter.parse(text);
  assert.strictEqual(data.counterpartOf, 'frontend:ai/contexts/entities/invoice.md');
  assert.strictEqual(data.unmanaged, true);
  assert.strictEqual(data.empty, null);
  assert.deepStrictEqual(data.inline, ['a', 'b', 'c']);
  assert.deepStrictEqual(data.block, ['x', 'y']);
  assert.match(body, /^# Invoice/);
  assert.strictEqual(frontmatter.firstHeading(body), 'Invoice');
});

test('context/frontmatter: no fence at all is a no-op, not an error', () => {
  const { data, body } = frontmatter.parse('# Just a doc\nno frontmatter here\n');
  assert.deepStrictEqual(data, {});
  assert.match(body, /^# Just a doc/);
});

function writeCtx(repoDir, relPath, content) {
  const abs = path.join(repoDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

test('context: declared counterpartOf infers the reverse edge and suppresses CANDIDATE', () => {
  const backend = tmpRepo();
  const frontend = tmpRepo();
  writeCtx(backend, 'ai/contexts/entities/invoice.md', '---\ncounterpartOf: frontend:ai/contexts/entities/invoice.md\n---\n# Invoice\n');
  writeCtx(frontend, 'ai/contexts/entities/invoice.md', '---\n---\n# Invoice\n');

  const graph = context.build([
    { name: 'backend', path: backend },
    { name: 'frontend', path: frontend },
  ]);
  assert.strictEqual(graph.nodes.size, 2);
  assert.strictEqual(graph.edges.length, 2);
  const reverse = graph.edges.find((e) => e.from === 'frontend:ai/contexts/entities/invoice.md');
  assert.ok(reverse.inferred, 'reverse edge is marked inferred');

  const result = context.check(graph);
  assert.ok(!result.findings.some((f) => f.type === 'CANDIDATE'), 'a declared link is never also suggested');

  const cp = context.counterparts(graph, 'backend:ai/contexts/entities/invoice.md');
  assert.strictEqual(cp.length, 1);
  assert.strictEqual(cp[0].id, 'frontend:ai/contexts/entities/invoice.md');
  assert.strictEqual(cp[0].title, 'Invoice');
});

test('context: undeclared same-path pair is CANDIDATE; notCounterpartOf silences it', () => {
  const backend = tmpRepo();
  const frontend = tmpRepo();
  writeCtx(backend, 'ai/contexts/entities/waitlist.md', '# Waitlist\n');
  writeCtx(frontend, 'ai/contexts/entities/waitlist.md', '# Waitlist\n');

  let graph = context.build([
    { name: 'backend', path: backend },
    { name: 'frontend', path: frontend },
  ]);
  let result = context.check(graph);
  assert.ok(result.findings.some((f) => f.type === 'CANDIDATE'));

  writeCtx(backend, 'ai/contexts/entities/waitlist.md', '---\nnotCounterpartOf: [ai/contexts/entities/waitlist.md]\n---\n# Waitlist\n');
  graph = context.build([
    { name: 'backend', path: backend },
    { name: 'frontend', path: frontend },
  ]);
  result = context.check(graph);
  assert.ok(!result.findings.some((f) => f.type === 'CANDIDATE'), 'notCounterpartOf silences the suggestion');
});

test('context: DANGLING for an unresolvable counterpartOf, OFF_CONVENTION for no category folder unless unmanaged', () => {
  const backend = tmpRepo();
  writeCtx(backend, 'ai/contexts/entities/ghost.md', '---\ncounterpartOf: backend:ai/contexts/entities/nope.md\n---\n# Ghost\n');
  writeCtx(backend, 'ai/contexts/mappers.md', '# Mappers\n');
  writeCtx(backend, 'ai/contexts/features/audit-log/overview.md', '---\n---\n# Audit Log\n');

  const graph = context.build([{ name: 'backend', path: backend }]);
  const result = context.check(graph);
  assert.ok(result.findings.some((f) => f.type === 'DANGLING' && f.id === 'backend:ai/contexts/entities/ghost.md'));
  assert.ok(
    result.findings.some((f) => f.type === 'OFF_CONVENTION' && f.id === 'backend:ai/contexts/mappers.md'),
    'no category folder at all is off-convention',
  );
  assert.ok(
    !result.findings.some((f) => f.id === 'backend:ai/contexts/features/audit-log/overview.md' && f.type === 'OFF_CONVENTION'),
    'nested category/feature/aspect.md is on-convention, not just category/name.md',
  );

  writeCtx(backend, 'ai/contexts/mappers.md', '---\nunmanaged: true\n---\n# Mappers\n');
  const graph2 = context.build([{ name: 'backend', path: backend }]);
  const result2 = context.check(graph2);
  assert.ok(!result2.findings.some((f) => f.id === 'backend:ai/contexts/mappers.md'), 'unmanaged: true opts a file out entirely');
});

test('context: check never fails on its own (always returns, never throws) and reports the unwired finding types once', () => {
  const empty = tmpRepo();
  const graph = context.build([{ name: 'solo', path: empty }]);
  const result = context.check(graph);
  assert.deepStrictEqual(result.findings, []);
  assert.deepStrictEqual(result.notChecked, ['BROKEN_ANCHOR', 'CONTENT_MISMATCH', 'TRACKER_DESYNC']);
});

atest('context: CLI build/check/counterparts against a repos.json workspace, --strict exits 1 only on findings', async () => {
  const workspace = tmpRepo();
  const backend = path.join(workspace, 'backend');
  const frontend = path.join(workspace, 'frontend');
  fs.mkdirSync(backend, { recursive: true });
  fs.mkdirSync(frontend, { recursive: true });
  writeCtx(backend, 'ai/contexts/entities/invoice.md', '# Invoice\n');
  writeCtx(frontend, 'ai/contexts/entities/invoice.md', '# Invoice\n');
  fs.writeFileSync(
    path.join(workspace, 'repos.json'),
    JSON.stringify({ repos: [{ name: 'backend', path: 'backend' }, { name: 'frontend', path: 'frontend' }] }),
  );

  const contextCli = require('../lib/context/cli');
  const cwd = process.cwd();
  const log = console.log;
  const logged = [];
  console.log = (s) => logged.push(s);
  try {
    process.chdir(workspace);
    const buildExit = await contextCli.main(['build', '--json', '--no-color']);
    assert.strictEqual(buildExit, 0);
    const built = JSON.parse(logged.pop());
    assert.strictEqual(built.nodes.length, 2);

    const checkExit = await contextCli.main(['check', '--json', '--no-color']);
    assert.strictEqual(checkExit, 0, 'plain check never fails CI');
    const checked = JSON.parse(logged.pop());
    assert.ok(checked.findings.some((f) => f.type === 'CANDIDATE'));

    const strictExit = await contextCli.main(['check', '--strict', '--json', '--no-color']);
    assert.strictEqual(strictExit, 1, '--strict exits 1 when findings exist');
    logged.pop();

    const cpExit = await contextCli.main(['counterparts', 'backend:ai/contexts/entities/invoice.md', '--json', '--no-color']);
    assert.strictEqual(cpExit, 0);
    assert.deepStrictEqual(JSON.parse(logged.pop()), []);
  } finally {
    process.chdir(cwd);
    console.log = log;
  }
});

// ---------------------------------------------------------------- workspace

function workspaceFixture(reposJson, repoConfigs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-ws-'));
  fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify(reposJson));
  for (const [name, cfg] of Object.entries(repoConfigs)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    if (cfg) fs.writeFileSync(path.join(root, name, 'cairn.config.json'), JSON.stringify(cfg));
  }
  return root;
}

test('workspace: siblings come from ../repos.json, self excluded, stack read from their config', () => {
  const { workspaceContext } = require('../lib/workspace');
  const root = workspaceFixture(
    { repos: [{ name: 'backend', path: 'backend', role: 'REST API' }, { name: 'frontend', path: 'frontend' }] },
    { backend: { stack: ['nestjs', 'typeorm'] }, frontend: { stack: ['react'] } },
  );
  const ws = workspaceContext(path.join(root, 'frontend'), {});
  assert.strictEqual(ws.count, 2);
  assert.strictEqual(ws.file, '../repos.json');
  assert.deepStrictEqual(ws.siblings, [
    { name: 'backend', path: '../backend', stack: 'nestjs, typeorm', role: 'REST API' },
  ]);
});

test('workspace: none when repos.json is absent, the repo is not listed, or it is alone', () => {
  const { workspaceContext } = require('../lib/workspace');
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-ws-'));
  fs.mkdirSync(path.join(lone, 'a'));
  assert.strictEqual(workspaceContext(path.join(lone, 'a'), {}), null, 'no repos.json');

  const unlisted = workspaceFixture({ repos: [{ name: 'b', path: 'b' }, { name: 'c', path: 'c' }] }, { a: null, b: null, c: null });
  assert.strictEqual(workspaceContext(path.join(unlisted, 'a'), {}), null, 'repo not a member');

  const solo = workspaceFixture({ repos: [{ name: 'a', path: 'a' }] }, { a: null });
  assert.strictEqual(workspaceContext(path.join(solo, 'a'), {}), null, 'no siblings');
  assert.strictEqual(workspaceContext(null, {}), null, 'no repoPath');
});

test('workspace: config.workspace overrides the ../repos.json default', () => {
  const { workspaceContext } = require('../lib/workspace');
  const root = workspaceFixture({ repos: [] }, { a: null, b: null });
  fs.writeFileSync(path.join(root, 'a', 'ws.json'), JSON.stringify({ repos: [{ name: 'a', path: '.' }, { name: 'b', path: '../b' }] }));
  const ws = workspaceContext(path.join(root, 'a'), { workspace: 'ws.json' });
  assert.deepStrictEqual(ws.siblings.map((s) => s.name), ['b']);
  assert.strictEqual(ws.file, 'ws.json');
});

test('workspace: render emits the Workspace section and architect checks only inside a workspace', () => {
  const render = require('../lib/render');
  const root = workspaceFixture(
    { repos: [{ name: 'backend', path: 'backend', role: 'REST API' }, { name: 'frontend', path: 'frontend' }] },
    { backend: { stack: ['nestjs'] }, frontend: { stack: ['react'] } },
  );
  const config = { stack: ['react'], tracker: { provider: 'none' } };
  const pick = (targets, rel) => targets.find((t) => t[0] === rel)[1];

  const inside = render.renderTargets({ config, presetsDir: 'presets', repoPath: path.join(root, 'frontend') }).targets;
  assert.ok(/## Workspace/.test(pick(inside, 'ai/AGENTS.md')));
  assert.ok(pick(inside, 'ai/AGENTS.md').includes('| `backend` | `../backend` | nestjs | REST API |'));
  assert.ok(/Every sibling repo the task touches/.test(pick(inside, 'ai/agents/architect.md')));

  const outside = render.renderTargets({ config, presetsDir: 'presets' }).targets;
  assert.ok(!/Workspace/.test(pick(outside, 'ai/AGENTS.md')), 'no repoPath -> no section');
  assert.ok(!/sibling repo/.test(pick(outside, 'ai/agents/architect.md')));
});

// ---------------------------------------------------------------- snapshots
//
// The real fix for "no prompt tests": every file a preset renders, for a handful of
// representative stacks, is committed under test/snapshots/. A template change then
// shows up as a reviewable diff here instead of silently reaching every repo.
// Regenerate with `UPDATE_SNAPSHOTS=1 npm test` and review `git diff test/snapshots`.

const SNAPSHOT_CASES = {
  'nestjs-typeorm-youtrack': { stack: ['nestjs', 'typeorm'], tracker: { provider: 'youtrack', projectKey: 'CI' } },
  'react-tailwind-none': { stack: ['react', 'tailwind'], tracker: { provider: 'none' } },
  'angular-jira-server': {
    stack: ['angular'],
    tracker: { provider: 'jira-server', projectKey: 'PROOF', issueTypes: { story: 'Task', subtask: 'Sub-task' } },
  },
  'nestjs-youtrack-public-refs': {
    stack: ['nestjs'],
    tracker: { provider: 'youtrack', projectKey: 'CI', publicRefs: true },
  },
  'nestjs-youtrack-stage-moves': {
    stack: ['nestjs'],
    tracker: { provider: 'youtrack', projectKey: 'CI', statuses: { inProgress: 'Develop', review: 'Review' } },
  },
  'nextjs-drizzle-youtrack': { stack: ['nextjs', 'drizzle'], tracker: { provider: 'youtrack', projectKey: 'CI' } },
  'react-css-modules-none': { stack: ['react', 'css-modules'], tracker: { provider: 'none' } },
  'nestjs-typeorm-codex': { stack: ['nestjs', 'typeorm'], tracker: { provider: 'none' }, codexSkills: true },
  'nestjs-codex-only': { stack: ['nestjs'], tracker: { provider: 'none' }, hosts: ['codex'] },
  'spring-jpa-flyway-docker-none': { stack: ['spring', 'jpa-flyway', 'docker'], tracker: { provider: 'none' } },
  'spring-jpa-flyway-none': { stack: ['spring', 'jpa-flyway'], tracker: { provider: 'none' } },
};

function snapshotFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? snapshotFiles(abs, base) : [path.relative(base, abs).replace(/\\/g, '/')];
  });
}

for (const [name, config] of Object.entries(SNAPSHOT_CASES)) {
  test(`snapshot: ${name} renders exactly the committed files`, () => {
    const render = require('../lib/render');
    const targets = render.renderTargets({ config, presetsDir: 'presets', repoPath: null }).targets;
    const dir = path.join(__dirname, 'snapshots', name);
    const norm = (t) => String(t).replace(/\r\n?/g, '\n');

    if (process.env.UPDATE_SNAPSHOTS) {
      fs.rmSync(dir, { recursive: true, force: true });
      for (const [rel, content] of targets) {
        const file = path.join(dir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, norm(content), 'utf8');
      }
      return;
    }

    const rendered = new Set(targets.map((t) => t[0]));
    const committed = new Set(snapshotFiles(dir));
    const added = [...rendered].filter((r) => !committed.has(r));
    const removed = [...committed].filter((r) => !rendered.has(r));
    assert.deepStrictEqual(
      { added, removed },
      { added: [], removed: [] },
      'the set of rendered files changed — review, then UPDATE_SNAPSHOTS=1 npm test',
    );

    const changed = targets
      .filter(([rel, content]) => norm(content) !== norm(fs.readFileSync(path.join(dir, rel), 'utf8')))
      .map((t) => t[0]);
    assert.deepStrictEqual(
      changed,
      [],
      `rendered output changed for: ${changed.join(', ')} — review, then UPDATE_SNAPSHOTS=1 npm test`,
    );
  });
}

// ------------------------------------------------------- versions and upgrade

test('doctor: compareVersions orders on the numeric core', () => {
  const { compareVersions } = require('../lib/doctor/versions');
  assert.strictEqual(compareVersions('0.9.0', '0.9.1'), -1);
  assert.strictEqual(compareVersions('0.10.0', '0.9.9'), 1);
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
});

test('doctor: version rows flag a stale install, a render behind the install, and skew', () => {
  const { collectVersions, hasSkew } = require('../lib/doctor/versions');
  const mk = (name, installed, rendered) => {
    const dir = tmpRepo();
    if (installed) {
      const pkgDir = path.join(dir, 'node_modules', '@stonepandastudio', 'cairn');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: installed }));
    }
    if (rendered) {
      manifest.writeManifest(dir, manifest.emptyManifest());
      const file = manifest.manifestPath(dir);
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), cairnVersion: rendered }));
    }
    return { name, path: dir };
  };
  const rows = collectVersions(
    [mk('a', '0.9.1', '0.9.1'), mk('b', '0.8.2', '0.8.2'), mk('c', '0.9.1', '0.9.0'), mk('d', null, null)],
    '0.9.1',
  );
  const by = Object.fromEntries(rows.map((r) => [r.repo, r]));
  assert.deepStrictEqual(by.a.notes, []);
  assert.ok(by.b.notes.some((n) => /BEHIND/.test(n)));
  assert.ok(by.c.notes.some((n) => /run cairn sync/.test(n)));
  assert.ok(by.d.notes.some((n) => /not installed/.test(n)));
  assert.strictEqual(hasSkew(rows), true);
  assert.strictEqual(hasSkew(rows.filter((r) => r.repo !== 'b')), false);
});

test('manifest: OUTDATED via outdatedRels, and writeManifest stamps the cairn version', () => {
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  fs.writeFileSync(path.join(dir, 'x.md'), 'v1\n');
  manifest.record(m, 'x.md', 'tpl/x.md', 'v1\n');
  const written = manifest.writeManifest(dir, m);
  assert.strictEqual(written.cairnVersion, require('../package.json').version);

  const read = manifest.readManifest(dir);
  assert.strictEqual(manifest.statusFor(dir, read, null, new Set())[0].state, 'MANAGED');
  assert.strictEqual(manifest.statusFor(dir, read, null, new Set(['x.md']))[0].state, 'OUTDATED');

  fs.writeFileSync(path.join(dir, 'x.md'), 'edited\n');
  assert.strictEqual(manifest.statusFor(dir, read, null, new Set(['x.md']))[0].state, 'MODIFIED', 'a hand edit still wins');
});

test('sync: outdatedRels flags only files whose template moved since the base', () => {
  const render = require('../lib/render');
  const { outdatedRels } = require('../lib/sync');
  const config = { stack: ['react'], tracker: { provider: 'none' } };
  const dir = tmpRepo();
  const m = manifest.emptyManifest();
  for (const [rel, content, source] of render.renderTargets({ config, presetsDir: 'presets' }).targets) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
    manifest.record(m, rel, source, content);
    manifest.writeBase(dir, rel, content);
  }
  manifest.writeManifest(dir, m);
  const read = manifest.readManifest(dir);
  assert.strictEqual(outdatedRels({ config, presetsDir: 'presets', manifest: read, repoPath: dir }).size, 0);

  manifest.writeBase(dir, 'ai/WORKFLOW.md', 'an older template render\n');
  const out = outdatedRels({ config, presetsDir: 'presets', manifest: read, repoPath: dir });
  assert.deepStrictEqual([...out], ['ai/WORKFLOW.md']);
});

test('versions: pinAllows reads exact, caret, tilde and >= ranges, and admits when it cannot tell', () => {
  const { pinAllows } = require('../lib/doctor/versions');
  const cases = [
    ['^0.9.0', '0.9.1', true],
    ['^0.9.0', '0.10.0', false], // on 0.x a caret stops at the next minor
    ['^0.9.0', '0.8.9', false],
    ['^1.2.3', '1.9.0', true],
    ['^1.2.3', '2.0.0', false],
    ['^0.0.3', '0.0.4', false],
    ['~0.9.0', '0.9.5', true],
    ['~0.9.0', '0.10.0', false],
    ['>=0.9.0', '0.10.0', true],
    ['0.9.1', '0.9.1', true],
    ['0.9.1', '0.9.2', false],
    ['latest', '0.10.0', true],
    ['*', '0.10.0', true],
    ['^0.9.0 || ^0.10.0', '0.10.0', null],
    ['file:../cairn', '0.10.0', null],
    [null, '0.10.0', null],
  ];
  for (const [pin, version, want] of cases) assert.strictEqual(pinAllows(pin, version), want, `${pin} vs ${version}`);
});

test('upgrade: a pin rewrite quotes the caret, and goes in the section the pin was in', () => {
  const { bumpCommand, shellQuote } = require('../lib/upgrade/cli');
  assert.deepStrictEqual(bumpCommand('npm', '0.10.0'), [
    'npm', ['install', '-D', '@stonepandastudio/cairn@^0.10.0', '--no-audit', '--no-fund'],
  ]);
  assert.deepStrictEqual(bumpCommand('pnpm', '0.10.0', false), ['pnpm', ['add', '@stonepandastudio/cairn@^0.10.0']]);
  assert.deepStrictEqual(bumpCommand('yarn', '0.10.0'), ['yarn', ['add', '-D', '@stonepandastudio/cairn@^0.10.0']]);
  assert.strictEqual(shellQuote('@stonepandastudio/cairn@^0.10.0'), '"@stonepandastudio/cairn@^0.10.0"');
  assert.strictEqual(shellQuote('--no-audit'), '--no-audit');
});

// A one-repo workspace whose pin (^0.9.0) cannot reach the running cairn, with a
// fake install so no package manager is ever invoked on the blocked path.
function pinnedWorkspace() {
  const root = tmpRepo();
  const repo = path.join(root, 'backend');
  const pkgDir = path.join(repo, 'node_modules/@stonepandastudio/cairn');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@stonepandastudio/cairn', version: '0.9.1' }));
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ devDependencies: { '@stonepandastudio/cairn': '^0.9.0' } }));
  fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify({ repos: [{ name: 'backend', path: 'backend' }] }));
  return { root, repo, config: path.join(root, 'repos.json') };
}

function captureLog(fn) {
  const lines = [];
  const log = console.log;
  const write = process.stdout.write;
  console.log = (...a) => lines.push(a.join(' '));
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try {
    return { result: fn(), out: lines.join('\n') };
  } finally {
    console.log = log;
    process.stdout.write = write;
  }
}

test('upgrade: a repo whose pin excludes the running cairn is blocked, not reported as clean', () => {
  const { main } = require('../lib/upgrade/cli');
  const ws = pinnedWorkspace();
  const before = fs.readFileSync(path.join(ws.repo, 'package.json'), 'utf8');

  const report = captureLog(() => main(['--config', ws.config, '--no-color']));
  assert.strictEqual(report.result, 0);
  assert.match(report.out, /pin blocks/);
  assert.match(report.out, /--bump-pin/);

  const applied = captureLog(() => main(['--config', ws.config, '--no-color', '--apply']));
  assert.strictEqual(applied.result, 1, 'a blocked repo is a failed upgrade, not a clean one');
  assert.match(applied.out, /blocked/);
  assert.match(applied.out, /does not allow/);
  assert.ok(!/clean/.test(applied.out), 'no reassuring "clean" for a sync that never ran');
  assert.ok(!/\(current\)/.test(applied.out));
  assert.strictEqual(fs.readFileSync(path.join(ws.repo, 'package.json'), 'utf8'), before, 'the pin is untouched without --bump-pin');
});

test('render and workspace upgrade refresh Codex files and leave a repo-owned AGENTS.md alone', () => {
  const { main: render } = require('../lib/render/cli');
  const { main: upgrade } = require('../lib/upgrade/cli');
  const { readManifest, record, writeManifest, writeBase } = require('../lib/manifest');
  const root = tmpRepo();
  const repo = path.join(root, 'backend');
  const workspace = path.join(root, 'repos.json');
  const rel = '.agents/skills/create-brief/SKILL.md';
  const skill = path.join(repo, rel);
  fs.mkdirSync(repo);
  fs.writeFileSync(workspace, JSON.stringify({ repos: [{ name: 'backend', path: 'backend' }] }));
  fs.writeFileSync(path.join(repo, 'cairn.config.json'), JSON.stringify({ codexSkills: true }));
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'Repo-owned guide\n');
  const renderArgs = ['--repo', repo, '--no-color'];
  const upgradeArgs = ['--config', workspace, '--no-color'];
  assert.strictEqual(captureLog(() => render(renderArgs)).result, 0);
  const expected = fs.readFileSync(skill, 'utf8');
  const stale = () => {
    const manifest = readManifest(repo);
    fs.writeFileSync(skill, 'Old skill\n');
    writeBase(repo, rel, 'Old skill\n');
    record(manifest, rel, manifest.files[rel].source, 'Old skill\n');
    writeManifest(repo, manifest);
  };

  stale();
  const preview = captureLog(() => render([...renderArgs, '--dry-run']));
  assert.strictEqual(preview.result, 0);
  assert.strictEqual(fs.readFileSync(skill, 'utf8'), 'Old skill\n');
  assert.strictEqual(captureLog(() => render(renderArgs)).result, 0);
  assert.strictEqual(fs.readFileSync(skill, 'utf8'), expected);

  stale();
  fs.writeFileSync(skill, 'Local skill edit\n');
  assert.strictEqual(captureLog(() => render(renderArgs)).result, 0);
  assert.strictEqual(fs.readFileSync(skill, 'utf8'), 'Local skill edit\n');

  stale();
  const report = captureLog(() => upgrade(upgradeArgs));
  assert.match(report.out, /note: backend: "codexSkills" is deprecated/);
  const applied = captureLog(() => upgrade([...upgradeArgs, '--apply']));
  assert.strictEqual(applied.result, 0, applied.out);
  assert.strictEqual(fs.readFileSync(skill, 'utf8'), expected);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), 'Repo-owned guide\n');
});

test('older repos: a config without `hosts` renders Claude only, and a codexSkills one keeps working with a deprecation note', () => {
  const { main: render } = require('../lib/render/cli');
  const { main: sync } = require('../lib/sync/cli');
  const { main: doctor } = require('../lib/doctor');
  const root = tmpRepo();
  const mk = (name, cfg) => {
    const repo = path.join(root, name);
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'cairn.config.json'), JSON.stringify({ cairn: '0.14.2', stack: ['nestjs'], tracker: { provider: 'none' }, ...cfg }));
    return repo;
  };
  const old = mk('old', {});
  const oldCodex = mk('old-codex', { codexSkills: true });
  for (const repo of [old, oldCodex]) assert.strictEqual(captureLog(() => render(['--repo', repo, '--no-color'])).result, 0);

  // nothing about hosts is added or required: the repo is still Claude only, and sync is quiet about it
  assert.ok(!fs.existsSync(path.join(old, '.agents')) && !fs.existsSync(path.join(old, 'AGENTS.md')));
  const quiet = captureLog(() => sync(['--repo', old, '--no-color']));
  assert.strictEqual(quiet.result, 0, quiet.out);
  assert.doesNotMatch(quiet.out, /deprecated/);

  // a repo that used codexSkills keeps its skills and is told the new spelling, without being rewritten
  const before = fs.readFileSync(path.join(oldCodex, 'cairn.config.json'), 'utf8');
  assert.ok(fs.existsSync(path.join(oldCodex, '.agents', 'skills', 'plan-task', 'SKILL.md')));
  const noted = captureLog(() => sync(['--repo', oldCodex, '--no-color']));
  assert.strictEqual(noted.result, 0, noted.out);
  assert.match(noted.out, /"codexSkills" is deprecated — use "hosts": \["claude","codex"\]/);
  assert.strictEqual(fs.readFileSync(path.join(oldCodex, 'cairn.config.json'), 'utf8'), before, 'the config is never rewritten');
  assert.match(captureLog(() => render(['--repo', oldCodex, '--no-color'])).out, /note: "codexSkills" is deprecated/);

  fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify({ repos: [{ name: 'old', path: 'old' }, { name: 'old-codex', path: 'old-codex' }] }));
  const diag = captureLog(() => doctor(['--config', path.join(root, 'repos.json'), '--no-color']));
  assert.match(diag.out, /old-codex: "codexSkills" is deprecated/);
  assert.doesNotMatch(diag.out, /old: "codexSkills"/);
});

test('upgrade: picks the package manager from the lockfile and builds the update command', () => {
  const { packageManager, updateCommand, parseArgs } = require('../lib/upgrade/cli');
  const dir = tmpRepo();
  assert.strictEqual(packageManager(dir), 'npm');
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
  assert.strictEqual(packageManager(dir), 'yarn');
  assert.deepStrictEqual(updateCommand('yarn'), ['yarn', ['upgrade', '@stonepandastudio/cairn']]);
  assert.strictEqual(updateCommand('npm')[1][0], 'update');
  assert.strictEqual(parseArgs(['--apply', '--repo', 'a', '--repo', 'b']).only.length, 2);
  assert.strictEqual(parseArgs(['--nope']).error, 2);
});

test('workspace cmd: add / remove / list edit only the repos list and keep the rest of repos.json', () => {
  const { main } = require('../lib/workspace/cli');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-wscmd-'));
  const a = path.join(root, 'api');
  const b = path.join(root, 'web');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, 'cairn.config.json'), JSON.stringify({ stack: ['react'], tracker: { provider: 'none' } }));
  const file = path.join(root, 'repos.json');
  const quiet = (fn) => {
    const log = console.log;
    const err = console.error;
    console.log = console.error = () => {};
    try {
      return fn();
    } finally {
      console.log = log;
      console.error = err;
    }
  };
  const run = (...argv) => quiet(() => main([...argv, '--config', file]));

  assert.strictEqual(run('add', a), 2, 'no cairn.config.json and no --stack');
  assert.strictEqual(run('add', a, '--stack', 'nestjs,typeorm', '--role', 'REST API'), 0, 'creates the file');
  assert.strictEqual(run('add', b), 0, 'stack read from the repo config');
  assert.strictEqual(run('add', b), 2, 'duplicate');
  assert.strictEqual(run('add', path.join(root, 'nope'), '--stack', 'react'), 2, 'missing dir');
  assert.strictEqual(run('add', a, '--name', 'x', '--stack', 'not-a-preset'), 2, 'unknown stack');

  let cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(cfg.repos, [
    { name: 'api', path: 'api', stack: ['nestjs', 'typeorm'], role: 'REST API' },
    { name: 'web', path: 'web', stack: ['react'] },
  ]);

  cfg.shared = [{ glob: 'ai/*.md', cohort: 'all' }];
  cfg.$comment = 'hand written';
  fs.writeFileSync(file, JSON.stringify(cfg));
  assert.strictEqual(run('remove', 'api'), 0);
  assert.strictEqual(run('remove', 'api'), 2, 'already gone');
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(cfg.repos.map((r) => r.name), ['web']);
  assert.deepStrictEqual(cfg.shared, [{ glob: 'ai/*.md', cohort: 'all' }]);
  assert.strictEqual(cfg.$comment, 'hand written');
  assert.strictEqual(run('list'), 0);

  // the result is still a file doctor can resolve
  const { resolveRepos } = require('../lib/doctor');
  assert.strictEqual(resolveRepos(cfg, root)[0].name, 'web');
});

// ------------------------------------------------------- context/codesource

const codesource = require('../lib/context/codesource');
const { spawnSync } = require('child_process');

// A stand-in for `codebase-memory-mcp cli --json <tool>`: reads JSON args on stdin,
// answers in the same envelope shape, and logs every call into the repo's cache dir
// (CBM_CACHE_DIR) so tests can count spawns.
const FAKE_CBM = `
const fs = require('fs');
const path = require('path');
const tool = process.argv[process.argv.indexOf('--json') + 1];
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const args = input ? JSON.parse(input) : {};
  fs.mkdirSync(process.env.CBM_CACHE_DIR, { recursive: true });
  fs.appendFileSync(path.join(process.env.CBM_CACHE_DIR, 'calls.log'), tool + '\\n');
  let out;
  if (tool === 'index_repository') out = { project: 'fake-proj', nodes: 3 };
  else if (tool === 'get_architecture') out = { project: args.project, total_nodes: 3 };
  else if (tool === 'search_graph') {
    const rows = [];
    if (args.name_pattern === '^Invoice$') rows.push(['Invoice', 'Interface', '4-15', 2, 0]);
    if (args.name_pattern === '^Heading$') rows.push(['Heading', 'Section', '1-2', 0, 0]);
    out = { cols: ['name', 'label', 'lines', 'in', 'out'], groups: rows.length ? [{ file: 'src/a.ts', rows }] : [], total: rows.length };
  } else out = { error: 'unknown tool ' + tool };
  process.stdout.write(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false }));
});
`;

function codeFixture() {
  const ws = tmpRepo();
  const repoPath = path.join(ws, 'backend');
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'src', 'a.ts'), 'export interface Invoice {}\n');
  const fake = path.join(ws, 'fake-cbm.js');
  fs.writeFileSync(fake, FAKE_CBM);
  const repo = { name: 'backend', path: repoPath };
  const config = { command: process.execPath, args: [fake], version: '1.0.0' };
  const calls = () => {
    try {
      return fs.readFileSync(path.join(repoPath, '_cairn', 'cache', 'calls.log'), 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  return { ws, repo, repoPath, config, calls, make: (cfg = config) => codesource.createCodeSource({ config: cfg, workspaceDir: ws }) };
}

test('codesource: runner resolution — explicit command, workspace install, opt-in PATH, else none', () => {
  const ws = tmpRepo();
  assert.strictEqual(codesource.resolveRunner({}, ws), null, 'nothing installed, nothing configured');
  assert.strictEqual(codesource.resolveRunner({ allowGlobal: true }, ws).source, 'path');
  assert.strictEqual(codesource.resolveRunner({ command: 'x', args: ['y'] }, ws).source, 'config');

  const bin = path.join(codesource.toolDir(ws), 'node_modules', 'codebase-memory-mcp');
  fs.mkdirSync(path.join(bin, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'bin', process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp'), '');
  fs.writeFileSync(path.join(bin, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  const r = codesource.resolveRunner({}, ws);
  assert.strictEqual(r.source, 'workspace');
  assert.strictEqual(r.version, '9.9.9');
});

atest('codesource: not installed is `unknown` with a hint — never a throw', async () => {
  const { repo, make } = codeFixture();
  const src = make({});
  assert.strictEqual(src.available(), false);
  const res = await src.symbol(repo, 'Invoice');
  assert.strictEqual(res.status, 'unknown');
  assert.ok(/cairn context setup/.test(res.hint));
});

atest('codesource: symbol found / missing, and a markdown Section never counts as a symbol', async () => {
  const { repo, make } = codeFixture();
  const src = make();
  const found = await src.symbol(repo, 'Invoice');
  assert.strictEqual(found.status, 'found');
  assert.strictEqual(found.matches[0].label, 'Interface');
  assert.strictEqual(found.matches[0].file, 'src/a.ts');
  assert.strictEqual((await src.symbol(repo, 'Nope')).status, 'missing');
  assert.strictEqual((await src.symbol(repo, 'Heading')).status, 'missing', 'a Section node is not code');
});

atest('codesource: the fingerprint gate indexes once, then only when the code or tool version changes', async () => {
  const { repo, repoPath, config, calls, make } = codeFixture();
  const indexCount = () => calls().filter((c) => c === 'index_repository').length;

  await make().symbol(repo, 'Invoice');
  assert.strictEqual(indexCount(), 1, 'first query indexes');

  const again = await make().symbol(repo, 'Invoice'); // a fresh process: no in-memory memo
  assert.strictEqual(again.reindexed, false);
  assert.strictEqual(indexCount(), 1, 'unchanged code is not re-indexed');

  const file = path.join(repoPath, 'src', 'a.ts');
  fs.writeFileSync(file, 'export interface Invoice { id: string }\n');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(file, future, future);
  await make().symbol(repo, 'Invoice');
  assert.strictEqual(indexCount(), 2, 'an edited file triggers a re-index');

  await make({ ...config, version: '2.0.0' }).symbol(repo, 'Invoice');
  assert.strictEqual(indexCount(), 3, 'a different tool version re-indexes');
});

atest('codesource: the index folder does not invalidate its own fingerprint (git repo)', async () => {
  const { repo, repoPath, calls, make } = codeFixture();
  const git = (...a) => spawnSync('git', ['-C', repoPath, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  if (git('init', '-q').status !== 0) return; // no git on this machine — nothing to assert
  git('add', '-A');
  git('commit', '-q', '-m', 'init');

  await make().symbol(repo, 'Invoice'); // writes _cairn/cache/** into the working tree
  const before = codesource.fingerprint(repoPath);
  await make().symbol(repo, 'Invoice');
  assert.strictEqual(codesource.fingerprint(repoPath), before, 'cache churn must not change the fingerprint');
  assert.strictEqual(calls().filter((c) => c === 'index_repository').length, 1);

  // re-editing an already-dirty file must still be noticed (status text alone would not change)
  const file = path.join(repoPath, 'src', 'a.ts');
  fs.writeFileSync(file, 'export interface Invoice { a: 1 }\n');
  const f1 = codesource.fingerprint(repoPath);
  fs.writeFileSync(file, 'export interface Invoice { a: 1; b: 2 }\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  assert.notStrictEqual(codesource.fingerprint(repoPath), f1);
});

test('context: check computes BROKEN_ANCHOR through the resolver; unknown is listed, never a finding', () => {
  const backend = tmpRepo();
  writeCtx(backend, 'ai/contexts/entities/invoice.md', '---\ndescribes: entity Invoice\n---\n# Invoice\n');
  writeCtx(backend, 'ai/contexts/entities/ghost.md', '---\ndescribes: entity Ghost\n---\n# Ghost\n');
  writeCtx(backend, 'ai/contexts/entities/odd.md', '---\ndescribes: entity Odd\n---\n# Odd\n');
  const graph = context.build([{ name: 'backend', path: backend }]);

  const resolveAnchor = (repo, name) => (name === 'Invoice' ? { status: 'found' } : name === 'Ghost' ? { status: 'missing' } : { status: 'unknown', reason: 'tool down' });
  const result = context.check(graph, { resolveAnchor });

  const broken = result.findings.filter((f) => f.type === 'BROKEN_ANCHOR');
  assert.strictEqual(broken.length, 1);
  assert.ok(broken[0].id.endsWith('ghost.md'));
  assert.strictEqual(result.unknownAnchors.length, 1);
  assert.ok(!result.notChecked.includes('BROKEN_ANCHOR'));

  const plain = context.check(graph);
  assert.ok(plain.notChecked.includes('BROKEN_ANCHOR'), 'without a resolver it stays unchecked, as before');
  assert.strictEqual(plain.findings.filter((f) => f.type === 'BROKEN_ANCHOR').length, 0);
});

test('codesource: setup gitignores the tool folder and each repo cache, idempotently', () => {
  const ws = tmpRepo();
  fs.mkdirSync(path.join(ws, '.git'));
  const repoPath = path.join(ws, 'backend');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  const plainRepo = path.join(ws, 'docs'); // not a git repo — must be left alone
  fs.mkdirSync(plainRepo);

  const repos = [{ name: 'backend', path: repoPath }, { name: 'docs', path: plainRepo }];
  const first = codesource.setup({ workspaceDir: ws, repos, install: false });
  assert.strictEqual(first.ignored.length, 2);
  assert.ok(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8').includes('_cairn/tools/'));
  assert.ok(fs.readFileSync(path.join(repoPath, '.gitignore'), 'utf8').includes('_cairn/cache/'));
  assert.ok(!fs.existsSync(path.join(plainRepo, '.gitignore')));

  assert.strictEqual(codesource.setup({ workspaceDir: ws, repos, install: false }).ignored.length, 0, 'second run changes nothing');
  assert.throws(() => codesource.setup({ workspaceDir: ws, repos, version: '^1.0.0', install: false }), /exact version/);
});

// ------------------------------------------------- context/codesource registry

// A language-neutral stand-in provider: serves `references` (which the real code-graph
// provider deliberately does not) so routing can be tested without any real tool.
function fakeProvider(id, { caps = ['references'], available = true, answers = {} } = {}) {
  return {
    id,
    capabilities: caps,
    create: ({ config }) => ({
      id,
      config,
      available: () => available,
      symbol: (repo, name) => ({ status: 'found', via: id, name, ...answers }),
      references: (repo, p) => ({ status: 'ok', via: id, symbolPath: p, references: [{ file: 'a.x' }] }),
      summary: () => ({ status: 'ok', via: id }),
    }),
  };
}

atest('codesource registry: the default routing sends symbols/summary to the code-graph provider and leaves references unrouted', async () => {
  const { make } = codeFixture();
  const src = make();
  assert.deepStrictEqual(src.describe(), { symbols: 'codebase-memory-mcp', references: null, summary: 'codebase-memory-mcp' });
  assert.strictEqual(src.available('symbols'), true);
  assert.strictEqual(src.available('references'), false);
  const res = await src.references({ name: 'backend', path: '/x' }, 'Class/method');
  assert.strictEqual(res.status, 'unknown', 'a capability with no provider is unknown, not an error');
  assert.ok(/references/.test(res.reason));
});

atest('codesource registry: a registered provider answers its capability; routing config overrides the default', async () => {
  const { repo, make } = codeFixture();
  const unregister = codesource.registerProvider(fakeProvider('fake-refs'));
  try {
    const src = make();
    assert.strictEqual(src.describe().references, 'fake-refs', 'only provider with the capability is picked up with no config');
    assert.strictEqual((await src.references(repo, 'A/b')).via, 'fake-refs');

    // explicit route: symbols to the fake, the rest untouched
    const routed = codesource.createCodeSource({
      config: { command: process.execPath, args: [], version: '1', providers: { symbols: 'fake-refs' } },
      workspaceDir: repo.path,
    });
    // fake-refs declares only `references`, so routing symbols to it is a configuration error — reported, not thrown
    const bad = await routed.symbol(repo, 'X');
    assert.strictEqual(bad.status, 'unknown');
    assert.ok(/does not provide symbols/.test(bad.reason));
  } finally {
    unregister();
  }
});

atest('codesource registry: an unknown provider name in routing is reported as unknown with a hint', async () => {
  const { repo } = codeFixture();
  const src = codesource.createCodeSource({ config: { providers: { summary: 'nope' } }, workspaceDir: repo.path });
  const res = await src.summary(repo);
  assert.strictEqual(res.status, 'unknown');
  assert.ok(/unknown provider "nope"/.test(res.reason));
  assert.ok(/codeSource\.providers/.test(res.hint));
});

atest('codesource registry: provider settings come from a keyed block or, for compatibility, the flat legacy shape', async () => {
  const ws = tmpRepo();
  const seen = [];
  const unregister = codesource.registerProvider({
    id: 'probe',
    capabilities: ['summary'],
    create: ({ config }) => { seen.push(config); return { id: 'probe', available: () => true, summary: () => ({ status: 'ok' }) }; },
  });
  try {
    await codesource.createCodeSource({ config: { providers: { summary: 'probe' }, probe: { flag: 1 } }, workspaceDir: ws }).summary({ name: 'r', path: ws });
    assert.deepStrictEqual(seen[0], { flag: 1 }, 'keyed block reaches its provider');
  } finally {
    unregister();
  }

  // the flat shape still configures codebase-memory-mcp (what the earlier releases read)
  const { repo, config, make } = codeFixture();
  assert.strictEqual((await make(config).symbol(repo, 'Invoice')).status, 'found');
  const keyed = make({ 'codebase-memory-mcp': config });
  assert.strictEqual((await keyed.symbol(repo, 'Invoice')).status, 'found', 'and so does the keyed form');
});

test('codesource registry: a malformed provider is rejected at registration', () => {
  assert.throws(() => codesource.registerProvider({ id: 'x' }), /needs a string `id` and a `create`/);
  assert.throws(() => codesource.registerProvider({ id: 'x', create() {}, capabilities: ['telepathy'] }), /subset of/);
  assert.throws(() => codesource.registerProvider({ id: 'x', create() {}, capabilities: [] }), /non-empty/);
});

// ----------------------------------------------------- context/serena provider

// A stand-in for `serena start-mcp-server`: a newline-JSON-RPC MCP server over stdio with a
// tiny canned project. Logs every start and tool call (FAKE_LOG) so tests can count them.
// `Crash` makes the first call die (then behave); `Hang` never answers. It exits on stdin
// EOF, as the real Serena does.
const FAKE_SERENA = `
const fs = require('fs');
const log = (o) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(o) + '\\n');
log({ ev: 'start', pid: process.pid, args: process.argv.slice(2) });
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
const text = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
const SYMS = {
  'Invoice': [{ name_path: 'Invoice', kind: 'Class', relative_path: 'src\\\\a.ts', body_location: { start_line: 1, end_line: 5 } }],
  'Svc/pay': [{ name_path: 'Svc/pay', kind: 'Method', relative_path: 'src\\\\svc.ts', body_location: { start_line: 3, end_line: 9 } }],
  'Other/pay': [{ name_path: 'Other/pay', kind: 'Method', relative_path: 'src\\\\other.ts', body_location: { start_line: 1, end_line: 2 } }],
};
SYMS['pay'] = [...SYMS['Svc/pay'], ...SYMS['Other/pay']];
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'Serena' } });
    else if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params;
      log({ ev: 'call', name, args: a });
      if (name === 'find_symbol') {
        const p = a.name_path_pattern;
        if (p === 'Crash' && !fs.existsSync(process.env.FAKE_MARKER)) { fs.writeFileSync(process.env.FAKE_MARKER, '1'); process.exit(1); }
        if (p === 'Hang') continue;
        let list = SYMS[p] || [];
        if (a.relative_path) list = list.filter((s) => s.relative_path.replace(/\\\\/g, '/') === a.relative_path);
        send(m.id, text(list));
      } else if (name === 'find_referencing_symbols') {
        send(m.id, text(a.name_path === 'Svc/pay' ? {
          'src\\\\ctl.ts': { Method: [{ name_path: 'Ctl/run', body_location: { start_line: 2, end_line: 4 }, content_around_reference: '> 3: svc.pay()' }] },
          'src\\\\svc.spec.ts': { Function: [{ name_path: 'it callback', body_location: { start_line: 1, end_line: 2 }, content_around_reference: 'x' }] },
        } : {}));
      } else send(m.id, { isError: true, content: [{ type: 'text', text: 'Error: unexpected tool ' + name }] });
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`;

function serenaFixture(overrides = {}) {
  const ws = tmpRepo();
  const repoPath = path.join(ws, 'backend');
  fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
  const fake = path.join(ws, 'fake-serena.js');
  fs.writeFileSync(fake, FAKE_SERENA);
  const logFile = path.join(ws, 'fake.log');
  const serena = { command: process.execPath, args: [fake], version: '1', env: { FAKE_LOG: logFile, FAKE_MARKER: path.join(ws, 'crashed') }, ...overrides };
  const repo = { name: 'backend', path: repoPath };
  const make = () => codesource.createCodeSource({ config: { serena }, workspaceDir: ws });
  const log = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { ws, repo, repoPath, make, log };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await new Promise((r) => setTimeout(r, 25)); } return cond(); };

atest('serena: a JS/TS repo without node_modules gets a note on every answer; with it, none', async () => {
  const { repo, repoPath, make } = serenaFixture();
  const src = make();
  try {
    fs.writeFileSync(path.join(repoPath, 'package.json'), '{}');
    const bare = await src.symbol(repo, 'Invoice');
    assert.ok(bare.notes && /node_modules/.test(bare.notes[0]), 'warned about missing dependencies');
    assert.ok((await src.references(repo, 'Svc/pay')).notes, 'references carries the note too');
    fs.mkdirSync(path.join(repoPath, 'node_modules'));
    assert.strictEqual((await src.symbol(repo, 'Invoice')).notes, undefined);
  } finally {
    await src.close();
  }
});

atest('serena: starts lazily on the first question and is reused afterwards', async () => {
  const { repo, make, log } = serenaFixture();
  const src = make();
  try {
    assert.strictEqual(log().length, 0, 'nothing is spawned until something is asked');
    assert.strictEqual(src.available('references'), true);
    await src.symbol(repo, 'Invoice');
    await src.symbol(repo, 'Invoice');
    await src.references(repo, 'Svc/pay');
    assert.strictEqual(log().filter((e) => e.ev === 'start').length, 1, 'one long-lived process for the repo');
    assert.ok(log()[0].args.includes('start-mcp-server') && log()[0].args.includes(repo.path.replace(/\\/g, '/')), 'started on this repo');
    assert.ok(log()[0].args.includes('tools'), 'asks for one tool per operation (--agent-interface tools)');
  } finally {
    await src.close();
  }
});

atest('serena: symbol answers are language-neutral shapes (paths posix, lines, label)', async () => {
  const { repo, make } = serenaFixture();
  const src = make();
  try {
    const found = await src.symbol(repo, 'Invoice');
    assert.strictEqual(found.status, 'found');
    assert.deepStrictEqual(found.matches[0], { name: 'Invoice', namePath: 'Invoice', label: 'Class', file: 'src/a.ts', lines: '1-5' });
    assert.strictEqual((await src.symbol(repo, 'Nope')).status, 'missing');
  } finally {
    await src.close();
  }
});

atest('serena: references resolve the symbol first, omit test files by default, and can include them', async () => {
  const { repo, make } = serenaFixture();
  const src = make();
  try {
    const res = await src.references(repo, 'Svc/pay');
    assert.strictEqual(res.status, 'ok');
    assert.strictEqual(res.symbol.file, 'src/svc.ts');
    assert.deepStrictEqual(res.references.map((r) => r.file), ['src/ctl.ts']);
    assert.strictEqual(res.testFilesOmitted, 1);
    assert.strictEqual(res.references[0].symbols[0].namePath, 'Ctl/run');
    assert.strictEqual(res.references[0].symbols[0].kind, 'Method');

    const all = await src.references(repo, 'Svc/pay', { includeTests: true });
    assert.deepStrictEqual(all.references.map((r) => r.file), ['src/ctl.ts', 'src/svc.spec.ts']);
    assert.strictEqual(all.testFilesOmitted, 0);

    const limited = await src.references(repo, 'Svc/pay', { includeTests: true, limit: 1 });
    assert.strictEqual(limited.references.length, 1);
    assert.strictEqual(limited.truncated, true);
  } finally {
    await src.close();
  }
});

atest('serena: an ambiguous name returns candidates; { file } pins one; a missing name is `missing`', async () => {
  const { repo, make } = serenaFixture();
  const src = make();
  try {
    const amb = await src.references(repo, 'pay');
    assert.strictEqual(amb.status, 'ambiguous');
    assert.deepStrictEqual(amb.candidates.map((c) => c.file).sort(), ['src/other.ts', 'src/svc.ts']);

    const pinned = await src.references(repo, 'pay', { file: 'src/other.ts' });
    assert.strictEqual(pinned.status, 'ok');
    assert.strictEqual(pinned.symbol.namePath, 'Other/pay');

    assert.strictEqual((await src.references(repo, 'Ghost/none')).status, 'missing');
  } finally {
    await src.close();
  }
});

atest('serena: a process that dies mid-call is restarted once and the call succeeds', async () => {
  const { repo, make, log } = serenaFixture();
  const src = make();
  try {
    const res = await src.symbol(repo, 'Crash'); // the fake exits on the first Crash call
    assert.strictEqual(res.status, 'missing', 'the retry on a fresh process was answered');
    const starts = log().filter((e) => e.ev === 'start');
    assert.strictEqual(starts.length, 2, 'restarted exactly once');
    assert.notStrictEqual(starts[0].pid, starts[1].pid);
  } finally {
    await src.close();
  }
});

atest('serena: a hung call times out as `unknown`, its process is killed, and the next call starts clean', async () => {
  const { repo, make, log } = serenaFixture({ timeoutMs: 400, firstCallTimeoutMs: 400 });
  const src = make();
  try {
    const res = await src.symbol(repo, 'Hang');
    assert.strictEqual(res.status, 'unknown');
    assert.ok(/timed out/.test(res.reason), res.reason);
    const hungPid = log().find((e) => e.ev === 'start').pid;
    assert.ok(await waitFor(() => !alive(hungPid)), 'the hung process was killed');

    assert.strictEqual((await src.symbol(repo, 'Invoice')).status, 'found', 'a fresh process answers');
    assert.strictEqual(log().filter((e) => e.ev === 'start').length, 2);
  } finally {
    await src.close();
  }
});

atest('serena: close() stops the process (stdin EOF), and is safe to call twice', async () => {
  const { repo, make, log } = serenaFixture();
  const src = make();
  await src.symbol(repo, 'Invoice');
  const pid = log().find((e) => e.ev === 'start').pid;
  assert.ok(alive(pid));
  await src.close();
  assert.ok(await waitFor(() => !alive(pid)), 'no process left behind');
  await src.close();
});

atest('serena: read-only — only find_symbol / find_referencing_symbols are ever called', async () => {
  const { repo, make, log } = serenaFixture();
  const src = make();
  try {
    await src.symbol(repo, 'Invoice');
    await src.references(repo, 'Svc/pay');
    await src.references(repo, 'pay');
    const names = new Set(log().filter((e) => e.ev === 'call').map((e) => e.name));
    assert.deepStrictEqual([...names].sort(), ['find_referencing_symbols', 'find_symbol']);
    const serena = require('../lib/context/providers/serena');
    for (const n of names) assert.ok(serena.READ_ONLY_TOOLS.includes(n), `${n} is in the read-only set`);
  } finally {
    await src.close();
  }
});

atest('serena: not installed is `unknown` with a hint and nothing is spawned', async () => {
  const ws = tmpRepo();
  const src = codesource.createCodeSource({ config: {}, workspaceDir: ws });
  assert.strictEqual(src.available('references'), false);
  const res = await src.references({ name: 'r', path: ws }, 'A/b');
  assert.strictEqual(res.status, 'unknown');
  assert.ok(/no code provider available for references/.test(res.reason));
  assert.ok(/cairn context setup/.test(res.hint));
});

test('serena: test-file heuristic is provider-owned and covers common conventions', () => {
  const { isTestPath } = require('../lib/context/providers/serena');
  for (const p of ['src/a.spec.ts', 'src/a.test.tsx', 'test/x.ts', 'src/__tests__/a.ts', 'src/test/java/FooTest.java', 'Billing.Tests/InvoiceTests.cs', 'pkg/a_test.go', 'tests/test_a.py', 'e2e/login.ts']) {
    assert.ok(isTestPath(p), `${p} is a test`);
  }
  for (const p of ['src/a.ts', 'src/contest.ts', 'src/main/java/Foo.java', 'src/Invoice.cs', 'src/latest/a.ts']) {
    assert.ok(!isTestPath(p), `${p} is not a test`);
  }
});

test('serena: setup — exact version required, Python prerequisite reported, ignores written idempotently', () => {
  const serena = require('../lib/context/providers/serena');
  const ws = tmpRepo();
  fs.mkdirSync(path.join(ws, '.git'));
  const repoPath = path.join(ws, 'backend');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  const plain = path.join(ws, 'docs');
  fs.mkdirSync(plain);
  const repos = [{ name: 'backend', path: repoPath }, { name: 'docs', path: plain }];

  assert.throws(() => serena.setup({ workspaceDir: ws, repos, version: '^2.1.0', install: false }), /exact version/);
  try {
    serena.setup({ workspaceDir: ws, repos, python: 'definitely-not-a-python' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.code, 'prerequisite');
    assert.ok(/needs Python 3\.11–3\.14/.test(err.message), err.message);
  }

  const first = serena.setup({ workspaceDir: ws, repos, install: false });
  assert.strictEqual(first.ignored.length, 2);
  assert.ok(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8').includes('_cairn/tools/'));
  assert.ok(fs.readFileSync(path.join(repoPath, '.gitignore'), 'utf8').includes('.serena/'));
  assert.ok(!fs.existsSync(path.join(plain, '.gitignore')), 'a non-git repo is left alone');
  assert.strictEqual(serena.setup({ workspaceDir: ws, repos, install: false }).ignored.length, 0);
});

// ------------------------------------------------------- context/serve (MCP)

const { createServer } = require('../lib/context/serve');

function serveFixture({ withCode = true, withSerena = false } = {}) {
  const ws = tmpRepo();
  const backend = path.join(ws, 'backend');
  const frontend = path.join(ws, 'frontend');
  fs.mkdirSync(path.join(backend, 'src'), { recursive: true });
  fs.writeFileSync(path.join(backend, 'src', 'a.ts'), 'export class Invoice {}\n');
  writeCtx(backend, 'ai/contexts/entities/invoice.md', '---\ncounterpartOf: frontend:ai/contexts/entities/invoice.md\ndescribes: entity Invoice\n---\n# Invoice (backend)\n');
  writeCtx(backend, 'ai/contexts/entities/ghost.md', '---\ndescribes: entity Ghost\n---\n# Ghost\n');
  writeCtx(frontend, 'ai/contexts/entities/invoice.md', '---\n---\n# Invoice (frontend)\nfrontend body text\n');

  const fake = path.join(ws, 'fake-cbm.js');
  fs.writeFileSync(fake, FAKE_CBM);
  const codeSource = withCode ? { command: process.execPath, args: [fake], version: '1.0.0' } : {};
  const serenaLog = path.join(ws, 'fake-serena.log');
  if (withSerena) {
    const fakeSerena = path.join(ws, 'fake-serena.js');
    fs.writeFileSync(fakeSerena, FAKE_SERENA);
    codeSource.serena = { command: process.execPath, args: [fakeSerena], version: '1', env: { FAKE_LOG: serenaLog, FAKE_MARKER: path.join(ws, 'crashed') } };
  }
  const raw = { repos: [], ...(Object.keys(codeSource).length ? { codeSource } : {}) };
  fs.writeFileSync(path.join(ws, 'repos.json'), JSON.stringify({ ...raw, repos: [{ name: 'backend', path: './backend' }, { name: 'frontend', path: './frontend' }] }));

  const repos = [{ name: 'backend', path: backend }, { name: 'frontend', path: frontend }];
  const server = createServer({ load: () => ({ raw, repos, workspaceDir: ws }) });
  let id = 0;
  const rpc = (method, params) => server.handle({ jsonrpc: '2.0', id: ++id, method, params });
  const call = async (name, args = {}) => {
    const res = (await rpc('tools/call', { name, arguments: args })).result;
    const text = res.content[0].text;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { isError: Boolean(res.isError), data };
  };
  const serenaEvents = () => (fs.existsSync(serenaLog) ? fs.readFileSync(serenaLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { ws, server, rpc, call, serenaEvents };
}

atest('serve: handshake, tool list, ping, notifications, and JSON-RPC errors', async () => {
  const { server, rpc } = serveFixture();
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't' } });
  assert.strictEqual(init.result.protocolVersion, '2024-11-05', 'echoes a supported version');
  assert.deepStrictEqual(init.result.capabilities, { tools: {} });
  assert.strictEqual((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18', 'unsupported version falls back to ours');

  assert.strictEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification gets no response');
  assert.deepStrictEqual((await rpc('ping')).result, {});
  assert.deepStrictEqual(
    (await rpc('tools/list')).result.tools.map((t) => t.name),
    ['list_contexts', 'counterparts', 'check', 'code_summary', 'code_symbol', 'code_references'],
  );
  assert.strictEqual((await rpc('nope')).error.code, -32601);
  assert.strictEqual((await rpc('tools/call', { name: 'nope' })).error.code, -32602);
  assert.strictEqual(JSON.parse(await server.handleLine('{not json')).error.code, -32700);
  assert.strictEqual(JSON.parse(await server.handleLine('[]')).error.code, -32600, 'batching is rejected, not mishandled');
  assert.strictEqual(await server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null);
});

atest('serve: counterparts returns the other repo\'s document content, so it need not be opened', async () => {
  const { call } = serveFixture();
  const res = await call('counterparts', { id: 'backend:ai/contexts/entities/invoice.md' });
  assert.strictEqual(res.isError, false);
  assert.strictEqual(res.data.counterparts.length, 1);
  assert.strictEqual(res.data.counterparts[0].id, 'frontend:ai/contexts/entities/invoice.md');
  assert.ok(res.data.counterparts[0].content.includes('frontend body text'));

  // the reverse edge is inferred
  const back = await call('counterparts', { id: 'frontend:ai/contexts/entities/invoice.md' });
  assert.strictEqual(back.data.counterparts[0].inferred, true);

  assert.strictEqual((await call('counterparts', { id: 'backend:ai/contexts/entities/nope.md' })).isError, true);
  assert.strictEqual((await call('counterparts', {})).isError, true);
});

atest('serve: list_contexts lists nodes and filters by repo; an unknown repo is a tool error', async () => {
  const { call } = serveFixture();
  const all = await call('list_contexts');
  assert.deepStrictEqual(all.data.repos, ['backend', 'frontend']);
  assert.strictEqual(all.data.count, 3);
  assert.strictEqual((await call('list_contexts', { repo: 'frontend' })).data.count, 1);
  const bad = await call('list_contexts', { repo: 'nope' });
  assert.strictEqual(bad.isError, true);
  assert.ok(/Known: backend, frontend/.test(bad.data));
});

atest('serve: code_symbol / code_summary go through the codeSource; check code=true computes BROKEN_ANCHOR', async () => {
  const { call, server } = serveFixture();
  assert.strictEqual((await call('code_symbol', { repo: 'backend', name: 'Invoice' })).data.status, 'found');
  assert.strictEqual((await call('code_symbol', { repo: 'backend', name: 'Nope' })).data.status, 'missing');
  assert.strictEqual((await call('code_summary', { repo: 'backend' })).data.status, 'ok');
  assert.strictEqual((await call('code_symbol', { repo: 'nope', name: 'X' })).isError, true);
  assert.strictEqual((await call('code_symbol', { repo: 'backend' })).isError, true, 'name is required');

  const withCode = (await call('check', { code: true })).data;
  const broken = withCode.findings.filter((f) => f.type === 'BROKEN_ANCHOR');
  assert.strictEqual(broken.length, 1);
  assert.ok(broken[0].id.endsWith('ghost.md'));

  const plain = (await call('check')).data;
  assert.ok(plain.notChecked.includes('BROKEN_ANCHOR'), 'code lookups are opt-in per call');
  await server.close();
});

atest('serve: code_references goes through Serena — test files omitted by default, ambiguity and bad input handled', async () => {
  const { call, server } = serveFixture({ withCode: false, withSerena: true });
  try {
    const res = await call('code_references', { repo: 'backend', symbol: 'Svc/pay' });
    assert.strictEqual(res.isError, false);
    assert.strictEqual(res.data.status, 'ok');
    assert.deepStrictEqual(res.data.references.map((r) => r.file), ['src/ctl.ts']);
    assert.strictEqual(res.data.testFilesOmitted, 1);

    const withTests = await call('code_references', { repo: 'backend', symbol: 'Svc/pay', include_tests: true });
    assert.strictEqual(withTests.data.references.length, 2);

    const limited = await call('code_references', { repo: 'backend', symbol: 'Svc/pay', include_tests: true, limit: 1 });
    assert.strictEqual(limited.data.references.length, 1);
    assert.strictEqual(limited.data.truncated, true);

    const amb = await call('code_references', { repo: 'backend', symbol: 'pay' });
    assert.strictEqual(amb.isError, false, 'ambiguity is an answer, not a tool error');
    assert.strictEqual(amb.data.status, 'ambiguous');
    assert.strictEqual(amb.data.candidates.length, 2);
    assert.strictEqual((await call('code_references', { repo: 'backend', symbol: 'pay', file: 'src/other.ts' })).data.status, 'ok');

    assert.strictEqual((await call('code_references', { repo: 'nope', symbol: 'X' })).isError, true);
    assert.strictEqual((await call('code_references', { repo: 'backend' })).isError, true, 'symbol is required');
  } finally {
    await server.close();
  }
});

atest('serve: code_symbol prefers Serena over the code-graph tool when both are installed, and close() stops Serena', async () => {
  const { call, server, serenaEvents } = serveFixture({ withCode: true, withSerena: true });
  const found = await call('code_symbol', { repo: 'backend', name: 'Invoice' });
  assert.strictEqual(found.data.provider, 'serena', 'symbols are routed to Serena first');
  assert.strictEqual((await call('code_summary', { repo: 'backend' })).data.status, 'ok', 'summary still comes from the code-graph tool');

  const pid = serenaEvents().find((e) => e.ev === 'start').pid;
  assert.ok(alive(pid));
  await server.close();
  assert.ok(await waitFor(() => !alive(pid)), 'closing the server leaves no Serena behind');
});

atest('serve: with no provider at all, code_references is `unknown` + hint — never read as "no references"', async () => {
  const { call, server } = serveFixture({ withCode: false, withSerena: false });
  const res = await call('code_references', { repo: 'backend', symbol: 'A/b' });
  assert.strictEqual(res.isError, false);
  assert.strictEqual(res.data.status, 'unknown');
  assert.ok(/cairn context setup/.test(res.data.hint));
  await server.close();
});

atest('serve: with no code tool installed, code answers are `unknown` + hint, not errors', async () => {
  const { call, server } = serveFixture({ withCode: false });
  const res = await call('code_symbol', { repo: 'backend', name: 'Invoice' });
  assert.strictEqual(res.isError, false);
  assert.strictEqual(res.data.status, 'unknown');
  assert.ok(/cairn context setup/.test(res.data.hint));
  assert.ok((await call('check', { code: true })).data.notChecked.includes('BROKEN_ANCHOR'));
  await server.close();
});

test('serve: real stdio round trip — stdout carries only protocol lines', () => {
  const { ws } = serveFixture();
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_contexts', arguments: {} } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';

  const r = spawnSync(process.execPath, [bin, 'context', 'serve', '--config', path.join(ws, 'repos.json')], { input, encoding: 'utf8', timeout: 30000 });
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 2, `one response per request, none for the notification; got: ${r.stdout}`);
  const [init, list] = lines.map((l) => JSON.parse(l));
  assert.strictEqual(init.id, 1);
  assert.strictEqual(init.result.serverInfo.name, 'cairn-context');
  assert.strictEqual(JSON.parse(list.result.content[0].text).count, 3);
});

// ------------------------------------------------------------- context adopt

const adoptMod = require('../lib/context/adopt');

function adoptWs() {
  const { ws, repos, config } = registerWs();
  const put = (repo, rel, text) => {
    const f = path.join(ws, repo, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return f;
  };
  put('backend', 'ai/contexts/entities/invoice.md', '# Invoice Entity\n\nBody stays.\n');
  put('frontend', 'ai/contexts/entities/invoice.md', '# Invoice entity\r\n\r\nWindows line endings.\r\n');
  put('backend', 'ai/contexts/features/payu/overview.md', '---\nstatus: draft\n---\n# PayU\n');
  put('backend', 'ai/contexts/testing/conventions.md', '# Testing\n');
  put('backend', 'ai/contexts/features/only-here.md', '# Only here\n');
  return { ws, repos, config, put };
}

test('adopt: plan adds type from the category and, with the flag, same-path counterparts only', () => {
  const { repos } = adoptWs();
  const graph = context.build(repos);
  const cands = context.suggest(graph.nodes);

  const plain = adoptMod.plan(graph, { candidates: cands });
  const byId = Object.fromEntries(plain.items.map((i) => [i.id, i.add]));
  assert.deepStrictEqual(byId['backend:ai/contexts/entities/invoice.md'], { type: 'entity' });
  assert.deepStrictEqual(byId['backend:ai/contexts/features/payu/overview.md'], { type: 'feature' }, 'existing frontmatter gets only the missing key');
  assert.deepStrictEqual(byId['backend:ai/contexts/testing/conventions.md'], { type: 'testing' }, 'a non-plural folder is kept');

  const linked = adoptMod.plan(graph, { candidates: cands, linkCandidates: true });
  const l = Object.fromEntries(linked.items.map((i) => [i.id, i.add]));
  assert.strictEqual(l['backend:ai/contexts/entities/invoice.md'].counterpartOf, 'frontend:ai/contexts/entities/invoice.md');
  assert.strictEqual(l['frontend:ai/contexts/entities/invoice.md'].counterpartOf, 'backend:ai/contexts/entities/invoice.md');
  assert.strictEqual(l['backend:ai/contexts/features/only-here.md'].counterpartOf, undefined, 'no pair, no link');
});

test('adopt: apply keeps bodies and line endings, is idempotent, and makes check see the links', () => {
  const { ws, repos, put } = adoptWs();
  const before = fs.readFileSync(path.join(ws, 'backend/ai/contexts/entities/invoice.md'), 'utf8');
  let graph = context.build(repos);
  const res = adoptMod.apply(adoptMod.plan(graph, { candidates: context.suggest(graph.nodes), linkCandidates: true }).items);
  assert.strictEqual(res.failed.length, 0);

  const be = fs.readFileSync(path.join(ws, 'backend/ai/contexts/entities/invoice.md'), 'utf8');
  assert.ok(be.startsWith('---\ntype: entity\ncounterpartOf: frontend:ai/contexts/entities/invoice.md\n---\n'));
  assert.ok(be.endsWith(before), 'the body is byte-for-byte what it was');
  const fe = fs.readFileSync(path.join(ws, 'frontend/ai/contexts/entities/invoice.md'), 'utf8');
  assert.ok(fe.startsWith('---\r\ntype: entity\r\n'), 'CRLF file gets CRLF frontmatter');
  const payu = fs.readFileSync(path.join(ws, 'backend/ai/contexts/features/payu/overview.md'), 'utf8');
  assert.strictEqual(payu, '---\nstatus: draft\ntype: feature\n---\n# PayU\n');

  graph = context.build(repos);
  assert.ok(graph.edges.some((e) => e.type === 'counterpartOf' && !e.inferred), 'declared edge now exists');
  const found = context.check(graph).findings;
  assert.ok(!found.some((f) => f.type === 'CANDIDATE'), 'the candidate is resolved');
  assert.ok(!found.some((f) => f.type === 'MISSING_FRONTMATTER'));

  const again = adoptMod.plan(graph, { candidates: context.suggest(graph.nodes), linkCandidates: true });
  assert.strictEqual(again.items.length, 0, 'a second run has nothing to add');
  put('backend', 'ai/contexts/entities/typed.md', '---\ntype: entity\n---\n# Typed\n');
  assert.strictEqual(adoptMod.plan(context.build(repos), {}).items.length, 0, 'a doc that already has a type is not touched');
});

test('adopt: a file with a byte-order mark keeps it first, and the result parses', () => {
  const out = adoptMod.withFrontmatter('﻿# Title\n', ['type: entity']);
  assert.ok(out.startsWith('﻿---\ntype: entity\n---\n# Title'));
  assert.strictEqual(frontmatter.parse(out).data.type, 'entity');
  const again = adoptMod.withFrontmatter(out, ['counterpartOf: a:b']);
  assert.ok(again.startsWith('﻿---\ntype: entity\ncounterpartOf: a:b\n---\n'));
});

test('adopt: CLI is a dry run by default, --write applies, an unterminated block is reported and kept', () => {
  const { ws, config, put } = adoptWs();
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const run = (...a) => spawnSync(process.execPath, [bin, 'context', 'adopt', '--config', config, '--json', ...a], { encoding: 'utf8' });
  const f = path.join(ws, 'backend/ai/contexts/entities/invoice.md');
  const before = fs.readFileSync(f, 'utf8');

  const dry = run();
  assert.strictEqual(dry.status, 0, dry.stderr);
  assert.strictEqual(JSON.parse(dry.stdout).write, false);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before, 'dry run writes nothing');

  const bad = put('backend', 'ai/contexts/features/broken.md', '---\nstatus: x\n# never closed\n');
  const wrote = run('--write');
  assert.strictEqual(wrote.status, 1, 'a failure is a non-zero exit');
  assert.ok(JSON.parse(wrote.stdout).failed.some((x) => /not closed/.test(x.reason)));
  assert.strictEqual(fs.readFileSync(bad, 'utf8'), '---\nstatus: x\n# never closed\n');
  assert.ok(fs.readFileSync(f, 'utf8').startsWith('---\ntype: entity'));
});

// ---------------------------------------------------------- context register

const registerMod = require('../lib/context/register');

function registerWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-reg-'));
  const repos = ['backend', 'frontend'].map((n) => {
    fs.mkdirSync(path.join(ws, n), { recursive: true });
    return { name: n, path: path.join(ws, n) };
  });
  fs.writeFileSync(path.join(ws, 'repos.json'), JSON.stringify({ repos: repos.map((r) => ({ name: r.name, path: r.name })) }));
  return { ws, repos, config: path.join(ws, 'repos.json') };
}

test('register: creates .mcp.json with node + the repo own cairn, a repo-relative config, and no OS-specific command', () => {
  const { repos, config } = registerWs();
  const posix = registerMod.registerAll(repos, config);
  assert.deepStrictEqual(posix.map((r) => r.action), ['created', 'created']);
  const doc = JSON.parse(fs.readFileSync(path.join(repos[0].path, '.mcp.json'), 'utf8'));
  assert.deepStrictEqual(doc.mcpServers.cairn, { command: 'node', args: ['node_modules/@stonepandastudio/cairn/bin/cairn.js', 'context', 'serve', '--config', '../repos.json'], alwaysLoad: true });
  assert.ok(posix.every((r) => r.installed === false), 'reports that cairn is not installed in the repo');
  const bin = path.join(repos[0].path, registerMod.CAIRN_BIN_REL);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '');
  assert.strictEqual(registerMod.registerRepo(repos[0], config).installed, true);
});

test('register: merges next to other servers, is idempotent, and leaves a different cairn entry alone', () => {
  const { repos, config } = registerWs();
  const file = path.join(repos[0].path, '.mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'x' } }, extra: 1 }));
  assert.strictEqual(registerMod.registerRepo(repos[0], config, { platform: 'linux' }).action, 'added');
  let doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(doc.mcpServers.other, { command: 'x' });
  assert.strictEqual(doc.extra, 1);
  assert.strictEqual(registerMod.registerRepo(repos[0], config, { platform: 'linux' }).action, 'unchanged');

  doc.mcpServers.cairn = { command: 'mine' };
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = registerMod.registerRepo(repos[0], config, { platform: 'linux' });
  assert.strictEqual(r.action, 'differs');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.cairn.command, 'mine');
  assert.strictEqual(registerMod.registerRepo(repos[0], config, { platform: 'linux', force: true }).action, 'replaced');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.cairn.command, 'node');
});

test('register: a broken .mcp.json is reported and untouched; dry run writes nothing', () => {
  const { repos, config } = registerWs();
  const file = path.join(repos[0].path, '.mcp.json');
  fs.writeFileSync(file, '{ not json');
  assert.strictEqual(registerMod.registerRepo(repos[0], config).action, 'invalid');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
  assert.strictEqual(registerMod.registerRepo(repos[1], config, { dryRun: true }).action, 'created');
  assert.ok(!fs.existsSync(path.join(repos[1].path, '.mcp.json')));
});

test('register: CLI writes every repo and exits non-zero only when something was left alone', () => {
  const { repos, config } = registerWs();
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const run = () => spawnSync(process.execPath, [bin, 'context', 'register', '--config', config, '--json'], { encoding: 'utf8' });
  const first = run();
  assert.strictEqual(first.status, 0, first.stderr);
  assert.deepStrictEqual(JSON.parse(first.stdout).map((r) => r.action), ['created', 'created']);
  fs.writeFileSync(path.join(repos[1].path, '.mcp.json'), JSON.stringify({ mcpServers: { cairn: { command: 'mine' } } }));
  const second = run();
  assert.strictEqual(second.status, 1);
  assert.deepStrictEqual(JSON.parse(second.stdout).map((r) => r.action), ['unchanged', 'differs']);
});

test('register --codex: writes .codex/config.toml with an absolute cwd, merges, is idempotent, leaves a different entry alone', () => {
  const { repos, config } = registerWs();
  const file = path.join(repos[0].path, '.codex', 'config.toml');
  const first = registerMod.registerCodexRepo(repos[0], config);
  assert.strictEqual(first.action, 'created');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^\[mcp_servers\.cairn\]$/m);
  assert.match(text, /^command = "node"$/m);
  assert.ok(text.includes(`cwd = ${JSON.stringify(repos[0].path.replace(/\\/g, '/'))}`), 'cwd is the absolute repo path');
  assert.match(text, /"context", "serve", "--config", "\.\.\/repos\.json"\]/);
  assert.strictEqual(registerMod.registerCodexRepo(repos[0], config).action, 'unchanged');

  // another server and a comment are kept; a different cairn table is left alone until --force
  fs.writeFileSync(file, '# mine\n[mcp_servers.figma]\nurl = "https://x"\n\n[mcp_servers.cairn]\ncommand = "other"\n\n[mcp_servers.after]\nenabled = false\n');
  const differs = registerMod.registerCodexRepo(repos[0], config);
  assert.strictEqual(differs.action, 'differs');
  assert.match(fs.readFileSync(file, 'utf8'), /command = "other"/);
  assert.strictEqual(registerMod.registerCodexRepo(repos[0], config, { force: true }).action, 'replaced');
  const forced = fs.readFileSync(file, 'utf8');
  assert.match(forced, /^# mine$/m);
  assert.match(forced, /\[mcp_servers\.figma\]\nurl = "https:\/\/x"/);
  assert.match(forced, /\[mcp_servers\.after\]\nenabled = false/);
  assert.doesNotMatch(forced, /command = "other"/);
  assert.strictEqual(registerMod.registerCodexRepo(repos[0], config).action, 'unchanged');

  // appended to a file that has other tables; dry run writes nothing
  fs.writeFileSync(file, '[mcp_servers.figma]\nurl = "https://x"');
  assert.strictEqual(registerMod.registerCodexRepo(repos[0], config, { dryRun: true }).action, 'added');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('cairn'));
  assert.strictEqual(registerMod.registerCodexRepo(repos[0], config).action, 'added');
  assert.match(fs.readFileSync(file, 'utf8'), /url = "https:\/\/x"\n\n\[mcp_servers\.cairn\]\n/);
});

test('register: one command writes an entry for each host a repo uses, and only those', () => {
  const { repos, config } = registerWs();
  const [backend, frontend] = repos;
  const cfg = (repo, hosts) => fs.writeFileSync(path.join(repo.path, 'cairn.config.json'), JSON.stringify({ stack: ['nestjs'], hosts }));
  cfg(backend, ['claude', 'codex']);
  cfg(frontend, ['claude']);
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const run = (extra = []) => spawnSync(process.execPath, [bin, 'context', 'register', '--config', config, '--json', ...extra], { encoding: 'utf8' });

  const dry = run(['--dry-run']);
  assert.strictEqual(dry.status, 0, dry.stderr);
  assert.ok(!fs.existsSync(path.join(backend.path, '.mcp.json')), 'a dry run writes nothing');

  const out = run();
  assert.strictEqual(out.status, 0, out.stderr);
  assert.deepStrictEqual(JSON.parse(out.stdout).map((r) => [r.repo, r.host, r.action]), [
    ['backend', 'claude', 'created'],
    ['backend', 'codex', 'created'],
    ['frontend', 'claude', 'created'],
  ]);
  assert.ok(fs.existsSync(path.join(backend.path, '.codex', 'config.toml')));
  assert.ok(!fs.existsSync(path.join(frontend.path, '.codex')), 'a Claude-only repo gets no Codex file');

  assert.deepStrictEqual(JSON.parse(run().stdout).map((r) => r.action), ['unchanged', 'unchanged', 'unchanged']);

  // a repo without a cairn.config.json is Claude only
  const bare = registerWs();
  const second = spawnSync(process.execPath, [bin, 'context', 'register', '--config', bare.config, '--json'], { encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(second.stdout).map((r) => [r.host, r.action]), [['claude', 'created'], ['claude', 'created']]);

  // a different entry is left alone (exit 1) until --force
  fs.writeFileSync(path.join(backend.path, '.codex', 'config.toml'), '[mcp_servers.cairn]\ncommand = "mine"\n');
  const differs = run();
  assert.strictEqual(differs.status, 1);
  assert.deepStrictEqual(JSON.parse(differs.stdout).map((r) => r.action), ['unchanged', 'differs', 'unchanged']);
  const forced = run(['--force']);
  assert.strictEqual(forced.status, 0);
  assert.deepStrictEqual(JSON.parse(forced.stdout).map((r) => r.action), ['unchanged', 'replaced', 'unchanged']);
});

atest('init --host: hosts is saved in the config; --render writes the Codex skills and a root AGENTS.md pointer', async () => {
  const { main: init } = require('../lib/init');
  const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'cairn.config.json'), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-initcodex-'));
  assert.strictEqual(init(['--repo', dir, '--stack', 'nestjs', '--tracker', 'none', '--host', 'claude,codex', '--render', '--no-color']), 0);
  assert.deepStrictEqual(read(dir).hosts, ['claude', 'codex']);
  assert.strictEqual(read(dir).codexSkills, undefined, 'the deprecated key is not written');
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', 'create-brief', 'SKILL.md')));
  assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /ai\/AGENTS\.md/);

  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-initplain-'));
  assert.strictEqual(init(['--repo', plain, '--stack', 'nestjs', '--tracker', 'none', '--render', '--no-color']), 0);
  assert.deepStrictEqual(read(plain).hosts, ['claude'], 'Claude is the default and is written down');
  assert.ok(!fs.existsSync(path.join(plain, 'AGENTS.md')));

  const viaHost = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-inithost-'));
  assert.strictEqual(init(['--repo', viaHost, '--stack', 'nestjs', '--tracker', 'none', '--host', 'codex,claude,codex', '--no-color']), 0);
  assert.deepStrictEqual(read(viaHost).hosts, ['codex', 'claude'], 'order kept, duplicates dropped');

  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-initbad-'));
  assert.strictEqual(init(['--repo', bad, '--stack', 'nestjs', '--tracker', 'none', '--host', 'cursor', '--no-color']), 2);
  assert.ok(!fs.existsSync(path.join(bad, 'cairn.config.json')));
});

test('hosts: resolveHosts defaults to Claude, honours hosts, and still reads the old codexSkills key', () => {
  const { resolveHosts, normalizeHosts, listHosts, getHost } = require('../lib/hosts');
  assert.deepStrictEqual(listHosts(), ['claude', 'codex']);
  assert.deepStrictEqual(resolveHosts({}), ['claude']);
  assert.deepStrictEqual(resolveHosts({ hosts: ['codex'] }), ['codex']);
  assert.deepStrictEqual(resolveHosts({ hosts: ['claude', 'codex'] }), ['claude', 'codex']);
  assert.deepStrictEqual(resolveHosts({ codexSkills: true }), ['claude', 'codex']);
  assert.deepStrictEqual(resolveHosts({ hosts: ['claude', 'codex'], codexSkills: true }), ['claude', 'codex']);
  assert.deepStrictEqual(resolveHosts({ codexSkills: false }), ['claude']);
  assert.deepStrictEqual(normalizeHosts('claude, codex'), ['claude', 'codex']);
  assert.throws(() => normalizeHosts(['cursor']), /unknown host "cursor" — available: claude, codex/);
  assert.throws(() => normalizeHosts([]), /at least one/);
  assert.throws(() => getHost('nope'), /unknown host/);
  for (const id of listHosts()) assert.ok(getHost(id).mcp && typeof getHost(id).mcp.register === 'function', id);
});

test('hosts: a Codex-only repo gets no .claude/ folder; the scout procedure moves to .agents/', () => {
  const { renderTargets } = require('../lib/render');
  const base = { stack: ['nestjs'], tracker: { provider: 'youtrack', projectKey: 'CI' } };
  const render = (hosts) => new Map(renderTargets({ config: { ...base, hosts }, presetsDir: 'presets' }).targets.map((t) => [t[0], t[1]]));

  const codex = render(['codex']);
  assert.deepStrictEqual([...codex.keys()].filter((f) => f.startsWith('.claude/')), []);
  for (const f of ['ai/AGENTS.md', 'ai/agents/architect.md', '.agents/skills/create-brief/SKILL.md', '.agents/skills/youtrack-status/SKILL.md', 'AGENTS.md']) {
    assert.ok(codex.has(f), f);
  }
  const scout = codex.get('.agents/code-scout.md');
  assert.ok(scout, 'the scout procedure is written for Codex');
  assert.doesNotMatch(scout, /^---/m, 'no Claude subagent frontmatter');
  assert.doesNotMatch(scout, /^model:|^tools:/m);
  assert.match(scout, /^# code-scout/);
  assert.match(scout, /read-only code scout/);
  assert.match(codex.get('.agents/skills/plan-task/SKILL.md'), /search procedure in `\.agents\/code-scout\.md`/);
  assert.match(codex.get('ai/agents/developer.md'), /code-scout procedure \(`\.agents\/code-scout\.md`\)/);
  assert.ok(![...codex.values()].some((c) => c.includes('.claude/')), 'nothing in a Codex-only repo points at .claude/');


  // the wording follows the host: Codex invocations, no Claude Code tools, no model switching
  assert.match(codex.get('ai/AGENTS.md'), /\$plan-task\b/);
  assert.doesNotMatch(codex.get('ai/AGENTS.md'), /\/plan-task|\/execute-plan/);
  const FORBIDDEN = /Claude|CLAUDE\.md|\/model |\/clear|AskUserQuestion|`Skill`|mcp__|ToolSearch|\bHaiku\b|\bSonnet\b|\bOpus\b|slash command|\.claude\//;
  const leaks = [...codex].filter(([, c]) => FORBIDDEN.test(c)).map(([f]) => f);
  assert.deepStrictEqual(leaks, [], 'Claude Code wording leaked into a Codex-only repo');
  assert.match(codex.get('ai/agents/developer.md'), /fresh chat\*\*/);
  assert.doesNotMatch(codex.get('ai/agents/developer.md'), /OK \/ Not OK|Continue on the current model/);
  assert.match(codex.get('ai/agents/reviewer.md'), /run the `\$fix-review` skill/);
  const { buildContext } = require('../lib/render');
  const vocab = (hosts) => buildContext({ ...base, hosts }, 'presets');
  assert.deepStrictEqual(
    [vocab(['codex']).guideFile, vocab(['codex']).cmdPrefix, vocab(['codex']).tool.codeReferences],
    ['AGENTS.md', '$', 'code_references'],
  );
  assert.deepStrictEqual(
    [vocab(['claude', 'codex']).guideFile, vocab(['claude', 'codex']).cmdPrefix, vocab(['claude']).tool.codeReferences],
    ['CLAUDE.md', '/', 'mcp__cairn__code_references'],
  );
  assert.match(codex.get('.agents/skills/execute-plan/SKILL.md'), /description: "Cairn workflow: implements the plan"/);
  assert.doesNotMatch(codex.get('.agents/skills/plan-task/SKILL.md'), /Claude/);
  assert.match(codex.get('.agents/skills/plan-task/SKILL.md'), /Use the current Codex model\. For workflow decisions/);

  const both = render(['claude', 'codex']);
  assert.ok(both.has('.claude/commands/plan-task.md') && both.has('.claude/agents/code-scout.md'));
  assert.ok(!both.has('.agents/code-scout.md'), 'one scout doc: the Claude one');
  assert.match(both.get('.agents/skills/plan-task/SKILL.md'), /search procedure in `\.claude\/agents\/code-scout\.md`/);
  assert.match(both.get('ai/agents/developer.md'), /`\.claude\/agents\/code-scout\.md`/);
  assert.match(both.get('ai/agents/architect.md'), /\/plan-task \[task\] \[step\]/);
  assert.match(both.get('.agents/skills/plan-task/SKILL.md'), /Cairn docs use Claude command names/);

  const claude = render(['claude']);
  assert.ok(![...claude.keys()].some((f) => f.startsWith('.agents/') || f === 'AGENTS.md'));
});

test('hosts: switching a repo from claude to codex reports the old .claude files as orphaned and deletes nothing', () => {
  const { main: render } = require('../lib/render/cli');
  const { main: sync } = require('../lib/sync/cli');
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'cairn.config.json'), JSON.stringify({ stack: ['nestjs'], tracker: { provider: 'none' }, hosts: ['claude'] }));
  assert.strictEqual(captureLog(() => render(['--repo', repo, '--no-color'])).result, 0);
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'agents', 'code-scout.md')));
  fs.writeFileSync(path.join(repo, 'cairn.config.json'), JSON.stringify({ stack: ['nestjs'], tracker: { provider: 'none' }, hosts: ['codex'] }));
  const out = captureLog(() => sync(['--repo', repo, '--no-color']));
  assert.match(out.out, /orphaned\s+\.claude\/agents\/code-scout\.md/);
  assert.ok(fs.existsSync(path.join(repo, '.claude', 'agents', 'code-scout.md')), 'sync leaves the old file for you to remove');
  assert.ok(fs.existsSync(path.join(repo, '.agents', 'code-scout.md')));
});

test('hosts: `hosts` and the old `codexSkills` render the same files; the default adds no Codex files', () => {
  const { renderTargets } = require('../lib/render');
  const base = { stack: ['nestjs'], tracker: { provider: 'none' } };
  const files = (c) => renderTargets({ config: { ...base, ...c }, presetsDir: 'presets' }).targets.map((t) => t[0]).sort();
  assert.deepStrictEqual(files({ hosts: ['claude', 'codex'] }), files({ codexSkills: true }));
  assert.deepStrictEqual(files({ hosts: ['claude'] }), files({}));
  assert.ok(files({ hosts: ['claude'] }).every((f) => !f.startsWith('.agents/') && f !== 'AGENTS.md'));
  assert.ok(files({ hosts: ['claude', 'codex'] }).includes('.agents/skills/plan-task/SKILL.md'));
});

test('config: hosts is validated by key — wrong type, empty and unknown names are one-line errors', () => {
  const { loadRepoConfig } = require('../lib/config');
  const load = (hosts) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hosts-'));
    fs.writeFileSync(path.join(dir, 'cairn.config.json'), JSON.stringify({ stack: ['nestjs'], hosts }));
    return loadRepoConfig(dir, { required: true });
  };
  assert.deepStrictEqual(load(['claude', 'codex']).hosts, ['claude', 'codex']);
  assert.throws(() => load('codex'), /hosts/);
  assert.throws(() => load([]), /at least one/);
  assert.throws(() => load(['claude', 'cursor']), /unknown host "cursor"/);
  assert.throws(() => load([1]), /hosts\[0\]/);
});

test('render: a root AGENTS.md the repo already has is kept when Codex skills are enabled', () => {
  const { planRender } = require('../lib/render');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-rootagents-'));
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'my own rules\n');
  const config = { stack: ['nestjs'], tracker: { provider: 'none' }, codexSkills: true };
  const plan = planRender({ config, presetsDir: 'presets', repoPath: repo });
  assert.ok(!plan.planned.some(([rel]) => rel === 'AGENTS.md'));
  assert.ok(plan.kept.some((k) => k.rel === 'AGENTS.md' && /not written by cairn/.test(k.reason)));
});

atest('setup warm-up: one throwaway lookup per repo starts its language server; a missing provider is reported, not thrown', async () => {
  const { repo, make, log } = serenaFixture();
  const src = make();
  try {
    const out = await require('../lib/context/cli').warmUp(src, [repo]);
    assert.deepStrictEqual(out.map((w) => [w.repo, w.ok]), [['backend', true]]);
    assert.strictEqual(log().filter((e) => e.ev === 'start').length, 1);
  } finally {
    await src.close();
  }
  const none = codesource.createCodeSource({ config: {}, workspaceDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-nowarm-')) });
  const out2 = await require('../lib/context/cli').warmUp(none, [repo]);
  assert.strictEqual(out2[0].ok, false);
  assert.ok(out2[0].reason);
});

test('single repo: with no repos.json, the current repo alone is the workspace (build, register without --config)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-single-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, 'ai', 'contexts', 'entities'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'ai', 'contexts', 'entities', 'invoice.md'), '# Invoice\n');
  const bin = path.join(__dirname, '..', 'bin', 'cairn.js');
  const run = (...a) => spawnSync(process.execPath, [bin, 'context', ...a], { cwd: repo, encoding: 'utf8' });

  const build = run('build', '--json');
  assert.strictEqual(build.status, 0, build.stderr);
  assert.ok(JSON.parse(build.stdout).nodes.some((n) => n.id.endsWith('ai/contexts/entities/invoice.md')));

  const reg = run('register', '--json');
  assert.strictEqual(reg.status, 0, reg.stderr);
  const doc = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
  assert.ok(!doc.mcpServers.cairn.args.includes('--config'), 'serve finds the repo itself');

  // Started from a subfolder of the repo (an agent session may be): the nearest repo up the tree.
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  const sub = spawnSync(process.execPath, [bin, 'context', 'build', '--json'], { cwd: path.join(repo, 'src', 'deep'), encoding: 'utf8' });
  assert.strictEqual(sub.status, 0, sub.stderr);
  assert.ok(JSON.parse(sub.stdout).nodes.length >= 1);

  // An explicit --config that does not exist is still an error, never a silent fallback.
  assert.strictEqual(run('build', '--config', 'nope.json').status, 2);

  // Not a repo, no repos.json: still the clear error.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-bare-'));
  assert.strictEqual(spawnSync(process.execPath, [bin, 'context', 'build'], { cwd: bare, encoding: 'utf8' }).status, 2);
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
