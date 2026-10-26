'use strict';

// cairn upgrade — walk the repos in a workspace and bring each one up to date:
// update the installed cairn through the repo's own package manager, then run
// `cairn sync` with *that* installed version.
//
// This is deliberately a loop over the two steps a person already runs by hand,
// not a new way to move content. Prompt changes still travel only through a
// version bump plus `cairn sync`; nothing here edits a repo's package.json pin,
// commits, or pushes. Without --apply it only reports.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { resolveRepos } = require('../doctor');
const { installedCairn, pinnedCairn, compareVersions, PACKAGE } = require('../doctor/versions');
const { loadRepoConfig } = require('../config');
const { readManifest } = require('../manifest');
const { planSync, OUTCOME } = require('../sync');
const { checkStack } = require('../presets');
const { makePaint, table } = require('../paint');

const PRESETS_DIR = path.join(__dirname, '..', '..', 'presets');
const RUNNING = require('../../package.json').version;
const RUNNING_BIN = path.join(__dirname, '..', '..', 'bin', 'cairn.js');

const HELP = `cairn upgrade — update cairn in every repo of a workspace, then sync

Usage: cairn upgrade [options]

  --config <file>   workspace repos.json (default: ./repos.json)
  --repo <name>     only this repo (repeatable)
  --apply           do it: update the installed cairn, then run \`cairn sync\`
                    in each repo. Without this flag nothing is written.
  --no-color        disable ANSI colour

Per repo, --apply runs the package manager's update for ${PACKAGE}
(npm / yarn / pnpm, picked from the lockfile), then \`cairn sync\` using the version
now installed in that repo. A repo whose cairn is a link to a checkout is not
updated, only synced. It never commits, pushes, or edits the package.json pin; a
pin that does not allow the new version is reported, not changed.

Exit codes: 0 all clean, 3 a repo has sync conflicts, 1 an update failed.
`;

function parseArgs(argv) {
  const args = { config: 'repos.json', only: [], apply: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--repo') args.only.push(argv[++i]);
    else if (a === '--apply') args.apply = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    }
  }
  return args;
}

