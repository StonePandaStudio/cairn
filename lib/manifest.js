'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CAIRN_DIR, cairnDir } = require('./config');

const MANIFEST_NAME = 'manifest.json';
const MANIFEST_VERSION = 1;
const { name: GENERATOR, version: CAIRN_VERSION } = require('../package.json');

// The manifest is what makes "generated" auditable. Without it, a vendored file
// that someone hand-edited is indistinguishable from one cairn wrote — which is
// exactly the failure mode that produced the drift this tool exists to report.
//
// Each entry records the template it came from and the hash of what cairn wrote.
// Comparing that to the hash on disk gives three states instead of one:
//
//   MANAGED   on-disk hash === written hash            nothing to do
//   MODIFIED  on-disk hash !== written hash            someone edited it by hand
//   OUTDATED  written hash !== current template hash   cairn has newer content
//   DELETED   file is gone                             sync will restore it
//   CONFLICT  entry.conflict is set                    `cairn sync` left merge markers
//
// `_cairn/base/<relPath>` holds the bytes of the last clean template render for
// each managed file — the merge base `cairn sync` diffs against. The manifest
// hash is "what is on disk after the last cairn write"; the base file is "what
// the template produced". They diverge once a merge folds local edits back in.

function manifestPath(repoPath) {
  return path.join(cairnDir(repoPath), MANIFEST_NAME);
}

const BASE_DIR = 'base';

function basePath(repoPath, relPath) {
  return path.join(cairnDir(repoPath), BASE_DIR, relPath.replace(/\\/g, '/'));
}

// The last clean template render for `relPath`. `cairn render` and `cairn init`
// write it alongside the real file; `cairn sync` reads it as the merge base and
// rewrites it on every fast-forward or clean merge.
function readBase(repoPath, relPath) {
  const file = basePath(repoPath, relPath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function writeBase(repoPath, relPath, content) {
  const file = basePath(repoPath, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// Normalize before hashing so a CRLF checkout doesn't read as a hand edit. This
// matters here specifically: these repos are Windows-side with mixed .gitattributes.
function hashContent(text) {
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

function emptyManifest() {
  return { version: MANIFEST_VERSION, generator: GENERATOR, files: {} };
}

function readManifest(repoPath) {
  const file = manifestPath(repoPath);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed.files) parsed.files = {};
    return parsed;
  } catch (err) {
    throw new Error(`${file}: invalid JSON — ${err.message}`);
  }
}

// `keepVersion` leaves `cairnVersion` as the manifest already has it (or absent).
// A partial `cairn sync --only` uses it: other files may still be behind, so
// stamping the current version would tell the doctor the repo is up to date.
function writeManifest(repoPath, manifest, { keepVersion = false } = {}) {
  const dir = cairnDir(repoPath);
  fs.mkdirSync(dir, { recursive: true });
  const ordered = {
    version: MANIFEST_VERSION,
    generator: GENERATOR,
    // Which cairn last wrote this manifest — lets `cairn doctor` tell a repo rendered
    // by an older cairn from one that is merely behind on `cairn sync`.
    ...(keepVersion ? (manifest.cairnVersion ? { cairnVersion: manifest.cairnVersion } : {}) : { cairnVersion: CAIRN_VERSION }),
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))),
  };
  fs.writeFileSync(manifestPath(repoPath), JSON.stringify(ordered, null, 2) + '\n', 'utf8');
  return ordered;
}

// Record that cairn wrote `content` to `relPath` from template `source`.
function record(manifest, relPath, source, content, extra = {}) {
  manifest.files[relPath.replace(/\\/g, '/')] = {
    source,
    hash: hashContent(content),
    ...extra,
  };
  return manifest;
}

// Compare every manifest entry against what is actually on disk. `templateHashes`
// is an optional { source -> hash } map; supply it to detect OUTDATED as well.
// `outdatedRels` is the other way in: a Set of repo-relative paths whose current
// template render differs from the recorded merge base (see sync.outdatedRels).
// That is the accurate one — a merged file's manifest hash is not the template's.
function statusFor(repoPath, manifest, templateHashes = null, outdatedRels = null) {
  const results = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const abs = path.join(repoPath, rel);
    if (!fs.existsSync(abs)) {
      results.push({ path: rel, source: entry.source, state: 'DELETED' });
      continue;
    }
    const onDisk = hashContent(fs.readFileSync(abs, 'utf8'));
    if (entry.conflict) {
      results.push({ path: rel, source: entry.source, state: 'CONFLICT' });
      continue;
    }
    if (onDisk !== entry.hash) {
      results.push({ path: rel, source: entry.source, state: 'MODIFIED' });
      continue;
    }
    if (templateHashes && templateHashes[entry.source] && templateHashes[entry.source] !== entry.hash) {
      results.push({ path: rel, source: entry.source, state: 'OUTDATED' });
      continue;
    }
    if (outdatedRels && outdatedRels.has(rel)) {
      results.push({ path: rel, source: entry.source, state: 'OUTDATED' });
      continue;
    }
    results.push({ path: rel, source: entry.source, state: 'MANAGED' });
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

// Header stamped into every generated text file. `cairn doctor` reads the
// manifest rather than this comment, but the comment is what a human sees first.
function header(source, content, comment = 'html') {
  const line = `cairn:generated source=${source} hash=${hashContent(content)} — edit cairn.config.json, not this file`;
  if (comment === 'js') return `// ${line}\n`;
  if (comment === 'hash') return `# ${line}\n`;
  return `<!-- ${line} -->\n`;
}

module.exports = {
  CAIRN_DIR,
  MANIFEST_NAME,
  MANIFEST_VERSION,
  basePath,
  emptyManifest,
  hashContent,
  header,
  manifestPath,
  readBase,
  readManifest,
  record,
  statusFor,
  writeBase,
  writeManifest,
};
