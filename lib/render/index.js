'use strict';

// cairn render — turn the bundled `presets/` into a repo's `ai/` scaffolding.
//
// Greenfield only: it writes files that do not exist, records them in the
// manifest, and leaves anything already on disk alone (reporting it). The
// three-way merge that would let it re-render over local edits is `cairn sync`,
// which is not built yet — for a fresh repo there is nothing to merge.

const fs = require('fs');
const path = require('path');

const { render, stripHeaderComment } = require('./engine');
const { hashContent } = require('../manifest');

const PRIMARY_ONLY_SLOTS = new Set(['plan-step-ordering', 'architect-references']);

const DEFAULT_WORKFLOW = {
  steps: [
    { id: 'brief', fn: 'create_brief', command: 'create-brief', role: 'architect', oneLine: 'creates the task brief scaffold' },
    { id: 'describe', fn: 'enrich_description', command: 'enrich-description', role: 'architect', oneLine: 'iterative discussion, then writes the enriched description' },
    { id: 'plan', fn: 'plan_task', command: 'plan-task', role: 'architect', oneLine: 'produces the implementation plan and context-doc updates' },
    { id: 'execute', fn: 'execute_plan', command: 'execute-plan', role: 'developer', oneLine: 'implements the plan' },
    { id: 'review', fn: 'code_review', command: 'code-review', role: 'reviewer', oneLine: 'checks the result against the plan and the guidelines' },
  ],
};

const ROLE_MODEL = { architect: 'Sonnet', developer: 'Haiku', reviewer: 'Sonnet' };

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function trackerContext(t = {}) {
  const provider = t.provider || 'none';
  const remote = provider === 'jira-server' || provider === 'youtrack';
  return {
    provider,
    remote,
    providerLabel: { 'jira-server': 'Jira', youtrack: 'YouTrack', none: 'no tracker' }[provider] || provider,
    exampleKey: t.projectKey || (remote ? 'PROJ' : 'TASK'),
    slug: provider === 'jira-server' ? 'jira' : provider === 'youtrack' ? 'youtrack' : 'tracker',
    subtaskMarker: provider === 'youtrack' ? 'youtrack-subtask' : 'jira-subtask',
    reviewStage: (t.statuses && t.statuses.done) || 'Review',
    parentTerm: remote ? 'parent issue' : 'task',
    childTerm: remote ? 'child issue' : 'step',
  };
}

function loadWorkflow(config, presetsDir) {
  if (config.workflow && Array.isArray(config.workflow.steps)) return config.workflow;
  const file = path.join(presetsDir, 'core', 'workflow.json');
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* fall through to the built-in default */
    }
  }
  return DEFAULT_WORKFLOW;
}

function buildContext(config, presetsDir) {
  const stack = config.stack && config.stack.length ? config.stack : ['unknown'];
  const tracker = trackerContext(config.tracker);
  const workflow = loadWorkflow(config, presetsDir);

  const agents = config.agents || {};
  const roleName = (role) =>
    (agents[role] && agents[role].name) || `${cap(stack[0])}${cap(role)}Agent`;
  const roleDoc = (role) => (agents[role] && agents[role].doc) || `ai/agents/${role}.md`;

  workflow.steps.forEach((s) => {
    s.agentName = roleName(s.role);
    s.agentDoc = roleDoc(s.role);
    s.model = ROLE_MODEL[s.role] || null;
    s.trackerAction = tracker.remote ? s.trackerAction || 'sync — see the rows below' : 'n/a';
    s.tracker = tracker.remote && s.role === 'architect' ? true : null;
    // create_brief is the only step whose $ARGUMENTS can start a brand-new task —
    // the rest always operate on one that already exists.
    s.createsTask = s.fn === 'create_brief';
    // With a remote tracker, the next issue key can't be predicted (YouTrack/Jira
    // assign it), so create_brief must accept an omitted task ID and mint one.
    s.canOmitTask = tracker.remote && s.createsTask;
  });

  // Only nestjs has a variant group today (validation-stack); the map shape is
  // generic so a second group (e.g. angular's dormant i18n choice) is one more
  // key here plus its own presets/<entry>/variants/<group>/ folders, not a
  // second mechanism.
  const validationStack = config.validationStack || 'zod';
  const variants = { 'validation-stack': validationStack };

  return {
    stack,
    tracker,
    workflow,
    variants,
    validationStack,
    // Precomputed booleans for {{#if}} — the engine only does truthy lookups on
    // a single path, no equality expressions (see engine.js), same reason
    // `tracker.remote` is a boolean and not `{{#if (eq tracker.provider …)}}`.
    validation: { zod: validationStack === 'zod', classValidator: validationStack === 'class-validator' },
    model: config.model || 'claude-sonnet-5',
    architectAgent: roleName('architect'),
    developerAgent: roleName('developer'),
    reviewerAgent: roleName('reviewer'),
    project: {
      assistantName:
        (config.vars && config.vars.assistantName) || `${cap(stack[0])} Dev Assistant`,
    },
    agents: ['architect', 'developer', 'reviewer'].map((r) => ({ name: roleName(r), doc: roleDoc(r) })),
    ...(config.vars || {}),
  };
}

