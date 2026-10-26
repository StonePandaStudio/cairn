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
const { installedCairn, pinnedCairn, pinSection, pinAllows, compareVersions, PACKAGE } = require('../doctor/versions');
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
  --bump-pin        with --apply: when a repo's package.json pin excludes this
                    version (on 0.x, ^0.9.0 stops at 0.9.x), rewrite the pin to
                    ^<this version> through the package manager. Without it such
                    a repo is reported as blocked and left alone.
  --no-color        disable ANSI colour

Per repo, --apply runs the package manager's update for ${PACKAGE}
(npm / yarn / pnpm, picked from the lockfile), then \`cairn sync\` using the version
now installed in that repo. A repo whose cairn is a link to a checkout is not
updated, only synced. It never commits or pushes, and it only edits a package.json
pin when you pass --bump-pin. A repo whose pin excludes this version is reported
as blocked and is not synced: syncing with the old install would change nothing
and look clean.

Exit codes: 0 all clean, 3 a repo has sync conflicts, 1 an update failed or was
blocked by a pin.
`;

function parseArgs(argv) {
  const args = { config: 'repos.json', only: [], apply: false, bumpPin: false, color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--repo') args.only.push(argv[++i]);
    else if (a === '--apply') args.apply = true;
    else if (a === '--bump-pin') args.bumpPin = true;
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

// Rewrite the pin to the running version. `dev` keeps it in devDependencies.
function bumpCommand(pm, version, dev = true) {
  const spec = `${PACKAGE}@^${version}`;
  if (pm === 'yarn') return ['yarn', ['add', ...(dev ? ['-D'] : []), spec]];
  if (pm === 'pnpm') return ['pnpm', ['add', ...(dev ? ['-D'] : []), spec]];
  return ['npm', ['install', ...(dev ? ['-D'] : []), spec, '--no-audit', '--no-fund']];
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
  const conflicts =
    (counts[OUTCOME.CONFLICT] || 0) +
    (counts[OUTCOME.NO_BASE] || 0) +
    (counts[OUTCOME.UNTRACKED] || 0) +
    (counts[OUTCOME.HAND_EDITED] || 0);
  const moving = (counts[OUTCOME.FAST_FORWARD] || 0) + (counts[OUTCOME.MERGED] || 0) + (counts[OUTCOME.CREATED] || 0) + (counts[OUTCOME.RESTORED] || 0);
  return { moving, conflicts, counts };
}

// A command line for the shell. Anything outside a plain-word charset is quoted:
// `^` is cmd.exe's escape character, so an unquoted `pkg@^0.10.0` loses its caret.
const shellQuote = (arg) => (/^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : `"${arg}"`);

function run(command, args, cwd) {
  // shell: true so `npm` / `yarn` resolve their .cmd shims on Windows. Passed as one
  // string, not an args array: Node deprecates the array form under a shell (DEP0190)
  // because it only concatenates. Every argument here is a constant or a version
  // read from this package's own package.json.
  return spawnSync([command, ...args.map(shellQuote)].join(' '), { cwd, encoding: 'utf8', shell: true });
}

// Is this repo's pin the reason it cannot reach the running version?
function pinBlocks(repoPath, installedVersion) {
  return compareVersions(installedVersion, RUNNING) < 0 && pinAllows(pinnedCairn(repoPath), RUNNING) === false;
}

function upgradeRepo(repo, paint, { bumpPin = false } = {}) {
  const row = { repo: repo.name, updated: '—', sync: '—', exit: 0, blocked: false, notes: [] };
  const before = installedCairn(repo.path);

  if (!before) {
    row.notes.push('cairn is not installed here — synced with the running cairn');
  } else if (before.linked) {
    row.notes.push('linked to a checkout — not updated');
  } else {
    const pin = pinnedCairn(repo.path);
    const pm = packageManager(repo.path);
    let [cmd, cmdArgs] = updateCommand(pm);

    if (pinBlocks(repo.path, before.version)) {
      if (!bumpPin) {
        row.updated = paint.red(`${before.version} (blocked)`);
        row.sync = paint.dim('skipped');
        row.exit = 1;
        row.blocked = true;
        row.notes.push(`pin ${pin} does not allow ${RUNNING} — re-run with --bump-pin, or edit package.json`);
        return row;
      }
      [cmd, cmdArgs] = bumpCommand(pm, RUNNING, pinSection(repo.path) !== 'dependencies');
      row.notes.push(`pin ${pin} → ^${RUNNING}`);
    }

    const res = run(cmd, cmdArgs, repo.path);
    if (res.status !== 0) {
      row.updated = paint.red('failed');
      row.exit = 1;
      row.notes.push((res.stderr || res.stdout || `${cmd} exited ${res.status}`).trim().split('\n').slice(-2).join(' | '));
      return row;
    }
    const after = installedCairn(repo.path);
    row.updated = after && after.version !== before.version ? `${before.version} → ${after.version}` : `${before.version} (unchanged)`;
    if (after && compareVersions(after.version, RUNNING) < 0) {
      // Still behind after a clean update: the sync below would run the old cairn and
      // report nothing to do. Stop here instead of printing a reassuring "clean".
      row.sync = paint.dim('skipped');
      row.exit = 1;
      row.blocked = true;
      const why = pinAllows(pin, RUNNING) === null ? ` — the pin ${pin || '?'} may not allow it` : ' — is it published yet?';
      row.notes.push(`still on ${after.version}, behind ${RUNNING}${why}`);
      return row;
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
  if (res.status === 3) row.notes.push('needs a human: run `cairn sync --dry-run` in this repo (conflict markers or hand-edited agent docs), then `cairn sync`');
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
    const blockedRepos = [];
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
      const blocked = behind && pinBlocks(repo.path, inst.version);
      if (blocked) blockedRepos.push(repo.name);
      const pkgCell = blocked ? paint.red('pin blocks') : behind ? paint.yellow('update') : paint.dim('—');
      // A blocked repo is not synced by --apply, so for it this preview is what would
      // happen only once the pin is bumped. Say so.
      const syncCell = blocked ? paint.dim(`once the pin allows it: ${plan.note || (plan.conflicts ? `${plan.moving} to write, ${plan.conflicts} need a human` : `${plan.moving} to write`)}`) : sync;
      return ['  ' + repo.name, packageManager(repo.path), pinnedCairn(repo.path) || paint.dim('—'), state, pkgCell, syncCell];
    });
    console.log(table(rows, ['  REPO', 'PM', 'PIN', 'INSTALLED', 'PACKAGE', `SYNC (as cairn ${RUNNING})`], paint));
    console.log('');
    if (blockedRepos.length) {
      console.log(
        paint.yellow(
          `${blockedRepos.join(', ')}: package.json pins cairn below ${RUNNING}. --apply stops there; add --bump-pin to rewrite the pin to ^${RUNNING}.`,
        ),
      );
    }
    console.log(paint.dim('Nothing written. Re-run with --apply to update and sync.'));
    return 0;
  }

  const results = [];
  for (const repo of repos) {
    process.stdout.write(`  ${repo.name} ... `);
    const row = upgradeRepo(repo, paint, { bumpPin: args.bumpPin });
    console.log(row.exit === 0 ? paint.green('done') : row.exit === 3 ? paint.red('conflicts') : row.blocked ? paint.red('blocked') : paint.red('failed'));
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

module.exports = { main, parseArgs, packageManager, updateCommand, bumpCommand, pinBlocks, shellQuote, HELP };
