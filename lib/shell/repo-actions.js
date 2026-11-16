'use strict';

// Shell actions that work on one managed repo (or the whole workspace): sync, project docs, doctor,
// contexts and code lookups. Same rule as actions.js: steps (Esc goes back), ask, build ordinary
// cairn commands, show them, run them through `ctx.exec`, print the equivalent lines. No file is
// touched here.

const fs = require('fs');
const path = require('path');

const { CONFIG_NAME } = require('../config');
const { readJsonFile } = require('../json');
const { runCommands, printEquivalent } = require('../wizard/plan');
const { runSteps, indexOfValue } = require('../wizard/steps');

const DOC_DIRS = ['docs', 'doc', 'docum', 'documentation', 'wiki', 'adr'];

// The managed repos the shell can act on: the workspace's, plus the current one if it is not in it.
function managedRepos(state) {
  const list = state.workspace ? state.workspace.repos.filter((r) => r.managed && r.exists).map((r) => ({ name: r.name, path: r.path })) : [];
  if (state.repo.managed && !list.some((r) => path.resolve(r.path) === path.resolve(state.repo.path))) {
    list.unshift({ name: state.repo.name, path: state.repo.path });
  }
  return list;
}

// The step that picks one repo; it only applies when there is a real choice. With a single repo,
// `s.repo` is preset by `initialRepo`, so there is no prompt to bounce off when going back.
function repoStep(state, text) {
  const repos = managedRepos(state);
  const here = repos.findIndex((r) => path.resolve(r.path) === path.resolve(state.repo.path));
  const options = repos.map((r) => ({ value: r.path, label: r.name, hint: r.path }));
  return {
    id: 'repo',
    when: () => repos.length > 1,
    run: async (p, s) => {
      const value = await p.choose(`\n${text}`, options, indexOfValue(options, s.repo && s.repo.path, Math.max(0, here)));
      s.repo = repos.find((r) => r.path === value);
    },
  };
}

function initialRepo(state) {
  const repos = managedRepos(state);
  return repos.length === 1 ? { repo: repos[0] } : {};
}

// --------------------------------------------------------------------------- sync

async function syncAction(ctx, state) {
  const p = ctx.prompter;
  if (!managedRepos(state).length) return 0;
  const s = initialRepo(state);
  let dryCode = 0;
  await runSteps(
    p,
    [
      repoStep(state, 'Sync which repo'),
      {
        id: 'apply',
        run: async (pp, st) => {
          pp.write('\n(nothing is written yet)\n');
          dryCode = await ctx.exec(['sync', '--repo', st.repo.path, '--dry-run'], {});
          if (dryCode && dryCode !== 3) return;
          st.apply = await pp.confirm('\nApply it? (three-way merge; a conflict is written with git markers, nothing is silently overwritten)', true);
        },
      },
    ],
    s,
  );
  if (dryCode && dryCode !== 3) {
    p.write(`\n(the preview ended with exit code ${dryCode})\n`);
    return dryCode;
  }
  if (!s.apply) {
    p.write('Nothing was applied.\n');
    return 0;
  }
  const real = { label: 'merge preset changes into the repo', argv: ['sync', '--repo', s.repo.path] };
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
  if (!managedRepos(state).length) return 0;
  const s = initialRepo(state);
  let previewCode = 0;

  const have = (st) => docsEntries(st.repo.path);
  const found = (st) => DOC_DIRS.filter((d) => fs.existsSync(path.join(st.repo.path, d)) && !have(st).includes(d) && !have(st).includes(`${d}/`));
  const targetOf = (st) => (st.target === '' ? st.custom : st.target);
  const isFolder = (st) => {
    const t = targetOf(st);
    if (!t) return false;
    const abs = path.resolve(st.repo.path, t);
    return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  };

  await runSteps(
    p,
    [
      repoStep(state, 'Project docs of which repo'),
      {
        id: 'what',
        run: async (pp, st) => {
          const n = have(st).length;
          const options = [
            { value: 'list', label: 'Show the list' },
            { value: 'add', label: 'Add a file or folder', hint: 'a folder becomes one entry per .md file' },
            { value: 'remove', label: 'Remove entries', hint: n ? '' : 'nothing listed' },
            { value: 'back', label: 'Back' },
          ];
          st.what = await pp.choose(`\nProject docs (${n} listed)`, options, indexOfValue(options, st.what, 0));
        },
      },
      {
        id: 'removePick',
        when: (st) => st.what === 'remove' && have(st).length > 0,
        run: async (pp, st) => {
          st.removed = await pp.multi('\nRemove which', have(st).map((d) => ({ value: d, label: d })), []);
        },
      },
      {
        id: 'target',
        when: (st) => st.what === 'add',
        run: async (pp, st) => {
          const options = [...found(st).map((d) => ({ value: d, label: d, hint: 'found in the repo' })), { value: '', label: 'Another path…', hint: 'a file or folder, may be outside the repo (../docs/adr)' }];
          st.target = await pp.choose('\nWhat to add', options, indexOfValue(options, st.target, 0));
        },
      },
      {
        id: 'custom',
        when: (st) => st.what === 'add' && st.target === '',
        run: async (pp, st) => {
          st.custom = await pp.ask('Path (relative to the repo)', st.custom || '');
        },
      },
      {
        id: 'noExpand',
        when: (st) => st.what === 'add' && isFolder(st),
        run: async (pp, st) => {
          st.noExpand = await pp.confirm('Keep the folder as ONE entry (default: one entry per .md file)', Boolean(st.noExpand));
        },
      },
      {
        id: 'addConfirm',
        when: (st) => st.what === 'add' && Boolean(targetOf(st)),
        run: async (pp, st) => {
          pp.write('\n(preview, nothing is written yet)\n');
          previewCode = await ctx.exec(buildDocsAdd({ repo: st.repo.path, target: targetOf(st), noExpand: isFolder(st) && st.noExpand, dryRun: true }), {});
          if (previewCode) return;
          st.confirmed = await pp.confirm('\nAdd it', true);
        },
      },
    ],
    s,
  );

  if (s.what === 'back') return 0;
  if (s.what === 'list') return ctx.exec(['docs', 'list', '--repo', s.repo.path], {});

  if (s.what === 'remove') {
    if (!have(s).length) {
      p.write('\nNothing is listed.\n');
      return 0;
    }
    if (!s.removed.length) return 0;
    const cmd = { label: 'drop the entries', argv: ['docs', 'remove', ...s.removed, '--repo', s.repo.path] };
    const { code } = await runCommands(p, ctx.exec, [cmd]);
    if (!code) printEquivalent(p, [cmd], 'The same without the shell:');
    return code;
  }

  // add
  if (!targetOf(s)) return 0;
  if (previewCode) return previewCode;
  if (!s.confirmed) {
    p.write('Nothing was added.\n');
    return 0;
  }
  const cmds = [{ label: 'list the docs', argv: buildDocsAdd({ repo: s.repo.path, target: targetOf(s), noExpand: isFolder(s) && s.noExpand, dryRun: false }) }];
  // `sync` is what carries the Project docs table into ai/AGENTS.md; only meaningful once ai/ exists.
  if (fs.existsSync(path.join(s.repo.path, 'ai', 'AGENTS.md'))) {
    cmds.push({ label: 'carry the docs into ai/AGENTS.md', argv: ['sync', '--repo', s.repo.path] });
  }
  const { code } = await runCommands(p, ctx.exec, cmds);
  if (!code) printEquivalent(p, cmds, 'Done. The same without the shell:');
  return code;
}

