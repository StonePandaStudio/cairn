'use strict';

// Shell actions that work on one managed repo (or the whole workspace): sync, project docs, doctor,
// contexts and code lookups. Same rule as actions.js: ask, build ordinary cairn commands, show them,
// run them through `ctx.exec`, print the equivalent lines. No file is touched here.

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME } = require('../config');
const { readJsonFile } = require('../json');
const { runCommands, printEquivalent } = require('../wizard/plan');

const DOC_DIRS = ['docs', 'doc', 'docum', 'documentation', 'wiki', 'adr'];

// The managed repos the shell can act on: the workspace's, plus the current one if it is not in it.
function managedRepos(state) {
  const list = state.workspace ? state.workspace.repos.filter((r) => r.managed && r.exists).map((r) => ({ name: r.name, path: r.path })) : [];
  if (state.repo.managed && !list.some((r) => path.resolve(r.path) === path.resolve(state.repo.path))) {
    list.unshift({ name: state.repo.name, path: state.repo.path });
  }
  return list;
}

// One repo: the only one, or a choice with the current one first.
async function pickRepo(p, state, text = 'Which repo') {
  const repos = managedRepos(state);
  if (!repos.length) return null;
  if (repos.length === 1) return repos[0];
  const here = repos.findIndex((r) => path.resolve(r.path) === path.resolve(state.repo.path));
  const value = await p.choose(`\n${text}`, repos.map((r) => ({ value: r.path, label: r.name, hint: r.path })), Math.max(0, here));
  return repos.find((r) => r.path === value);
}

// --------------------------------------------------------------------------- sync

async function syncAction(ctx, state) {
  const p = ctx.prompter;
  const repo = await pickRepo(p, state, 'Sync which repo');
  if (!repo) return 0;
  const dry = { label: 'show what a sync would change', argv: ['sync', '--repo', repo.path, '--dry-run'] };
  const real = { label: 'merge preset changes into the repo', argv: ['sync', '--repo', repo.path] };

  p.write('\n(nothing is written yet)\n');
  const dryCode = await ctx.exec(dry.argv, {});
  if (dryCode && dryCode !== 3) {
    p.write(`\n(the preview ended with exit code ${dryCode})\n`);
    return dryCode;
  }
  if (!(await p.confirm('\nApply it? (three-way merge; a conflict is written with git markers, nothing is silently overwritten)', true))) {
    p.write('Nothing was applied.\n');
    return 0;
  }
  const { code } = await runCommands(p, ctx.exec, [real]);
  if (code === 3) p.write('\nSome files conflict. Resolve the markers, or `cairn sync --reset <path>` to take the template.\n');
  else if (code === 0) printEquivalent(p, [real], 'Done. The same without the shell:');
  return code;
}

// --------------------------------------------------------------------------- docs

function docsEntries(repoPath) {
  try {
    const cfg = readJsonFile(path.join(repoPath, CONFIG_NAME));
    return (Array.isArray(cfg.docs) ? cfg.docs : []).map((d) => (typeof d === 'string' ? d : d && d.path)).filter(Boolean);
  } catch {
    return [];
  }
}

function buildDocsAdd({ repo, target, noExpand, dryRun }) {
  const argv = ['docs', 'add', target, '--repo', repo];
  if (noExpand) argv.push('--no-expand');
  if (dryRun) argv.push('--dry-run');
  return argv;
}

