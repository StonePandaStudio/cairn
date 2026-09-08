'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CAIRN_DIR, cairnDir } = require('./config');

const MANIFEST_NAME = 'manifest.json';
const MANIFEST_VERSION = 1;
const GENERATOR = require('../package.json').name;

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

function manifestPath(repoPath) {
  return path.join(cairnDir(repoPath), MANIFEST_NAME);
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

function writeManifest(repoPath, manifest) {
  const dir = cairnDir(repoPath);
  fs.mkdirSync(dir, { recursive: true });
  const ordered = {
    version: MANIFEST_VERSION,
    generator: GENERATOR,
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
function statusFor(repoPath, manifest, templateHashes = null) {
  const results = [];
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const abs = path.join(repoPath, rel);
    if (!fs.existsSync(abs)) {
      results.push({ path: rel, source: entry.source, state: 'DELETED' });
      continue;
    }
    const onDisk = hashContent(fs.readFileSync(abs, 'utf8'));
    if (onDisk !== entry.hash) {
      results.push({ path: rel, source: entry.source, state: 'MODIFIED' });
      continue;
    }
    if (templateHashes && templateHashes[entry.source] && templateHashes[entry.source] !== entry.hash) {
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
  emptyManifest,
  hashContent,
  header,
  manifestPath,
  readManifest,
  record,
  statusFor,
  writeManifest,
};
