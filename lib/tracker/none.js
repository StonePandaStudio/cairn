'use strict';

const { TrackerError } = require('./jira-server');

// The null tracker. Repos with no issue tracker (glossr-cli today) still run the
// same workflow commands; the sync points simply become no-ops instead of every
// command stub needing an "if this repo has Jira" branch in prose.
//
// Reads return null, writes report that they were skipped. Nothing throws — a
// no-op tracker that threw would just push the branching back into the callers.

function createNone() {
  const skip = (action) => ({ skipped: true, reason: `tracker.provider is "none"`, action });

  return {
    name: 'none',
    projectKey: null,
    issueTypes: {},
    async listProjects() {
      return [];
    },
    async listStatuses() {
      return [];
    },
    async createIssue() {
      return null;
    },
    async createSubIssue() {
      return null;
    },
    async get() {
      return null;
    },
    async setFields(key) {
      return skip(`setFields ${key}`);
    },
    async appendDescription(key) {
      return skip(`appendDescription ${key}`);
    },
    async setStatus(key, status) {
      return { key, to: status, changed: false, ...skip('setStatus') };
    },
    async closeIssue(key) {
      return { key, results: [], failed: 0, ...skip('closeIssue') };
    },
    async setAssignee(key) {
      return skip(`setAssignee ${key}`);
    },
    toMarkup(markdown) {
      return markdown;
    },
  };
}

module.exports = { createNone, TrackerError };
