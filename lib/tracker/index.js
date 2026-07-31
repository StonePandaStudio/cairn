'use strict';

const { loadEnv, loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const { createJiraServer, TrackerError, NoTransitionError } = require('./jira-server');
const { createNone } = require('./none');

// Provider registry. Adding Linear or GitHub Issues later means adding one entry
// here and one file next to jira-server.js — the workflow layer above only ever
// sees the shared interface.
const PROVIDERS = {
  'jira-server': createJiraServer,
  none: createNone,
};

function listProviders() {
  return Object.keys(PROVIDERS);
}

// Build a tracker straight from a tracker config block plus an env bag.
function createTracker(trackerConfig = {}, env = process.env) {
  const name = trackerConfig.provider || 'none';
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new ConfigError(
      `Unknown tracker provider "${name}". Available: ${listProviders().join(', ')}`,
    );
  }
  return factory(trackerConfig, env);
}

// Build a tracker for a repo: find the repo root, read cairn.config.json, load
// its .env, then construct. This is the entry point the CLI and the shim use.
function trackerForRepo(startDir = process.cwd()) {
  const repoPath = findRepoRoot(startDir);
  if (!repoPath) {
    throw new ConfigError(
      `No cairn.config.json found in ${startDir} or any parent — run \`cairn init\` in the repo root`,
    );
  }
  const config = loadRepoConfig(repoPath, { required: true });
  loadEnv(repoPath, config.tracker.env);
  return { tracker: createTracker(config.tracker), config, repoPath };
}

module.exports = {
  createTracker,
  trackerForRepo,
  listProviders,
  TrackerError,
  NoTransitionError,
};