// `variants` is the { groupName: selectedVariantName } map from buildContext
// (today just `{ 'validation-stack': 'zod' | 'class-validator' }`). A
// `{{> variant/<group>/<name> }}` partial resolves the same way a
// `{{> stack/<name> }}` one does — concatenated across every stack entry that
// has it — except from `variants/<group>/<selected>/<name>.md` instead of
// `slots/<name>.md`. An unknown group or one the config didn't select anything
// for resolves to null, same as a `stack/` name nothing ships.
function makeResolvePartial(stack, presetsDir, variants = {}) {
  return (name) => {
    const variantMatch = name.match(/^variant\/([^/]+)\/(.+)$/);
    if (variantMatch) {
      const [, group, slot] = variantMatch;
      const selected = variants[group];
      if (!selected) return null;
      const parts = [];
      for (const entry of stack) {
        const file = path.join(presetsDir, entry, 'variants', group, selected, `${slot}.md`);
        if (fs.existsSync(file)) parts.push(stripHeaderComment(fs.readFileSync(file, 'utf8')).trim());
      }
      return parts.length ? parts.join('\n\n') : null;
    }

    const m = name.match(/^stack\/(.+)$/);
    if (!m) return null;
    const slot = m[1];
    const entries = PRIMARY_ONLY_SLOTS.has(slot) ? stack.slice(0, 1) : stack;
    const parts = [];
    for (const entry of entries) {
      const file = path.join(presetsDir, entry, 'slots', `${slot}.md`);
      if (fs.existsSync(file)) parts.push(stripHeaderComment(fs.readFileSync(file, 'utf8')).trim());
    }
    if (!parts.length) return null;
    // Table-row slots (every part starts with `|`) concatenate line-to-line;
    // prose slots need a blank line between them.
    const sep = parts.every((p) => p.startsWith('|')) ? '\n' : '\n\n';
    return parts.join(sep);
  };
}

