'use strict';

// One-line notes about a repo's config that are not errors: deprecated keys (still honoured) and
// things that will not do what the config intended. cairn never rewrites a hand-edited config, so
// it only reports. Shown by `sync`, `render`, `upgrade` and `doctor`.

const fs = require('fs');
const path = require('path');
const { resolveHosts } = require('./hosts');
const { normalizeDocs } = require('./docs');

// `config` is a loaded repo config (see loadRepoConfig): the raw keys plus `path`, the repo root.
function configNotes(config = {}) {
  const notes = [];
  if (config.codexSkills !== undefined) {
    notes.push(`"codexSkills" is deprecated — use "hosts": ${JSON.stringify(resolveHosts(config))} (it still works)`);
  }
  if (config.docs !== undefined && config.path) {
    let docs = null;
    try {
      docs = normalizeDocs(config.docs);
    } catch {
      // a malformed entry is an error at load time; nothing to add here
    }
    for (const doc of docs || []) {
      if (!fs.existsSync(path.join(config.path, doc.path))) {
        notes.push(`docs: "${doc.path}" does not exist in this repo — the agents are told to read it`);
      }
    }
  }
  return notes;
}

module.exports = { configNotes };
