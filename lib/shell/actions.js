'use strict';

// The shell's multi-step actions. Each one asks, builds a plan of ordinary cairn commands, shows it,
// runs it through `ctx.exec` and prints the equivalent command lines. They never touch a file
// themselves: the commands do.

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME } = require('../config');
const { printPlan, runCommands, printEquivalent } = require('../wizard/plan');
const { readWorkspace, readRepo, WORKSPACE_FILE } = require('./state');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'vendor', 'coverage']);

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// Folders directly under `dir` that look like repos (a .git or a cairn.config.json) and are not
// already in the workspace.
function findRepoCandidates(dir, knownPaths) {
  const known = new Set(knownPaths.map((p) => path.resolve(p)));
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !SKIP_DIRS.has(e.name))
    .map((e) => path.join(dir, e.name))
    .filter((p) => !known.has(path.resolve(p)) && (fs.existsSync(path.join(p, '.git')) || fs.existsSync(path.join(p, CONFIG_NAME))))
    .map((p) => ({ path: p, ...readRepo(p) }));
}

// ---------------------------------------------------------- create / extend a workspace

// Answers: { file, repos: [{ path, stack|null }] }. `stack` is null for a repo that already has a
// cairn.config.json (workspace add reads it from there).
async function askWorkspace(p, state) {
  const existing = state.workspace;
  const dirGuess = state.repo.managed ? path.dirname(state.repo.path) : state.cwd;
  const file = existing ? existing.file : path.resolve(await p.ask('Workspace file (created if missing)', path.join(dirGuess, WORKSPACE_FILE)));
  const ws = existing && existing.file === file ? existing : fs.existsSync(file) ? readWorkspace(file) : null;
  const known = ws ? ws.repos.map((r) => r.path) : [];

  const candidates = findRepoCandidates(path.dirname(file), known);
  let chosen = [];
  if (candidates.length) {
    const options = candidates.map((c) => ({
      value: c.path,
      label: c.name,
      hint: c.managed ? `cairn repo (stack ${(c.stack || []).join(', ') || 'none'})` : 'git repo, not set up yet',
    }));
    const defaults = candidates.map((c, i) => (c.managed ? i : -1)).filter((i) => i >= 0);
    chosen = await p.multi(`\nRepos next to ${path.basename(file)} to add`, options, defaults);
  } else {
    p.write(`\nNo other repos found next to ${file}.\n`);
  }

  for (;;) {
    const extra = await p.ask('Another repo folder (blank to finish)', '');
    if (!extra) break;
    const abs = path.resolve(extra);
    if (!isDir(abs)) p.write(`  not a folder: ${abs}\n`);
    else if (known.map((k) => path.resolve(k)).includes(abs) || chosen.includes(abs)) p.write('  already in the list\n');
    else chosen.push(abs);
  }

  const repos = [];
  for (const repoPath of chosen) {
    const repo = readRepo(repoPath);
    let stack = null;
    if (!repo.managed) {
      stack = await p.ask(`Stack for ${repo.name}, framework first (e.g. nestjs,typeorm; "unknown" for none)`, 'unknown');
    }
    repos.push({ path: repoPath, stack });
  }
  return { file, exists: Boolean(ws) || fs.existsSync(file), repos };
}

function buildWorkspaceCommands(a) {
  if (!a.repos.length) {
    return a.exists ? [] : [{ label: 'create an empty workspace file', argv: ['workspace', 'init', '--config', a.file] }];
  }
  return a.repos.map((r) => {
    const argv = ['workspace', 'add', r.path, '--config', a.file];
    if (r.stack) argv.push('--stack', r.stack);
    return { label: `add ${path.basename(r.path)}`, argv };
  });
}

async function workspaceAction(ctx, state) {
  const p = ctx.prompter;
  const answers = await askWorkspace(p, state);
  const cmds = buildWorkspaceCommands(answers);
  if (!cmds.length) {
    p.write('\nNothing to add.\n');
    return 0;
  }
  printPlan(p, cmds, 'Plan');
  if (!(await p.confirm('\nRun these now', true))) {
    p.write('Nothing was run.\n');
    return 0;
  }
  const { code } = await runCommands(p, ctx.exec, cmds);
  if (code) return code;
  printEquivalent(p, cmds, 'Done. The same without the shell:');
  p.write('\nNext: set up any repo that is not a cairn repo yet ("Set up another repo"), then `cairn context register`.\n');
  return 0;
}

// ------------------------------------------------------------------------ upgrade

// Two phases, the same two the command has: a report that writes nothing, then --apply.
// `cairn upgrade` needs a workspace file, so this only exists where there is one.
function buildUpgradeApply({ file, repos, all, bumpPin }) {
  const argv = ['upgrade', '--config', file, '--apply'];
  if (bumpPin) argv.push('--bump-pin');
  if (!all) for (const name of repos) argv.push('--repo', name);
  return { label: 'update cairn in each repo, then sync it', argv };
}

async function upgradeAction(ctx, state) {
  const p = ctx.prompter;
  const ws = state.workspace;
  const managed = ws.repos.filter((r) => r.managed && r.exists);

  p.write(`\nChecking ${managed.length} repo(s) against cairn ${state.running} (nothing is written)...\n\n`);
  const report = { label: 'report what an upgrade would do', argv: ['upgrade', '--config', ws.file] };
  const reportCode = await ctx.exec(report.argv, { cwd: undefined });
  if (reportCode > 1) p.write(`\n(the report ended with exit code ${reportCode})\n`);

  if (!(await p.confirm('\nApply it? (updates cairn through each repo\'s package manager, then syncs; never commits)', false))) {
    p.write('Nothing was applied.\n');
    return 0;
  }

  const options = managed.map((r) => ({ value: r.name, label: r.name, hint: r.stamp ? `stamped ${r.stamp}` : 'no version stamp' }));
  const picked = await p.multi('\nRepos to upgrade', options, options.map((_, i) => i));
  if (!picked.length) {
    p.write('No repo selected. Nothing was applied.\n');
    return 0;
  }
  const bumpPin = await p.confirm('Rewrite a package.json pin that excludes this version (--bump-pin)', false);

  const cmd = buildUpgradeApply({ file: ws.file, repos: picked, all: picked.length === managed.length, bumpPin });
  printPlan(p, [cmd], 'Plan');
  if (!(await p.confirm('\nRun it now', true))) {
    p.write('Nothing was applied.\n');
    return 0;
  }
  const { code } = await runCommands(p, ctx.exec, [cmd]);
  if (code === 3) {
    p.write('\nSome files conflict. Resolve them, then run `cairn sync --repo <path>` in that repo.\n');
  } else if (code === 0) {
    printEquivalent(p, [cmd], 'Done. The same without the shell:');
  }
  p.write('\nReview `git diff` in each repo and commit when it looks right; cairn never commits.\n');
  return code;
}

module.exports = { workspaceAction, upgradeAction, askWorkspace, buildWorkspaceCommands, buildUpgradeApply, findRepoCandidates };
