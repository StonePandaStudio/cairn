'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_NAME = 'cairn.config.json';
const CAIRN_DIR = '_cairn';

// Boundary rule for the whole framework:
//   cairn.config.json  — hand-edited, lives at the repo root, cairn only reads it
//   _cairn/            — cairn writes it, nobody hand-edits it
// Keeping the editable file out of the generated directory is what stops the
// generated directory from slowly acquiring hand-maintained state.

const DEFAULTS = {
  stack: ['unknown'],
  tracker: { provider: 'none' },
  agents: {},
  vars: {},
  // Only nestjs has a validation-stack choice today; harmless/unused by every
  // other stack entry. Not nested under `vars` because it drives which preset
  // partials resolve (render/index.js), not free-form template substitution.
  validationStack: 'zod',
};

const SCOUT_MODELS = ['haiku', 'sonnet', 'opus', 'inherit'];

class ConfigError extends Error {}

// `stack` is a list — the framework first, then composable add-ons
// (`["nestjs", "typeorm"]`). A bare string or a comma-separated string is
// accepted and normalized. The doctor's `cohort: "stack"` groups by the first
// entry; the v2 renderer layers a preset per entry, in order.
function normalizeStack(value) {
  if (Array.isArray(value)) {
    const list = value.map((s) => String(s).trim()).filter(Boolean);
    return list.length ? list : ['unknown'];
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return ['unknown'];
}

function configPath(repoPath) {
  return path.join(repoPath, CONFIG_NAME);
}

function cairnDir(repoPath) {
  return path.join(repoPath, CAIRN_DIR);
}

// Parse a dotenv-ish file. Deliberately minimal — no export keyword, no
// interpolation, no multiline values. The four repos' .env files are flat.
function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Load .env into process.env without clobbering anything already set, so CI
// secrets and shell exports always win over the committed-adjacent file.
function loadEnv(repoPath, relEnv = '.env') {
  const envPath = path.resolve(repoPath, relEnv);
  if (!fs.existsSync(envPath)) return {};
  const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}

function normalizeTracker(tracker) {
  const t = { ...(tracker || {}) };
  t.provider = t.provider || 'none';
  t.issueTypes = { story: 'Story', subtask: 'Sub-task', ...(t.issueTypes || {}) };
  // Which stages the repo named itself. Defaults fill the rest, but only a stage the
  // repo chose is one a workflow step moves an issue to: cairn does not guess that
  // a board has "In Progress" or "Review".
  t.statusesSet = Object.keys(t.statuses || {});
  t.statuses = { todo: 'To Do', inProgress: 'In Progress', done: 'Done', ...(t.statuses || {}) };
  t.env = t.env || '.env';
  // Prepended to every credential var name the provider reads — set it when the
  // repo's app talks to the same tracker with its own credentials and `JIRA_*` /
  // `YOUTRACK_*` would collide. Empty by default.
  t.envPrefix = t.envPrefix || '';
  return t;
}

function validate(cfg, source) {
  if (cfg.tracker.provider !== 'none' && !cfg.tracker.projectKey) {
    throw new ConfigError(`${source}: tracker.provider is "${cfg.tracker.provider}" but tracker.projectKey is missing`);
  }
  // Lands in the scout's YAML frontmatter. Tier aliases only: they follow the
  // latest model of that tier, so no config or generated file pins a version that
  // goes stale.
  const scoutModel = cfg.agents && cfg.agents.scout && cfg.agents.scout.model;
  if (scoutModel !== undefined && !SCOUT_MODELS.includes(scoutModel)) {
    throw new ConfigError(
      `${source}: agents.scout.model "${scoutModel}" must be one of: ${SCOUT_MODELS.join(', ')}`,
    );
  }
  if (cfg.aiKit) {
    throw new ConfigError(`${source}: "aiKit" is the pre-rename key — rename it to "cairn"`);
  }
  return cfg;
}

// Read a repo's config. `fallbackVars` lets the doctor keep working against
// repos that have not been migrated yet: repos.json can still carry an inline
// `vars` block, and it is used only when the repo has no cairn.config.json.
function loadRepoConfig(repoPath, { fallbackVars = null, required = false } = {}) {
  const file = configPath(repoPath);
  if (!fs.existsSync(file)) {
    if (required) {
      throw new ConfigError(`No ${CONFIG_NAME} in ${repoPath} — run \`cairn init\` there first`);
    }
    return {
      ...DEFAULTS,
      tracker: normalizeTracker(null),
      vars: fallbackVars || {},
      unmanaged: true,
      path: repoPath,
    };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${file}: invalid JSON — ${err.message}`);
  }

  const cfg = {
    ...DEFAULTS,
    ...raw,
    stack: normalizeStack(raw.stack),
    tracker: normalizeTracker(raw.tracker),
    agents: raw.agents || {},
    vars: raw.vars || fallbackVars || {},
    unmanaged: false,
    path: repoPath,
    configFile: file,
  };
  return validate(cfg, file);
}

// Walk up from cwd looking for cairn.config.json. Lets `cairn tracker …` be run
// from anywhere inside a repo, which matters because the agents invoke it from
// wherever their session happens to be.
function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_NAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

module.exports = {
  CONFIG_NAME,
  CAIRN_DIR,
  ConfigError,
  cairnDir,
  configPath,
  findRepoRoot,
  loadEnv,
  loadRepoConfig,
  normalizeStack,
  parseEnv,
};
