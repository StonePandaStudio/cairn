'use strict';

// cairn wizard — interactive install. A thin orchestrator: it asks, builds the argv of the
// ordinary commands (init, workspace add, docs add, context register / install-tools) and runs
// them through their own `main`. Nothing here writes a file itself. It ends by printing the
// equivalent commands so the run can be repeated, or scripted, without the wizard.

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME } = require('../config');
const { listHosts } = require('../hosts');
const { listPresets } = require('../presets');
const { listProviders } = require('../tracker');
const { VALIDATION_STACKS } = require('../init');
const { UserError } = require('../errors');
const { createPrompter } = require('./prompt');
const { execCommand } = require('./exec');
const { runSteps, indexOfValue } = require('./steps');
const { commandLine, printPlan, runCommands, printEquivalent } = require('./plan');

const HELP = `cairn wizard — interactive install for one repo

Usage: cairn wizard [options]

  --repo <path>   repo to set up (default: ask, offering the current folder)
  --dry-run       ask the questions and print the commands, run nothing

Asks about the agent hosts, stack, tracker, workspace and docs, shows the plan, and runs
the same commands you could type yourself (init, workspace add, docs add, context register,
context install-tools). It ends by printing them, so a run can be repeated without the wizard.
It never installs cairn itself: it prints the npm command instead.
`;

const DOC_DIRS = ['docs', 'doc', 'docum', 'documentation'];

function shortDescription(text) {
  const first = String(text || '').split(/[;,]/)[0].trim();
  return first.length > 70 ? `${first.slice(0, 67)}...` : first;
}

