'use strict';

// cairn shell — an interactive home for the setup commands. It looks at where it was started,
// shows what it found, and offers only the actions that apply there. Each action asks its
// questions and then runs the ordinary cairn commands through their own `main` (see
// lib/wizard), printing the equivalent command lines, so the shell is never required.

const path = require('path');

const { createPrompter } = require('../wizard/prompt');
const { execCommand } = require('../wizard/exec');
const { runWizard } = require('../wizard/cli');
const { detectState } = require('./state');
const { workspaceAction, upgradeAction } = require('./actions');
const { agentCommandsAction, overall } = require('./agent-actions');
const { syncAction, docsAction, doctorAction, contextAction, managedRepos } = require('./repo-actions');

const HELP = `cairn shell — interactive home for the setup commands

Usage: cairn shell [options]
       cairn            (the same, when run in a terminal with no arguments)

  --cwd <path>   start from this folder instead of the current one

Looks at where you are (a cairn repo, part of a workspace, or neither), shows it, and offers
the actions that apply: arrow keys and enter on a terminal, numbered choices when piped.
Every action runs the same commands you could type yourself and prints them afterwards.
`;

function describe(state) {
  const { repo, workspace, running } = state;
  const lines = [];
  if (repo.managed) {
    const stamp = repo.stamp ? (repo.stamp === running ? `cairn ${repo.stamp}` : `stamped ${repo.stamp}, running ${running}`) : 'no version stamp';
    lines.push(`Repo       ${repo.name}  (${stamp}; stack ${repo.stack.join(', ') || 'none'}; hosts ${repo.hosts.join(', ')})`);
    if (repo.note) lines.push(`           ! ${repo.note}`);
  } else {
    lines.push(`Folder     ${repo.path}  (not a cairn repo yet)`);
  }
  if (workspace) {
    const managed = workspace.repos.filter((r) => r.managed).length;
    lines.push(`Workspace  ${workspace.file}  (${workspace.repos.length} repos, ${managed} managed)`);
    if (workspace.note) lines.push(`           ! ${workspace.note}`);
    for (const r of workspace.repos) {
      const status = !r.exists ? 'missing folder' : !r.managed ? 'not set up' : r.stamp === running ? `cairn ${r.stamp}` : `stamped ${r.stamp || '?'}`;
      lines.push(`             - ${r.name}  ${status}`);
    }
  } else {
    lines.push('Workspace  none found');
  }
  const rows = state.agentCommands || [];
  const where = rows.filter((r) => r.current + r.outdated > 0).map((r) => `${r.host} ${r.current}/${r.total}`);
  const stale = overall(rows) === 'outdated' ? '  (out of date)' : '';
  lines.push(`Agent cmds ${where.length ? where.join(', ') + stale : 'not installed (/cairn-init and friends)'}`);
  return lines.join('\n');
}

// The actions that apply to this state: { value, label, hint?, run(ctx) }. The first entry is the
// one most likely wanted, so it is the default.
function buildMenu(state) {
  const items = [];
  const ws = state.workspace;
  if (!state.repo.managed) {
    items.push({
      value: 'init-here',
      label: 'Set up this folder',
      hint: 'init: hosts, stack, tracker, ai/ scaffold',
      run: (ctx) => runWizard({ prompter: ctx.prompter, exec: ctx.exec, repo: state.repo.path, home: state.home }),
    });
  }
  const canUpgrade = ws ? ws.repos.some((r) => r.managed && r.exists) : state.repo.managed;
  if (canUpgrade) {
    items.push({
      value: 'upgrade',
      label: ws ? 'Upgrade cairn in the workspace' : 'Upgrade cairn in this repo',
      hint: 'report first, then apply',
      run: (ctx) => upgradeAction(ctx, state),
    });
  }
  const hasRepo = managedRepos(state).length > 0;
  if (hasRepo) {
    items.push({
      value: 'sync',
      label: 'Sync a repo with the presets',
      hint: 'preview, then a three-way merge',
      run: (ctx) => syncAction(ctx, state),
    });
  }
  items.push({
    value: 'workspace',
    label: ws ? 'Add repos to the workspace' : 'Create a workspace',
    hint: ws ? 'pick repos next to repos.json' : 'a repos.json that groups repos for the agents',
    run: (ctx) => workspaceAction(ctx, state),
  });
  if (hasRepo) {
    items.push({
      value: 'docs',
      label: 'Project docs',
      hint: 'list the docs the agents should read',
      run: (ctx) => docsAction(ctx, state),
    });
    items.push({
      value: 'context',
      label: 'Contexts and code lookups',
      hint: 'check, register the MCP server, install tools',
      run: (ctx) => contextAction(ctx, state),
    });
  }
  if (ws && ws.repos.length) {
    items.push({
      value: 'doctor',
      label: 'Doctor: drift across the workspace',
      hint: 'read-only report',
      run: (ctx) => doctorAction(ctx, state),
    });
  }
  items.push({
    value: 'init-other',
    label: 'Set up another repo',
    hint: 'asks for its folder',
    run: (ctx) => runWizard({ prompter: ctx.prompter, exec: ctx.exec, home: state.home }),
  });
  const agent = overall(state.agentCommands);
  items.push({
    value: 'agent-commands',
    label: agent === 'none' ? 'Install agent commands' : agent === 'outdated' ? 'Update agent commands' : 'Agent commands',
    hint:
      agent === 'none'
        ? '/cairn-init, /cairn-upgrade ... for Claude Code and Codex'
        : agent === 'outdated'
          ? 'the installed skills are older than this cairn'
          : 'installed; reinstall or remove',
    run: (ctx) => agentCommandsAction(ctx, state),
  });
  items.push({ value: 'quit', label: 'Quit' });
  return items;
}

async function runShell({ prompter, exec = execCommand, cwd = process.cwd(), detect = detectState } = {}) {
  const ctx = { prompter, exec };
  let first = true;
  for (;;) {
    const state = detect(cwd);
    prompter.write(`\ncairn ${state.running}\n${describe(state)}\n`);
    if (first && prompter.backHint) prompter.write(`${prompter.backHint}\n`);
    first = false;
    prompter.write('\n');
    const menu = buildMenu(state);
    let picked;
    try {
      picked = await prompter.choose('What next?', menu.map(({ value, label, hint }) => ({ value, label, hint })), 0);
    } catch (err) {
      if (err && err.isBack) return 0; // back at the top of the menu leaves the shell
      throw err;
    }
    const item = menu.find((m) => m.value === picked);
    if (item.value === 'quit') return 0;
    try {
      const code = await item.run(ctx);
      if (code) prompter.write(`\n(that action ended with exit code ${code})\n`);
    } catch (err) {
      if (err && err.isBack) continue; // back out of an action: the menu again
      // A refusal or a bad answer ends the action, not the shell. Cancelling (ctrl+c) or a closed
      // input ends both.
      if (!(err && err.userError) || /^cancelled/.test(err.message) || /^input ended/.test(err.message)) throw err;
      prompter.write(`\n${err.message}\n`);
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  let cwd = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd') cwd = path.resolve(argv[++i] || '.');
    else if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else {
      console.error(`Unknown argument: ${a}`);
      return 2;
    }
  }
  const prompter = createPrompter();
  try {
    return await runShell({ prompter, cwd });
  } finally {
    prompter.close();
  }
}

module.exports = { main, runShell, buildMenu, describe, HELP };
