#!/usr/bin/env node
'use strict';

// cairn — shared AI workflow scaffolding for Stone Panda repos.
//
// Surface:
//   cairn tracker <cmd>   issue tracker client (replaces the copied ai/scripts/jira.js)
//   cairn doctor          cross-repo drift report
//   cairn init            make a repo cairn-managed
//   cairn render          scaffold ai/ from the bundled presets (greenfield)
//   cairn sync            three-way merge of preset changes into a rendered repo
//   cairn upgrade         update cairn in every workspace repo, then sync each
//   cairn override        manage ai/local/, a repo's own additions to generated files
//   cairn workspace       add / remove / list the repos in repos.json
//   cairn docs            list the project's own docs for the agents (the "docs" key)
//   cairn context         cross-repo authored context layer (prototype)
//   cairn preset          what the bundled presets offer
//   cairn agent-commands  cairn's own operations as skills for Claude Code / Codex
//   cairn shell           interactive home for the setup commands (bare `cairn` in a terminal)

const HELP = `cairn — shared AI workflow scaffolding

Usage: cairn <command> [options]

  tracker <cmd> [...]   issue tracker client   (cairn tracker --help)
  doctor [options]      cross-repo drift report (cairn doctor --help)
  init [options]        make a repo cairn-managed (cairn init --help)
  render [options]      scaffold ai/ from the bundled presets (cairn render --help)
  sync [options]        merge preset changes into an already-rendered repo (cairn sync --help)
  upgrade [options]     update cairn in every workspace repo, then sync (cairn upgrade --help)
  override <cmd> [...]  manage ai/local/, a repo's own additions to generated files (cairn override --help)
  workspace <cmd> [...] manage the repo list in repos.json (cairn workspace --help)
  docs <cmd> [...]      list the project's own docs for the agents (cairn docs --help)
  context <cmd> [...]   cross-repo authored context layer (cairn context --help)
  preset <cmd> [...]    what the bundled presets offer (cairn preset --help)
  agent-commands <cmd>  cairn's own operations as skills for Claude Code / Codex (cairn agent-commands --help)
  shell [options]       interactive home for the setup commands (also: bare cairn in a terminal)
  version               print version

Run \`cairn <command> --help\` for command options.
`;

// Commands that ask questions are async; a UserError is a one-line message, not a stack trace.
function runAsync(fn) {
  Promise.resolve()
    .then(fn)
    .then(
      (code) => { process.exitCode = code; },
      (err) => {
        if (err && err.userError) {
          console.error(err.message);
          process.exitCode = 2;
          return;
        }
        console.error(err && err.stack ? err.stack : String(err));
        process.exitCode = 1;
      },
    );
}

function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'tracker':
      require('../lib/tracker/cli')(rest);
      return;

    case 'doctor':
      process.exitCode = require('../lib/doctor').main(rest);
      return;

    case 'init':
      process.exitCode = require('../lib/init').main(rest);
      return;

    case 'render':
      process.exitCode = require('../lib/render/cli').main(rest);
      return;

    case 'sync':
      process.exitCode = require('../lib/sync/cli').main(rest);
      return;

    case 'upgrade':
      process.exitCode = require('../lib/upgrade/cli').main(rest);
      return;

    case 'override':
      process.exitCode = require('../lib/override/cli').main(rest);
      return;

    case 'workspace':
      process.exitCode = require('../lib/workspace/cli').main(rest);
      return;

    case 'docs':
      process.exitCode = require('../lib/docs-cli').main(rest);
      return;

    case 'context':
      // async: code providers may run long-lived language servers
      Promise.resolve(require('../lib/context/cli').main(rest)).then(
        (code) => { process.exitCode = code; },
        (err) => {
          if (err && err.userError) {
            console.error(err.message);
            process.exitCode = 2;
            return;
          }
          console.error(err && err.stack ? err.stack : String(err));
          process.exitCode = 1;
        },
      );
      return;

    case 'wizard': // silent alias: the install flow on its own (--repo, --dry-run); not in the docs
      Promise.resolve(require('../lib/wizard/cli').main(rest)).then(
        (code) => { process.exitCode = code; },
        (err) => {
          if (err && err.userError) {
            console.error(err.message);
            process.exitCode = 2;
            return;
          }
          console.error(err && err.stack ? err.stack : String(err));
          process.exitCode = 1;
        },
      );
      return;

    case 'agent-commands':
      process.exitCode = require('../lib/host-commands/cli').main(rest);
      return;

    case 'preset':
      process.exitCode = require('../lib/preset/cli').main(rest);
      return;

    case 'version':
    case '--version':
    case '-v':
      console.log(require('../package.json').version);
      return;

    case undefined:
      if (process.stdin.isTTY && process.stdout.isTTY) {
        runAsync(() => require('../lib/shell/cli').main([]));
        return;
      }
      process.stdout.write(HELP);
      return;

    case 'shell':
      runAsync(() => require('../lib/shell/cli').main(rest));
      return;

    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return;

    default:
      console.error(`Unknown command: ${command}`);
      process.stderr.write(HELP);
      process.exitCode = 2;
  }
}

try {
  main();
} catch (err) {
  if (err && err.userError) {
    console.error(err.message);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
