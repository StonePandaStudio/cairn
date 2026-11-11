'use strict';

// cairn render — turn the bundled `presets/` into a repo's `ai/` scaffolding.
//
// Greenfield only: it writes files that do not exist, records them in the
// manifest, and leaves anything already on disk alone (reporting it). The
// three-way merge that would let it re-render over local edits is `cairn sync`,
// which is not built yet — for a fresh repo there is nothing to merge.

const fs = require('fs');
const { readJsonFile } = require('../json');
const path = require('path');

const { render, stripHeaderComment } = require('./engine');
const { hashContent } = require('../manifest');
const { workspaceContext } = require('../workspace');
const { createLocalReader, applySlotOverride, appendToAgent } = require('../local');

const PRIMARY_ONLY_SLOTS = new Set([
  'plan-step-ordering',
  'architect-references',
  // The QA slots each describe one coherent procedure or format for the primary
  // framework; concatenating two stacks' versions would produce nonsense.
  // qa-mandatory-docs is a list, so it is not here.
  'qa-target',
  'qa-source',
  'qa-plan-rules',
  'qa-plan-format',
  'qa-write-steps',
  'qa-all-targets',
]);

// A stack ships the QA pipeline (plan_tests / execute_test_plan / run_qa) by
// providing a qa-target slot; nothing else is needed to opt in.
function stackShipsQa(stack, presetsDir) {
  return stack.some((entry) => fs.existsSync(path.join(presetsDir, entry, 'slots', 'qa-target.md')));
}
const QA_AGENTS = ['qa-architect', 'qa-developer', 'qa-orchestrator'];
const QA_COMMANDS = ['plan-tests', 'execute-test-plan', 'run-qa'];

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

// The tier the reviewer/QA agents require, as the name a person says ("Sonnet"),
// never a versioned id — a version in generated prose goes stale on the next model
// release. Configs written before this (`"model": "claude-sonnet-5"`) still render:
// the tier word is pulled out and the version dropped.
function modelTier(value) {
  const s = String(value || '').trim();
  const tier = s.match(/haiku|sonnet|opus|fable/i);
  return tier ? cap(tier[0].toLowerCase()) : s || 'Sonnet';
}

function trackerContext(t = {}) {
  const provider = t.provider || 'none';
  // The stages the repo named itself. A config loaded through loadRepoConfig records
  // them (its `statuses` also carries defaults); a bare config object has only what
  // its author wrote.
  const named = t.statusesSet || Object.keys(t.statuses || {});
  const remote = provider === 'jira-server' || provider === 'youtrack';
  return {
    provider,
    remote,
    providerLabel: { 'jira-server': 'Jira', youtrack: 'YouTrack', none: 'no tracker' }[provider] || provider,
    exampleKey: t.projectKey || (remote ? 'PROJ' : 'TASK'),
    slug: provider === 'jira-server' ? 'jira' : provider === 'youtrack' ? 'youtrack' : 'tracker',
    subtaskMarker: provider === 'youtrack' ? 'youtrack-subtask' : 'jira-subtask',
    // Stages a workflow step moves an issue to. A step moves only to a stage the repo
    // named in tracker.statuses; the defaults in config.js are not a promise the board
    // has them.
    inProgressStage: (t.statuses && t.statuses.inProgress) || 'In Progress',
    reviewStageName: (t.statuses && t.statuses.review) || null,
    moveToInProgress: remote && named.includes('inProgress'),
    moveToReview: remote && named.includes('review'),
    movesStage: remote && ['inProgress', 'review'].some((k) => named.includes(k)),
    // Opt-in (tracker.publicRefs). Gates every epic/ref sentence in the presets, so
    // a repo that hasn't turned it on renders byte-identical files.
    publicRefs: remote && !!t.publicRefs,
    parentTerm: remote ? 'parent issue' : 'task',
    childTerm: remote ? 'child issue' : 'step',
  };
}

function loadWorkflow(config, presetsDir) {
  if (config.workflow && Array.isArray(config.workflow.steps)) return config.workflow;
  const file = path.join(presetsDir, 'core', 'workflow.json');
  const bundled = readJsonFile(file, { optional: true });
  return bundled === undefined ? DEFAULT_WORKFLOW : bundled;
}