// ------------------------------------------------------------------------- doctor

// Needs a workspace: `cairn doctor` compares repos with each other. No questions to go back over.
async function doctorAction(ctx, state) {
  const p = ctx.prompter;
  const cmd = { label: 'report drift across the workspace', argv: ['doctor', '--config', state.workspace.file] };
  p.write('\n');
  const code = await ctx.exec(cmd.argv, {});
  printEquivalent(p, [cmd], 'The same without the shell:');
  return code;
}

// ------------------------------------------------------------------------ contexts

const CONTEXT_LABELS = {
  check: 'check the contexts',
  register: 'register the MCP server',
  'install-tools': 'install the code lookup tools',
};

async function contextAction(ctx, state) {
  const p = ctx.prompter;
  const repos = managedRepos(state);
  // Where `cairn context …` looks for its repos: the workspace file, or the repo it runs inside.
  const s = state.workspace ? {} : initialRepo(state);
  const needsRepo = !state.workspace;

  await runSteps(
    p,
    [
      {
        id: 'what',
        run: async (pp, st) => {
          const options = [
            { value: 'check', label: 'Check the contexts', hint: 'cairn context check — links and anchors, never fails CI' },
            { value: 'register', label: 'Register the MCP server', hint: 'so the agent hosts can call cairn' },
            { value: 'install-tools', label: 'Install the code lookup tools', hint: 'symbols and references; downloads a language server, takes minutes' },
            { value: 'back', label: 'Back' },
          ];
          st.what = await pp.choose('\nContexts and code lookups', options, indexOfValue(options, st.what, 0));
        },
      },
      { ...repoStep(state, 'Which repo'), when: (st) => st.what !== 'back' && needsRepo && repos.length > 1 },
      {
        id: 'download',
        when: (st) => st.what === 'install-tools',
        run: async (pp, st) => {
          st.confirmed = await pp.confirm('\nThis downloads and warms a language server per repo. Continue', true);
        },
      },
    ],
    s,
  );

  if (s.what === 'back') return 0;
  if (s.what === 'install-tools' && !s.confirmed) {
    p.write('Nothing was run.\n');
    return 0;
  }
  const where = state.workspace ? { argv: ['--config', state.workspace.file], cwd: undefined } : s.repo ? { argv: [], cwd: s.repo.path } : null;
  if (!where) return 0;
  const cmd = { label: CONTEXT_LABELS[s.what], argv: ['context', s.what, ...where.argv], cwd: where.cwd };
  const { code } = await runCommands(p, ctx.exec, [cmd]);
  if (!code) printEquivalent(p, [cmd], 'The same without the shell:');
  return code;
}

module.exports = { syncAction, docsAction, doctorAction, contextAction, managedRepos, docsEntries, buildDocsAdd };