async function docsAction(ctx, state) {
  const p = ctx.prompter;
  const repo = await pickRepo(p, state, 'Project docs of which repo');
  if (!repo) return 0;
  const have = docsEntries(repo.path);

  const what = await p.choose(`\nProject docs (${have.length} listed)`, [
    { value: 'list', label: 'Show the list' },
    { value: 'add', label: 'Add a file or folder', hint: 'a folder becomes one entry per .md file' },
    { value: 'remove', label: 'Remove entries', hint: have.length ? '' : 'nothing listed' },
    { value: 'back', label: 'Back' },
  ]);
  if (what === 'back') return 0;

  if (what === 'list') return ctx.exec(['docs', 'list', '--repo', repo.path], {});

  if (what === 'remove') {
    if (!have.length) {
      p.write('\nNothing is listed.\n');
      return 0;
    }
    const picked = await p.multi('\nRemove which', have.map((d) => ({ value: d, label: d })), []);
    if (!picked.length) return 0;
    const cmd = { label: 'drop the entries', argv: ['docs', 'remove', ...picked, '--repo', repo.path] };
    const { code } = await runCommands(p, ctx.exec, [cmd]);
    if (!code) printEquivalent(p, [cmd], 'The same without the shell:');
    return code;
  }

  // add
  const found = DOC_DIRS.filter((d) => fs.existsSync(path.join(repo.path, d)) && !have.includes(d) && !have.includes(`${d}/`));
  const options = [...found.map((d) => ({ value: d, label: d, hint: 'found in the repo' })), { value: '', label: 'Another path…', hint: 'a file or folder, may be outside the repo (../docs/adr)' }];
  let target = await p.choose('\nWhat to add', options, 0);
  if (!target) target = await p.ask('Path (relative to the repo)', '');
  if (!target) return 0;

  const abs = path.resolve(repo.path, target);
  const isFolder = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  const noExpand = isFolder ? await p.confirm('Keep the folder as ONE entry (default: one entry per .md file)', false) : false;

  p.write('\n(preview, nothing is written yet)\n');
  const previewCode = await ctx.exec(buildDocsAdd({ repo: repo.path, target, noExpand, dryRun: true }), {});
  if (previewCode) return previewCode;
  if (!(await p.confirm('\nAdd it', true))) {
    p.write('Nothing was added.\n');
    return 0;
  }
  const cmds = [{ label: 'list the docs', argv: buildDocsAdd({ repo: repo.path, target, noExpand, dryRun: false }) }];
  // `sync` is what carries the Project docs table into ai/AGENTS.md; only meaningful once ai/ exists.
  if (fs.existsSync(path.join(repo.path, 'ai', 'AGENTS.md'))) {
    cmds.push({ label: 'carry the docs into ai/AGENTS.md', argv: ['sync', '--repo', repo.path] });
  }
  const { code } = await runCommands(p, ctx.exec, cmds);
  if (!code) printEquivalent(p, cmds, 'Done. The same without the shell:');
  return code;
}

// ------------------------------------------------------------------------- doctor

// Needs a workspace: `cairn doctor` compares repos with each other.
async function doctorAction(ctx, state) {
  const p = ctx.prompter;
  const file = state.workspace.file;
  const cmd = { label: 'report drift across the workspace', argv: ['doctor', '--config', file] };
  p.write('\n');
  const code = await ctx.exec(cmd.argv, {});
  printEquivalent(p, [cmd], 'The same without the shell:');
  return code;
}

// ------------------------------------------------------------------------ contexts

// Where `cairn context …` looks for its repos: the workspace file, or the repo it runs inside.
async function contextTarget(p, state) {
  if (state.workspace) return { argv: ['--config', state.workspace.file], cwd: undefined };
  const repo = await pickRepo(p, state, 'Which repo');
  return repo ? { argv: [], cwd: repo.path } : null;
}

async function contextAction(ctx, state) {
  const p = ctx.prompter;
  const what = await p.choose('\nContexts and code lookups', [
    { value: 'check', label: 'Check the contexts', hint: 'cairn context check — links and anchors, never fails CI' },
    { value: 'register', label: 'Register the MCP server', hint: 'so the agent hosts can call cairn' },
    { value: 'install-tools', label: 'Install the code lookup tools', hint: 'symbols and references; downloads a language server, takes minutes' },
    { value: 'back', label: 'Back' },
  ]);
  if (what === 'back') return 0;

  const target = await contextTarget(p, state);
  if (!target) return 0;
  const cmd = { label: what === 'check' ? 'check the contexts' : what === 'register' ? 'register the MCP server' : 'install the code lookup tools', argv: ['context', what, ...target.argv], cwd: target.cwd };

  if (what === 'install-tools' && !(await p.confirm('\nThis downloads and warms a language server per repo. Continue', true))) {
    p.write('Nothing was run.\n');
    return 0;
  }
  const { code } = await runCommands(p, ctx.exec, [cmd]);
  if (!code) printEquivalent(p, [cmd], 'The same without the shell:');
  return code;
}

module.exports = { syncAction, docsAction, doctorAction, contextAction, managedRepos, pickRepo, docsEntries, buildDocsAdd };
