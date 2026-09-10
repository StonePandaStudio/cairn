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

const HELP = `cairn — shared AI workflow scaffolding

Usage: cairn <command> [options]

  tracker <cmd> [...]   issue tracker client   (cairn tracker --help)
  doctor [options]      cross-repo drift report (cairn doctor --help)
  init [options]        make a repo cairn-managed (cairn init --help)
  render [options]      scaffold ai/ from the bundled presets (cairn render --help)
  sync [options]        merge preset changes into an already-rendered repo (cairn sync --help)
  version               print version

Run \`cairn <command> --help\` for command options.
`;

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

    case 'version':
    case '--version':
    case '-v':
      console.log(require('../package.json').version);
      return;

    case undefined:
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

main();