function buildContext(config, presetsDir, repoPath = null) {
  const stack = config.stack && config.stack.length ? config.stack : ['unknown'];
  const tracker = trackerContext(config.tracker);
  const workflow = loadWorkflow(config, presetsDir);
  const customWorkflow = !!(config.workflow && Array.isArray(config.workflow.steps));

  const agents = config.agents || {};
  const roleName = (role) =>
    (agents[role] && agents[role].name) || `${cap(stack[0])}${cap(role)}Agent`;
  const qaName = (key, suffix) => (agents[key] && agents[key].name) || `${cap(stack[0])}QA${suffix}Agent`;
  const roleDoc = (role) => (agents[role] && agents[role].doc) || `ai/agents/${role}.md`;

  workflow.steps.forEach((s) => {
    s.agentName = roleName(s.role);
    s.agentDoc = roleDoc(s.role);
    s.model = ROLE_MODEL[s.role] || null;
    s.trackerAction = tracker.remote ? s.trackerAction || 'sync — see the rows below' : 'n/a';
    // The default workflow's stage moves become explicit commands once the repo has
    // named the stage. A custom workflow.steps keeps whatever text it wrote.
    if (tracker.remote && !customWorkflow) {
      if (s.fn === 'enrich_description' && tracker.moveToInProgress) {
        s.trackerAction += `; then the step's issue (and its parent, for a child issue) → \`${tracker.inProgressStage}\` with \`npx cairn tracker set-status <key> "${tracker.inProgressStage}" --if-exists\``;
      }
      if (s.fn === 'code_review' && tracker.moveToReview) {
        s.trackerAction = `at the start of the review, the step's issue (and its parent, for a child issue) → \`${tracker.reviewStageName}\` with \`npx cairn tracker set-status <key> "${tracker.reviewStageName}" --if-exists\`; the verdict does not change the stage`;
      }
    }
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
    // The other repos in the same repos.json, or null. Only known when the caller
    // says where the repo is — a bare `renderTargets({ config })` has no workspace.
    workspace: workspaceContext(repoPath, config),
    // Precomputed booleans for {{#if}} — the engine only does truthy lookups on
    // a single path, no equality expressions (see engine.js), same reason
    // `tracker.remote` is a boolean and not `{{#if (eq tracker.provider …)}}`.
    validation: { zod: validationStack === 'zod', classValidator: validationStack === 'class-validator' },
    model: modelTier(config.model),
    // Test-first execution; the main workflow only (the QA backfill agents write
    // tests for code that already exists, so there is nothing to go red against).
    tdd: config.tdd === true,
    // Opt-in: absent `sizing` renders no size check. Present, each limit falls back to
    // its default, so `"sizing": {}` is enough to turn it on.
    sizing: config.sizing
      ? { maxLoc: config.sizing.maxLoc || 400, maxFiles: config.sizing.maxFiles || 12 }
      : null,
    commands: { build: (config.commands && config.commands.build) || null },
    // The code-scout subagent's `model:` frontmatter. Haiku is enough for locating
    // code; a repo with a large or unusual tree sets agents.scout.model to move up.
    scout: { model: (agents.scout && agents.scout.model) || 'haiku' },
    // True when a stack entry ships qa-* slots; gates the QA agents, their commands
    // and the AGENTS.md section.
    qa: stackShipsQa(stack, presetsDir),
    qaArchitectAgent: qaName('qaArchitect', 'Architect'),
    qaDeveloperAgent: qaName('qaDeveloper', 'Developer'),
    qaOrchestratorAgent: qaName('qaOrchestrator', 'Orchestrator'),
    discoveryAgent: roleName('discovery'),
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
// `local` (optional, a reader from ../local) layers the repo's own ai/local/slots/
// over a `{{> stack/<slot> }}`; see applySlotOverride for the section rules.
function makeResolvePartial(stack, presetsDir, variants = {}, local = null) {
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
    // Table-row slots (every part starts with `|`) concatenate line-to-line;
    // prose slots need a blank line between them.
    const sep = parts.every((p) => p.startsWith('|')) ? '\n' : '\n\n';
    const upstream = parts.length ? parts.join(sep) : null;
    const override = local && local.slot(slot);
    if (override) return applySlotOverride(upstream || '', override).text;
    return upstream;
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
//
// `localOverrides` previews overrides that are not on disk yet
// ({ slots: {name: raw}, agents: {name: raw} }); `cairn override extract` uses it
// to check that what it is about to write reproduces a hand-edited file.
function renderTargets({ config, presetsDir, repoPath = null, localOverrides = null }) {
  const ctx = buildContext(config, presetsDir, repoPath);
  const local = createLocalReader(repoPath, localOverrides);
  const resolvePartial = makeResolvePartial(ctx.stack, presetsDir, ctx.variants, local);

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

  // Native Claude Code subagents (`.claude/agents/`), spawned by a role through the
  // Agent tool. Separate from the role docs above, which are personas in the main
  // session. Today that is the read-only code scout the architect delegates search to.
  const scout = readPreset(presetsDir, 'core/subagents/code-scout.md');
  if (scout) {
    targets.push(['.claude/agents/code-scout.md', render(scout, ctx, resolvePartial), 'core/subagents/code-scout.md']);
  }

  for (const [rel, src] of [
    ['ai/AGENTS.md', 'core/AGENTS.md'],
    ['ai/WORKFLOW.md', 'core/WORKFLOW.md'],
  ]) {
    const raw = readPreset(presetsDir, src);
    if (raw) targets.push([rel, render(raw, ctx, resolvePartial), src]);
  }

  // The QA pipeline: a core contract (agents + command stubs) whose stack-specific
  // content comes from the stack's qa-* slots. Opt-in by shipping a qa-target slot;
  // outside workflow.steps, with no (task, step) shape.
  if (ctx.qa) {
    for (const name of QA_AGENTS) {
      const raw = readPreset(presetsDir, `core/agents/${name}.md`);
      if (raw) targets.push([`ai/agents/${name}.md`, render(raw, ctx, resolvePartial), `core/agents/${name}.md`]);
    }
    for (const name of QA_COMMANDS) {
      const raw = readPreset(presetsDir, `core/commands/${name}.md`);
      if (raw) targets.push([`.claude/commands/${name}.md`, render(raw, ctx, resolvePartial), `core/commands/${name}.md`]);
    }
  }

  // Stack-owned extra agents/commands: a preset may still ship its own
  // `agents/` and `commands/` files, rendered as-is. Nothing does today — the QA
  // pipeline that used to live here is the core contract above, filled by slots.
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
  // The review loop: chains architect / developer / reviewer as sub-agents. It is an
  // orchestrator with no role doc of its own, so the command carries all of it.
  const fixReview = readPreset(presetsDir, 'core/commands/fix-review.md');
  if (fixReview) {
    targets.push(['.claude/commands/fix-review.md', render(fixReview, ctx, resolvePartial), 'core/commands/fix-review.md']);
  }
  // Brownfield entry point: drafts ai/contexts/ from existing code. Every stack gets it;
  // the stack's discover-targets slots only say what to look for.
  const discoveryDoc = readPreset(presetsDir, 'core/agents/discovery.md');
  const discoverCmd = readPreset(presetsDir, 'core/commands/discover.md');
  if (discoveryDoc && discoverCmd) {
    targets.push(['ai/agents/discovery.md', render(discoveryDoc, ctx, resolvePartial), 'core/agents/discovery.md']);
    targets.push(['.claude/commands/discover.md', render(discoverCmd, ctx, resolvePartial), 'core/commands/discover.md']);
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

  // A request to a sibling repo is a tracker issue in the shared project, so it
  // needs both a workspace to name the sibling and a remote tracker to file it in.
  if (ctx.workspace && ctx.tracker.remote) {
    const raw = readPreset(presetsDir, 'core/commands/request-change.md');
    if (raw) {
      targets.push(['.claude/commands/request-change.md', render(raw, ctx, resolvePartial), 'core/commands/request-change.md']);
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

  // Project-specific additions to an agent doc: ai/local/agents/<name>.md is
  // appended to ai/agents/<name>.md, so the agent still reads a single file.
  for (const target of targets) {
    const m = target[0].match(/^ai\/agents\/([^/]+)\.md$/);
    const extra = m && local.agent(m[1]);
    if (extra) target[1] = appendToAgent(target[1], render(extra, ctx, resolvePartial));
  }

  if (config.codexSkills === true) {
    const skills = [];
    for (const [rel, content, source] of targets) {
      const command = rel.match(/^\.claude\/commands\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
      if (!command || !source.startsWith('core/commands/')) continue;
      const [, name] = command;
      const frontmatter = content.trimStart().match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      if (!frontmatter) continue;
      const descriptionLine = frontmatter[1].match(/^description: (.+)$/m);
      if (!descriptionLine) continue;
      const description = descriptionLine[1].trim();
      const instructions = content.trimStart().slice(frontmatter[0].length).trimStart()
        .replace(/\$ARGUMENTS/g, 'the arguments supplied with this skill');
      skills.push([
        `.agents/skills/${name}/SKILL.md`,
        [
          '---',
          `name: ${name}`,
          `description: ${JSON.stringify(`Cairn workflow: ${description}`)}`,
          '---',
          '',
          'Read `ai/AGENTS.md` and follow the Cairn procedure below using the task and arguments from the user’s request.',
          'Cairn docs use Claude command names. In Codex, treat those names as references to the corresponding skills.',
          'Use the current Codex model and skip Claude model selection. For workflow decisions that require user input, ask in chat and wait for the answer.',
          'When the procedure recommends a fresh Claude session, use a fresh Codex chat for the same context reset.',
          'For code-scout work, follow the read-only search procedure in `.claude/agents/code-scout.md`. Use the `cairn` MCP server’s `code_references` and `code_symbol` tools for named symbols when available, with the scout’s text-search fallback and verification rules.',
          'For other Cairn MCP calls, resolve the tool by its name under the `cairn` server. Preserve any user confirmation required by the role docs before writing.',
          'For orchestration steps that specify the Claude Agent tool, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.',
          '',
          instructions,
        ].join('\n'),
        source,
      ]);
    }
    targets.push(...skills);
  }

  return { targets, context: ctx };
}

// Returns { planned: [[rel, content, source, note?]], kept: [{ rel, reason }] }.
// `manifest` + `repoPath` drive the greenfield guard: a file cairn has not
// written is never touched, and one it wrote but a human has since edited is
// kept and reported (the re-render that respects local edits is `cairn sync`).
function planRender({ config, presetsDir, manifest = { files: {} }, repoPath = null }) {
  const { targets, context: ctx } = renderTargets({ config, presetsDir, repoPath });

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

module.exports = { planRender, renderTargets, buildContext, trackerContext, makeResolvePartial, DEFAULT_WORKFLOW };
