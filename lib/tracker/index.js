'use strict';

const { loadEnv, loadRepoConfig, findRepoRoot, ConfigError } = require('../config');
const jiraServer = require('./jira-server');
const youtrack = require('./youtrack');
const { createJiraServer, TrackerError, NoTransitionError } = jiraServer;
const { createYouTrack } = youtrack;
const { createNone } = require('./none');

// Provider registry. Adding Linear or GitHub Issues later means adding one entry
// here and one file next to jira-server.js — the workflow layer above only ever
// sees the shared interface.
const PROVIDERS = {
  'jira-server': createJiraServer,
  youtrack: createYouTrack,
  none: createNone,
};

function listProviders() {
  return Object.keys(PROVIDERS);
}

// The .env variables a provider reads. `cairn init` prints these as the next step,
// so a youtrack repo is not told to set JIRA_* and vice versa.
const CREDENTIAL_ENV = {
  'jira-server': jiraServer.CREDENTIAL_ENV,
  youtrack: youtrack.CREDENTIAL_ENV,
  none: [],
};

function providerEnv(name, prefix = '') {
  return (CREDENTIAL_ENV[name] || []).map((v) => prefix + v);
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
  providerEnv,
  TrackerError,
  NoTransitionError,
};