function readPreset(presetsDir, rel) {
  const file = path.join(presetsDir, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

// Concatenate `<entry>/code-guidelines.md` for every stack entry that ships one.
function codeGuidelines(stack, presetsDir, ctx, resolvePartial) {
  const blocks = [];
  for (const entry of stack) {
    const raw = readPreset(presetsDir, `${entry}/code-guidelines.md`);
    if (raw) blocks.push(render(raw, ctx, resolvePartial).trim());
  }
  return blocks.length ? blocks.join('\n\n---\n\n') + '\n' : null;
}

// Every file the presets would produce for this config, as
// [[rel, content, source, note?]] — before any greenfield or manifest guard.
// `planRender` filters this for `cairn render`; `cairn sync` diffs each entry
// against the repo's manifest + `_cairn/base/`.
function renderTargets({ config, presetsDir }) {
  const ctx = buildContext(config, presetsDir);
  const resolvePartial = makeResolvePartial(ctx.stack, presetsDir, ctx.variants);

  const targets = [];

  const stub = readPreset(presetsDir, 'core/commands/_stub.md');
  if (stub) {
    for (const step of ctx.workflow.steps) {
      targets.push([
        `.claude/commands/${step.command}.md`,
        render(stub, { ...ctx, step }, resolvePartial),
        'core/commands/_stub.md',
      ]);
    }
  }

  const stepFor = (role) => ctx.workflow.steps.find((s) => s.role === role) || {};
  for (const role of ['architect', 'developer', 'reviewer']) {
    const raw = readPreset(presetsDir, `core/agents/${role}.md`);
    if (raw) {
      targets.push([
        `ai/agents/${role}.md`,
        render(raw, { ...ctx, step: stepFor(role) }, resolvePartial),
        `core/agents/${role}.md`,
      ]);
    }
  }

  for (const [rel, src] of [
    ['ai/AGENTS.md', 'core/AGENTS.md'],
    ['ai/WORKFLOW.md', 'core/WORKFLOW.md'],
  ]) {
    const raw = readPreset(presetsDir, src);
    if (raw) targets.push([rel, render(raw, ctx, resolvePartial), src]);
  }

  // Stack-owned extra agents/commands: opt-in additions outside workflow.steps
  // entirely — no (task, step) shape, no shared role contract with architect/
  // developer/reviewer. NestJS's QA pipeline (plan_tests/execute_test_plan/run_qa)
  // and Angular's standalone e2e-test agent are the first two; unlike core's
  // agents, these are stack-specific content, not a shared contract + stack
  // slots, because the two don't share a workflow shape at all. `{{ model }}`
  // resolves the same as it does in reviewer.md — the top-level tier, not a
  // per-role one; a file that needs Haiku instead (qa-developer, matching
  // developer.md) says so as plain text, not a template var.
  for (const entry of ctx.stack) {
    const agentsDir = path.join(presetsDir, entry, 'agents');
    if (fs.existsSync(agentsDir)) {
      for (const file of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort()) {
        const name = file.slice(0, -3);
        const raw = fs.readFileSync(path.join(agentsDir, file), 'utf8');
        targets.push([`ai/agents/${name}.md`, render(raw, ctx, resolvePartial), `${entry}/agents/${file}`]);
      }
    }
    const commandsDir = path.join(presetsDir, entry, 'commands');
    if (fs.existsSync(commandsDir)) {
      for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md')).sort()) {
        const raw = fs.readFileSync(path.join(commandsDir, file), 'utf8');
        targets.push([`.claude/commands/${file}`, render(raw, ctx, resolvePartial), `${entry}/commands/${file}`]);
      }
    }
  }

  // Standalone commands: not part of workflow.steps (no task/step arg, no agent
  // role), so they don't go through `_stub.md`. archive-tasks is tracker-agnostic;
  // the tracker-status/assign pair only means anything with a remote tracker, and
  // is named after it (`/youtrack-status`, `/jira-assign`) to match how snap-proof
  // already had these before cairn — same filenames, now templated.
  const archiveTasks = readPreset(presetsDir, 'core/commands/archive-tasks.md');
  if (archiveTasks) {
    targets.push(['.claude/commands/archive-tasks.md', render(archiveTasks, ctx, resolvePartial), 'core/commands/archive-tasks.md']);
  }
  if (ctx.tracker.remote) {
    for (const [name, src] of [
      ['status', 'core/commands/tracker-status.md'],
      ['assign', 'core/commands/tracker-assign.md'],
    ]) {
      const raw = readPreset(presetsDir, src);
      if (raw) targets.push([`.claude/commands/${ctx.tracker.slug}-${name}.md`, render(raw, ctx, resolvePartial), src]);
    }
  }

  const guidelines = codeGuidelines(ctx.stack, presetsDir, ctx, resolvePartial);
  if (guidelines) {
    targets.push([
      'ai/infrastructure/code-guidelines.md',
      guidelines,
      'presets:<stack>/code-guidelines.md',
      'seed — fork it; `cairn sync` will three-way merge later changes',
    ]);
  }

  return { targets, context: ctx };
}

// Returns { planned: [[rel, content, source, note?]], kept: [{ rel, reason }] }.
// `manifest` + `repoPath` drive the greenfield guard: a file cairn has not
// written is never touched, and one it wrote but a human has since edited is
// kept and reported (the re-render that respects local edits is `cairn sync`).
function planRender({ config, presetsDir, manifest = { files: {} }, repoPath = null }) {
  const { targets, context: ctx } = renderTargets({ config, presetsDir });

  const planned = [];
  const kept = [];
  for (const [rel, content, source, note] of targets) {
    const entry = manifest.files[rel];
    const abs = repoPath ? path.join(repoPath, rel) : null;
    const onDisk = abs && fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;

    if (entry && onDisk !== null && hashContent(onDisk) !== entry.hash) {
      kept.push({ rel, reason: 'hand-edited since cairn wrote it' });
      continue;
    }
    if (entry && onDisk !== null && hashContent(content) === entry.hash) continue; // current, on disk
    if (entry && onDisk !== null) {
      kept.push({ rel, reason: 'the template changed — `cairn sync` will merge it' });
      continue;
    }
    if (!entry && onDisk !== null) {
      kept.push({ rel, reason: 'already on disk, not written by cairn' });
      continue;
    }
    // Not on disk: brand new, or a manifested file that was deleted — (re)write it.
    planned.push([rel, content, source, entry ? 'restoring' : note]);
  }

  return { planned, kept, context: ctx };
}

module.exports = { planRender, renderTargets, buildContext, trackerContext, DEFAULT_WORKFLOW };
