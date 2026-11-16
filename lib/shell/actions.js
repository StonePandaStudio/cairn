'use strict';

// The shell's multi-step actions. Each one is a list of steps (lib/wizard/steps.js, so Esc goes back
// one step), builds a plan of ordinary cairn commands, shows it, runs it through `ctx.exec` and
// prints the equivalent command lines. They never touch a file themselves: the commands do.

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME } = require('../config');
const { printPlan, runCommands, printEquivalent } = require('../wizard/plan');
const { runSteps } = require('../wizard/steps');
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

function workspaceSteps(state) {
  const existing = state.workspace;
  const dirGuess = state.repo.managed ? path.dirname(state.repo.path) : state.cwd;
  const known = (s) => {
    const ws = existing && existing.file === s.file ? existing : fs.existsSync(s.file) ? readWorkspace(s.file) : null;
    return ws ? ws.repos.map((r) => r.path) : [];
  };
  const candidates = (s) => findRepoCandidates(path.dirname(s.file), known(s));
  const picked = (s) => [...(s.chosen || []), ...(s.extras || [])];

  return [
    {
      id: 'file',
      when: () => !existing,
      run: async (p, s) => {
        s.file = path.resolve(await p.ask('Workspace file (created if missing)', s.file || path.join(dirGuess, WORKSPACE_FILE)));
      },
    },
    {
      id: 'pick',
      when: (s) => candidates(s).length > 0,
      run: async (p, s) => {
        const list = candidates(s);
        const options = list.map((c) => ({
          value: c.path,
          label: c.name,
          hint: c.managed ? `cairn repo (stack ${(c.stack || []).join(', ') || 'none'})` : 'git repo, not set up yet',
        }));
        const defaults = s.chosen ? options.map((o, i) => (s.chosen.includes(o.value) ? i : -1)).filter((i) => i >= 0) : list.map((c, i) => (c.managed ? i : -1)).filter((i) => i >= 0);
        s.chosen = await p.multi(`\nRepos next to ${path.basename(s.file)} to add`, options, defaults);
      },
    },
    {
      id: 'extras',
      run: async (p, s) => {
        if (!candidates(s).length) p.write(`\nNo other repos found next to ${s.file}.\n`);
        s.chosen = s.chosen || [];
        s.extras = [];
        for (;;) {
          const extra = await p.ask('Another repo folder (blank to finish)', '');
          if (!extra) break;
          const abs = path.resolve(extra);
          if (!isDir(abs)) p.write(`  not a folder: ${abs}\n`);
          else if (known(s).map((k) => path.resolve(k)).includes(abs) || picked(s).includes(abs)) p.write('  already in the list\n');
          else s.extras.push(abs);
        }
      },
    },
    {
      id: 'stacks',
      when: (s) => picked(s).some((r) => !readRepo(r).managed),
      run: async (p, s) => {
        s.stacks = s.stacks || {};
        for (const repoPath of picked(s)) {
          const repo = readRepo(repoPath);
          if (repo.managed) continue;
          s.stacks[repoPath] = await p.ask(`Stack for ${repo.name}, framework first (e.g. nestjs,typeorm; "unknown" for none)`, s.stacks[repoPath] || 'unknown');
        }
      },
    },
    {
      id: 'confirm',
      when: (s) => buildWorkspaceCommands(workspaceAnswers(s)).length > 0,
      run: async (p, s) => {
        printPlan(p, buildWorkspaceCommands(workspaceAnswers(s)), 'Plan');
        s.confirmed = await p.confirm('\nRun these now', true);
      },
    },
  ];
}

// Plain answers: { file, exists, repos: [{ path, stack|null }] }. `stack` is null for a repo that
// already has a cairn.config.json (workspace add reads it from there).
function workspaceAnswers(s) {
  const repos = [...(s.chosen || []), ...(s.extras || [])].map((repoPath) => ({
    path: repoPath,
    stack: readRepo(repoPath).managed ? null : (s.stacks && s.stacks[repoPath]) || 'unknown',
  }));
  return { file: s.file, exists: fs.existsSync(s.file), repos };
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
  const s = state.workspace ? { file: state.workspace.file } : {};
  await runSteps(p, workspaceSteps(state), s);
  const cmds = buildWorkspaceCommands(workspaceAnswers(s));
  if (!cmds.length) {
    p.write('\nNothing to add.\n');
    return 0;
  }
  if (!s.confirmed) {
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
  const options = managed.map((r) => ({ value: r.name, label: r.name, hint: r.stamp ? `stamped ${r.stamp}` : 'no version stamp' }));

  p.write(`\nChecking ${managed.length} repo(s) against cairn ${state.running} (nothing is written)...\n\n`);
  const reportCode = await ctx.exec(['upgrade', '--config', ws.file], { cwd: undefined });
  if (reportCode > 1) p.write(`\n(the report ended with exit code ${reportCode})\n`);

  const s = {};
  const cmdOf = (st) => buildUpgradeApply({ file: ws.file, repos: st.repos, all: st.repos.length === managed.length, bumpPin: st.bumpPin });
  await runSteps(
    p,
    [
      {
        id: 'apply',
        run: async (pp, st) => {
          st.apply = await pp.confirm("\nApply it? (updates cairn through each repo's package manager, then syncs; never commits)", Boolean(st.apply));
        },
      },
      {
        id: 'repos',
        when: (st) => st.apply,
        run: async (pp, st) => {
          const defaults = st.repos ? options.map((o, i) => (st.repos.includes(o.value) ? i : -1)).filter((i) => i >= 0) : options.map((_, i) => i);
          st.repos = await pp.multi('\nRepos to upgrade', options, defaults);
        },
      },
      {
        id: 'bump',
        when: (st) => st.apply && st.repos.length > 0,
        run: async (pp, st) => {
          st.bumpPin = await pp.confirm('Rewrite a package.json pin that excludes this version (--bump-pin)', Boolean(st.bumpPin));
        },
      },
      {
        id: 'run',
        when: (st) => st.apply && st.repos.length > 0,
        run: async (pp, st) => {
          printPlan(pp, [cmdOf(st)], 'Plan');
          st.confirmed = await pp.confirm('\nRun it now', true);
        },
      },
    ],
    s,
  );

  if (!s.apply || !s.confirmed) {
    p.write(s.apply && !s.repos.length ? 'No repo selected. Nothing was applied.\n' : 'Nothing was applied.\n');
    return 0;
  }
  const cmd = cmdOf(s);
  const { code } = await runCommands(p, ctx.exec, [cmd]);
  if (code === 3) {
    p.write('\nSome files conflict. Resolve them, then run `cairn sync --repo <path>` in that repo.\n');
  } else if (code === 0) {
    printEquivalent(p, [cmd], 'Done. The same without the shell:');
  }
  p.write('\nReview `git diff` in each repo and commit when it looks right; cairn never commits.\n');
  return code;
}

module.exports = { workspaceAction, upgradeAction, buildWorkspaceCommands, buildUpgradeApply, findRepoCandidates };
