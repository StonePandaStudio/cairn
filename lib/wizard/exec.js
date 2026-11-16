'use strict';

// Runs one cairn command in-process by argv, e.g. ['init', '--repo', dir]. The wizard never
// reimplements a command: it builds argv and lands here, the same `main` the CLI calls.

const COMMANDS = {
  init: () => require('../init').main,
  render: () => require('../render/cli').main,
  sync: () => require('../sync/cli').main,
  workspace: () => require('../workspace/cli').main,
  docs: () => require('../docs-cli').main,
  context: () => require('../context/cli').main,
};

// Resolves to the exit code. `cwd` is for commands that find the repo from where they run
// (context); it is restored afterwards.
async function execCommand(argv, { cwd } = {}) {
  const [name, ...rest] = argv;
  const load = COMMANDS[name];
  if (!load) throw new Error(`wizard: no runner for "${name}"`);
  const before = process.cwd();
  try {
    if (cwd) process.chdir(cwd);
    return await load()(rest);
  } finally {
    process.chdir(before);
  }
}

module.exports = { execCommand };
