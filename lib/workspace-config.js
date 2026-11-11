'use strict';

// Reading and checking a workspace config (`repos.json`). Five commands read it, so the
// shape is checked once, here, and a malformed file is the same one-line UserError everywhere.

const { UserError } = require('./errors');
const { readJsonFile, expect, isObject, typeName } = require('./json');

const COHORTS = ['all', 'stack'];

function validateWorkspace(raw, file) {
  if (!isObject(raw)) {
    throw new UserError(`${file}: the workspace config must be an object with a "repos" array, not ${typeName(raw)}`);
  }
  if (!Array.isArray(raw.repos)) {
    throw new UserError(
      `${file}: needs a "repos" array: [{ "name": "...", "path": "..." }, ...]. Create one with \`cairn workspace init\`.`,
    );
  }
  const seen = new Set();
  raw.repos.forEach((entry, i) => {
    const at = `repos[${i}]`;
    expect(file, at, entry, 'object', { required: true });
    expect(file, `${at}.name`, entry.name, 'string', { required: true });
    expect(file, `${at}.path`, entry.path, 'string', { required: true });
    expect(file, `${at}.stack`, entry.stack, 'stack');
    expect(file, `${at}.role`, entry.role, 'string');
    expect(file, `${at}.vars`, entry.vars, 'object');
    expect(file, `${at}.pathAliases`, entry.pathAliases, 'object');
    for (const [from, to] of Object.entries(entry.pathAliases || {})) {
      expect(file, `${at}.pathAliases["${from}"]`, to, 'string');
    }
    if (seen.has(entry.name)) throw new UserError(`${file}: "${at}.name" duplicates another repo called "${entry.name}"`);
    seen.add(entry.name);
  });
  expect(file, 'shared', raw.shared, 'array');
  (raw.shared || []).forEach((rule, i) => {
    const at = `shared[${i}]`;
    expect(file, at, rule, 'object', { required: true });
    expect(file, `${at}.glob`, rule.glob, 'string', { required: true });
    expect(file, `${at}.cohort`, rule.cohort, 'string');
    if (rule.cohort !== undefined && !COHORTS.includes(rule.cohort)) {
      throw new UserError(`${file}: "${at}.cohort" must be one of: ${COHORTS.join(', ')}`);
    }
    expect(file, `${at}.requires`, rule.requires, 'object');
  });
  expect(file, 'normalize', raw.normalize, 'object');
  expect(file, 'codeSource', raw.codeSource, 'object');
  return raw;
}

// Read, parse and check. Throws UserError with the file and the problem.
function readWorkspaceConfig(file) {
  return validateWorkspace(readJsonFile(file), file);
}

module.exports = { readWorkspaceConfig, validateWorkspace };
