'use strict';

// Which cairn each repo is actually running — the axis `cairn doctor` was blind to.
//
// A repo has three versions that can disagree:
//
//   pin        what package.json asks for                 (^0.9.0)
//   installed  what is in node_modules right now          (0.9.1, or a linked checkout)
//   rendered   which cairn last wrote _cairn/manifest.json (0.9.1)
//
// Prompt changes arrive only via a version bump and `cairn sync`, so a repo whose
// installed cairn is older than the others — or whose rendered files are older than
// its installed cairn — is a repo whose agents are following stale instructions.

const fs = require('fs');
const path = require('path');

const { readManifest } = require('../manifest');

const PACKAGE = '@stonepandastudio/cairn';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// -1 / 0 / 1 on the numeric x.y.z core. Pre-release tags are ignored; cairn
// does not publish them, and a wrong ordering there is harmless.
function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// What is in node_modules, and whether it is a link to a checkout rather than a
// real install. A symlink (a junction on Windows reports the same way) means the
// repo runs whatever is on disk in the checkout, not a published version.
function installedCairn(repoPath) {
  const dir = path.join(repoPath, 'node_modules', ...PACKAGE.split('/'));
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!pkg) return null;
  let linked = false;
  try {
    linked = fs.lstatSync(dir).isSymbolicLink();
  } catch {
    /* treat as not linked */
  }
  return { version: pkg.version, linked };
}

function pinnedCairn(repoPath) {
  const pkg = readJson(path.join(repoPath, 'package.json'));
  if (!pkg) return null;
  return (pkg.devDependencies && pkg.devDependencies[PACKAGE]) || (pkg.dependencies && pkg.dependencies[PACKAGE]) || null;
}

// Which section of package.json holds the pin, so a rewritten pin lands in the
// same place it was.
function pinSection(repoPath) {
  const pkg = readJson(path.join(repoPath, 'package.json'));
  if (!pkg) return null;
  if (pkg.devDependencies && pkg.devDependencies[PACKAGE]) return 'devDependencies';
  if (pkg.dependencies && pkg.dependencies[PACKAGE]) return 'dependencies';
  return null;
}

// Does a package.json range admit `version`? true / false, or null when the range
// is something this does not parse (a `||` union, a tag, a git or file spec) — the
// caller then makes no claim instead of guessing. Covers what a pin on cairn
// actually looks like: exact, ^, ~, >=, and the wildcards.
function pinAllows(pin, version) {
  if (!pin) return null;
  const range = String(pin).trim();
  if (range === '*' || range === 'latest' || range === 'x') return true;
  const m = range.match(/^(\^|~|>=|=)?\s*v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const [, op, major, minor, patch] = m;
  const base = `${major}.${minor}.${patch}`;
  const cmp = compareVersions(version, base);
  const [vMajor, vMinor] = String(version).split('-')[0].split('.').map(Number);
  if (!op || op === '=') return cmp === 0;
  if (op === '>=') return cmp >= 0;
  if (cmp < 0) return false;
  if (op === '~') return vMajor === Number(major) && vMinor === Number(minor);
  // ^ keeps the left-most non-zero part fixed: ^1.2.3 = 1.x, ^0.9.0 = 0.9.x, ^0.0.3 = 0.0.3.
  if (Number(major) > 0) return vMajor === Number(major);
  if (Number(minor) > 0) return vMajor === 0 && vMinor === Number(minor);
  return cmp === 0;
}

function renderedWith(repoPath) {
  try {
    const m = readManifest(repoPath);
    return (m && m.cairnVersion) || null;
  } catch {
    return null;
  }
}

// One row per repo. `running` is the cairn doing the checking — the reference
// version a repo's install is compared against.
function collectVersions(repos, running) {
  return repos.map((repo) => {
    const installed = installedCairn(repo.path);
    const rendered = renderedWith(repo.path);
    const row = {
      repo: repo.name,
      pin: pinnedCairn(repo.path),
      installed: installed ? installed.version : null,
      linked: installed ? installed.linked : false,
      rendered,
      notes: [],
    };
    if (!installed) {
      row.notes.push('cairn not installed');
    } else if (installed.linked) {
      row.notes.push('LINKED to a checkout, not a published version');
    } else if (compareVersions(installed.version, running) < 0) {
      row.notes.push(`BEHIND: installed ${installed.version}, running ${running}`);
    }
    // Rendered by an older cairn than the one now installed: update done, sync not.
    if (installed && rendered && compareVersions(rendered, installed.version) < 0) {
      row.notes.push(`run cairn sync (rendered by ${rendered})`);
    }
    if (installed && !rendered) row.notes.push('manifest records no cairn version yet');
    return row;
  });
}

// Whether the real installs (not links) disagree with each other.
function hasSkew(rows) {
  const versions = new Set(rows.filter((r) => r.installed && !r.linked).map((r) => r.installed));
  return versions.size > 1;
}

module.exports = {
  PACKAGE,
  collectVersions,
  compareVersions,
  hasSkew,
  installedCairn,
  pinnedCairn,
  pinSection,
  pinAllows,
};