// The package manager a repo uses, from its lockfile. npm when there is none.
function packageManager(repoPath) {
  if (fs.existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}

function updateCommand(pm) {
  if (pm === 'yarn') return ['yarn', ['upgrade', PACKAGE]];
  if (pm === 'pnpm') return ['pnpm', ['update', PACKAGE]];
  return ['npm', ['update', PACKAGE, '--no-audit', '--no-fund']];
}

// The sync outcome counts for one repo, as the *running* cairn would render it.
function dryRunSummary(repo) {
  const manifest = readManifest(repo.path);
  if (!manifest || !Object.keys(manifest.files).length) return { note: 'no manifest — not rendered yet' };
  const config = loadRepoConfig(repo.path, { required: true });
  if (!checkStack(config.stack)) return { note: 'unknown stack entry' };
  const { actions } = planSync({ config, presetsDir: PRESETS_DIR, manifest, repoPath: repo.path });
  const counts = {};
  for (const a of actions) counts[a.outcome] = (counts[a.outcome] || 0) + 1;
  const conflicts = (counts[OUTCOME.CONFLICT] || 0) + (counts[OUTCOME.NO_BASE] || 0) + (counts[OUTCOME.UNTRACKED] || 0);
  const moving = (counts[OUTCOME.FAST_FORWARD] || 0) + (counts[OUTCOME.MERGED] || 0) + (counts[OUTCOME.CREATED] || 0) + (counts[OUTCOME.RESTORED] || 0);
  return { moving, conflicts, counts };
}

function run(command, args, cwd) {
  // shell: true so `npm` / `yarn` resolve their .cmd shims on Windows.
  return spawnSync(command, args, { cwd, encoding: 'utf8', shell: true });
}

function upgradeRepo(repo, paint) {
  const row = { repo: repo.name, updated: '—', sync: '—', exit: 0, notes: [] };
  const before = installedCairn(repo.path);

  if (!before) {
    row.notes.push('cairn is not installed here — synced with the running cairn');
  } else if (before.linked) {
    row.notes.push('linked to a checkout — not updated');
  } else {
    const [cmd, cmdArgs] = updateCommand(packageManager(repo.path));
    const res = run(cmd, cmdArgs, repo.path);
    if (res.status !== 0) {
      row.updated = paint.red('failed');
      row.exit = 1;
      row.notes.push((res.stderr || res.stdout || `${cmd} exited ${res.status}`).trim().split('\n').slice(-2).join(' | '));
      return row;
    }
    const after = installedCairn(repo.path);
    row.updated = after && after.version !== before.version ? `${before.version} → ${after.version}` : `${before.version} (current)`;
    const pin = pinnedCairn(repo.path);
    if (after && compareVersions(after.version, RUNNING) < 0) {
      row.notes.push(`still behind ${RUNNING} — the pin ${pin || '?'} may not allow it`);
    }
  }

  // Sync with the cairn now installed in the repo, so the render matches what the
  // repo will run from here on. Falls back to the running cairn when none is.
  const installed = installedCairn(repo.path);
  const bin = installed
    ? path.join(repo.path, 'node_modules', ...PACKAGE.split('/'), 'bin', 'cairn.js')
    : RUNNING_BIN;
  const res = spawnSync(process.execPath, [bin, 'sync', '--no-color'], { cwd: repo.path, encoding: 'utf8' });
  row.exit = res.status === 0 ? row.exit : res.status || 1;
  row.sync = res.status === 0 ? paint.green('clean') : res.status === 3 ? paint.red('CONFLICT') : paint.red(`exit ${res.status}`);
  if (res.status === 3) row.notes.push('resolve the markers, then re-run `cairn sync` in this repo');
  else if (res.status !== 0) row.notes.push((res.stderr || res.stdout || '').trim().split('\n').pop());
  return row;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const configFile = path.resolve(args.config);
  if (!fs.existsSync(configFile)) {
    console.error(`Workspace config not found: ${configFile}`);
    console.error('Run cairn upgrade from the directory holding repos.json, or pass --config <file>.');
    return 2;
  }
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  let repos = resolveRepos(config, path.dirname(configFile));
  if (args.only.length) {
    const unknown = args.only.filter((n) => !repos.some((r) => r.name === n));
    if (unknown.length) {
      console.error(`Not in the workspace: ${unknown.join(', ')}`);
      return 2;
    }
    repos = repos.filter((r) => args.only.includes(r.name));
  }
  const missing = repos.filter((r) => !fs.existsSync(r.path));
  if (missing.length) {
    console.error(`Repo path not found: ${missing.map((r) => r.path).join(', ')}`);
    return 2;
  }

  const paint = makePaint(args.color);
  console.log(paint.bold(`cairn upgrade${args.apply ? '' : ' (report only)'}`) + paint.dim(`  running ${RUNNING}`));
  console.log('');

  if (!args.apply) {
    const rows = repos.map((repo) => {
      const inst = installedCairn(repo.path);
      const state = !inst ? paint.dim('—') : inst.linked ? paint.yellow(`${inst.version} (linked)`) : inst.version;
      let plan;
      try {
        plan = dryRunSummary(repo);
      } catch (e) {
        plan = { note: e.message };
      }
      const sync = plan.note
        ? paint.dim(plan.note)
        : plan.conflicts
          ? paint.red(`${plan.moving} to write, ${plan.conflicts} need a human`)
          : plan.moving
            ? paint.green(`${plan.moving} to write`)
            : paint.dim('up to date');
      const behind = inst && !inst.linked && compareVersions(inst.version, RUNNING) < 0;
      return ['  ' + repo.name, packageManager(repo.path), pinnedCairn(repo.path) || paint.dim('—'), state, behind ? paint.yellow('update') : paint.dim('—'), sync];
    });
    console.log(table(rows, ['  REPO', 'PM', 'PIN', 'INSTALLED', 'PACKAGE', `SYNC (as cairn ${RUNNING})`], paint));
    console.log('');
    console.log(paint.dim('Nothing written. Re-run with --apply to update and sync.'));
    return 0;
  }

  const results = [];
  for (const repo of repos) {
    process.stdout.write(`  ${repo.name} ... `);
    const row = upgradeRepo(repo, paint);
    console.log(row.exit === 0 ? paint.green('done') : row.exit === 3 ? paint.red('conflicts') : paint.red('failed'));
    results.push(row);
  }

  console.log('');
  console.log(
    table(
      results.map((r) => ['  ' + r.repo, r.updated, r.sync, r.notes.join('; ')]),
      ['  REPO', 'CAIRN', 'SYNC', 'NOTES'],
      paint,
    ),
  );
  console.log('');
  console.log(paint.dim('Review `git diff` in each repo, then commit. Nothing was committed or pushed.'));

  if (results.some((r) => r.exit === 1 || (r.exit !== 0 && r.exit !== 3))) return 1;
  return results.some((r) => r.exit === 3) ? 3 : 0;
}

module.exports = { main, parseArgs, packageManager, updateCommand, HELP };