function detectDocsDir(repo) {
  return DOC_DIRS.find((d) => {
    try {
      return fs.statSync(path.join(repo, d)).isDirectory();
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------- the questions

function checkRepo(repo) {
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UserError(`not a directory: ${repo}`);
  if (fs.existsSync(path.join(repo, CONFIG_NAME))) {
    throw new UserError(
      `${repo} already has ${CONFIG_NAME}. The wizard only does a first install; use \`cairn sync\` ` +
        'to merge preset changes or `cairn upgrade` to update cairn.',
    );
  }
}

// The raw answers become the plain data buildCommands reads.
function finish(s) {
  const stack = s.framework === 'unknown' ? (s.addOns.length ? s.addOns : ['unknown']) : [s.framework, ...s.addOns];
  const docsDir = detectDocsDir(s.repo);
  return {
    repo: s.repo,
    hosts: s.hosts,
    stack,
    validationStack: stack.includes('nestjs') ? s.validationStack : null,
    tracker: s.tracker,
    projectKey: s.tracker === 'none' ? null : s.projectKey,
    workspace: s.inWorkspace ? s.workspaceFile : null,
    docsDir: s.addDocs && docsDir ? docsDir : null,
    render: s.render,
    register: s.register,
    installTools: s.installTools,
  };
}

function wizardSteps({ repoArg, dryRun }) {
  const presets = listPresets();
  const frameworks = presets.filter((x) => x.kind === 'framework');
  const addOnPresets = presets.filter((x) => x.kind !== 'framework');
  const hostOptions = listHosts().map((h) => ({ value: h, label: h }));
  const frameworkOptions = [
    ...frameworks.map((x) => ({ value: x.name, label: x.name, hint: shortDescription(x.description) })),
    { value: 'unknown', label: 'none of these', hint: 'core workflow only' },
  ];
  const addOnOptions = addOnPresets.map((x) => ({ value: x.name, label: x.name, hint: `${x.kind}: ${shortDescription(x.description)}` }));
  const providers = listProviders();
  const trackerOptions = providers.map((t) => ({ value: t, label: t }));
  const validationOptions = VALIDATION_STACKS.map((v) => ({ value: v, label: v }));
  const stackOf = (s) => finish({ ...s, addOns: s.addOns || [], framework: s.framework || 'unknown' }).stack;
  const idx = (options, values) => (values || []).map((v) => options.findIndex((o) => o.value === v)).filter((i) => i >= 0);

  return [
    {
      id: 'repo',
      when: () => !repoArg,
      run: async (p, s) => {
        s.repo = path.resolve(await p.ask('Repo to set up', s.repo || process.cwd()));
        checkRepo(s.repo);
      },
    },
    {
      id: 'hosts',
      run: async (p, s) => {
        s.hosts = await p.multi('\nAgent hosts', hostOptions, s.hosts ? idx(hostOptions, s.hosts) : [0]);
        if (!s.hosts.length) throw new UserError('pick at least one agent host');
      },
    },
    {
      id: 'framework',
      run: async (p, s) => {
        s.framework = await p.choose('\nFramework', frameworkOptions, indexOfValue(frameworkOptions, s.framework, 0));
      },
    },
    {
      id: 'addOns',
      run: async (p, s) => {
        s.addOns = await p.multi('\nAdd-ons (ORM, styling, infrastructure)', addOnOptions, idx(addOnOptions, s.addOns));
      },
    },
    {
      id: 'validationStack',
      when: (s) => stackOf(s).includes('nestjs'),
      run: async (p, s) => {
        s.validationStack = await p.choose('\nValidation stack', validationOptions, indexOfValue(validationOptions, s.validationStack, 0));
      },
    },
    {
      id: 'tracker',
      run: async (p, s) => {
        s.tracker = await p.choose('\nIssue tracker', trackerOptions, indexOfValue(trackerOptions, s.tracker, Math.max(0, providers.indexOf('none'))));
      },
    },
    {
      id: 'projectKey',
      when: (s) => s.tracker !== 'none',
      run: async (p, s) => {
        let key = '';
        while (!key) key = await p.ask('Tracker project key (e.g. PROOF)', s.projectKey);
        s.projectKey = key;
      },
    },
    {
      id: 'inWorkspace',
      run: async (p, s) => {
        s.inWorkspace = await p.confirm('\nIs this repo one of a group (frontend + backend, say) that agents should see together?', Boolean(s.inWorkspace));
      },
    },
    {
      id: 'workspaceFile',
      when: (s) => s.inWorkspace,
      run: async (p, s) => {
        s.workspaceFile = path.resolve(await p.ask('Workspace file (created if missing)', s.workspaceFile || path.join(path.dirname(s.repo), 'repos.json')));
      },
    },
    {
      id: 'docs',
      when: (s) => Boolean(detectDocsDir(s.repo)),
      run: async (p, s) => {
        const dir = detectDocsDir(s.repo);
        s.addDocs = await p.confirm(`\nFound ./${dir}/ — list it as the project's docs for the agents? (/discover can also pick them later)`, Boolean(s.addDocs));
      },
    },
    {
      id: 'render',
      run: async (p, s) => {
        s.render = await p.confirm('\nScaffold ai/ from the presets now', s.render === undefined ? true : s.render);
      },
    },
    {
      id: 'register',
      run: async (p, s) => {
        s.register = await p.confirm('Register the cairn MCP server for the agent hosts', s.register === undefined ? true : s.register);
      },
    },
    {
      id: 'installTools',
      run: async (p, s) => {
        s.installTools = await p.confirm(
          'Install the code lookup tools (symbols and references; downloads a language server, takes minutes)',
          Boolean(s.installTools),
        );
      },
    },
    {
      id: 'confirm',
      when: () => !dryRun,
      run: async (p, s) => {
        printPlan(p, buildCommands(finish(s)), 'Plan');
        s.confirmed = await p.confirm('\nRun these now', true);
      },
    },
  ];
}

// Asks everything (Esc / `<` steps back) and returns the answers as plain data, plus `confirmed`
// when the plan was put to the user. No command runs here. Back at the first step throws Back.
async function collectAnswers(p, { repo: repoArg, dryRun = false } = {}) {
  p.write('cairn wizard — set up a repo for the shared AI workflow\n');
  if (p.backHint) p.write(`${p.backHint}\n`);
  p.write('\n');
  const s = {};
  if (repoArg) {
    s.repo = path.resolve(repoArg);
    checkRepo(s.repo);
  }
  await runSteps(p, wizardSteps({ repoArg, dryRun }), s);
  return { ...finish(s), confirmed: s.confirmed };
}

// ------------------------------------------------------------- answers -> commands

// [{ label, argv, cwd? }] in the order they must run.
function buildCommands(a) {
  const cmds = [];

  const init = ['init', '--repo', a.repo, '--stack', a.stack.join(','), '--host', a.hosts.join(',')];
  if (a.validationStack) init.push('--validation-stack', a.validationStack);
  init.push('--tracker', a.tracker);
  if (a.projectKey) init.push('--project-key', a.projectKey);
  if (a.render) init.push('--render');
  cmds.push({ label: 'init the repo', argv: init });

  if (a.workspace) {
    cmds.push({ label: 'add it to the workspace', argv: ['workspace', 'add', a.repo, '--config', a.workspace] });
  }
  if (a.docsDir) {
    cmds.push({ label: 'list its docs', argv: ['docs', 'add', a.docsDir, '--repo', a.repo] });
    if (a.render) cmds.push({ label: 'carry the docs into ai/AGENTS.md', argv: ['sync', '--repo', a.repo] });
  }

  // context commands find their repos from a workspace file, or from the current folder.
  const where = a.workspace ? { argv: ['--config', a.workspace] } : { cwd: a.repo, argv: [] };
  if (a.register) {
    cmds.push({ label: 'register the MCP server', argv: ['context', 'register', ...where.argv], cwd: where.cwd });
  }
  if (a.installTools) {
    cmds.push({ label: 'install the code lookup tools', argv: ['context', 'install-tools', ...where.argv], cwd: where.cwd });
  }
  return cmds;
}

// ------------------------------------------------------------------------ run

async function runWizard({ prompter, exec = execCommand, repo, dryRun = false } = {}) {
  const p = prompter;
  const answers = await collectAnswers(p, { repo, dryRun });
  const cmds = buildCommands(answers);

  if (dryRun) {
    printPlan(p, cmds, 'Plan');
    p.write('\n--dry-run: nothing was run.\n');
    return 0;
  }
  if (!answers.confirmed) {
    p.write('Nothing was run. The commands above are what the wizard would have run.\n');
    return 0;
  }

  const { code } = await runCommands(p, exec, cmds);
  if (code) return code;

  printEquivalent(p, cmds, 'Done. The same setup without the wizard:');


  p.write('\nNext:\n');
  p.write('  - install cairn in the repo if it is not there yet:  npm i -D @stonepandastudio/cairn\n');
  if (!answers.installTools) p.write('  - for code lookups:  cairn context install-tools\n');
  p.write('  - ask the agent to run /discover to draft the project contexts\n');
  return 0;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    }
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const prompter = createPrompter();
  try {
    return await runWizard({ prompter, repo: args.repo, dryRun: args.dryRun });
  } catch (err) {
    if (err && err.isBack) {
      console.log('Left the wizard; nothing was run.');
      return 0;
    }
    throw err;
  } finally {
    prompter.close();
  }
}

module.exports = { main, runWizard, collectAnswers, buildCommands, commandLine, HELP };
