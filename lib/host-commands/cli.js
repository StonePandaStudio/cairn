'use strict';

// cairn agent-commands — install cairn's own operations as skills the agent hosts load from the
// user's home: /cairn-init, /cairn-workspace, /cairn-upgrade, /cairn-sync, /cairn-tools, /cairn-doctor.

const os = require('os');
const path = require('path');

const { listHosts, getHost, normalizeHosts } = require('../hosts');
const { makePaint } = require('../paint');
const { listCommands, install, remove, status, detectHosts } = require('./index');

const HELP = `cairn agent-commands — cairn's own operations as skills for Claude Code and Codex

Usage: cairn agent-commands <command> [options]

  install     write the skills into your home folder (once per machine)
  list        the skills, and what is installed for each host
  remove      delete the skills cairn wrote (hand-edited ones are kept)

Options:
  --host <names>   claude | codex, comma-separated (default: the hosts found in your home folder)
  --dry-run        install, remove: show what would change, write nothing
  --force          install: overwrite a skill you edited; remove: delete it anyway
  --home <dir>     use this folder as the home (default: ${'~'}, for testing)
  --no-color       disable ANSI colour

Skills land in ~/.claude/skills/cairn-*/ (Claude Code: /cairn-init) and ~/.agents/skills/cairn-*/
(Codex: $cairn-init). They work in any repo, including one that has no cairn yet, and they are not
started by the agent on its own. Re-run install after upgrading cairn to refresh them.
`;

function parseArgs(argv) {
  const args = { positional: [], host: null, dryRun: false, force: false, home: os.homedir(), color: process.stdout.isTTY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host' || a === '--hosts') args.host = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--home') args.home = path.resolve(argv[++i] || '.');
    else if (a === '--no-color') args.color = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown argument: ${a}`);
      return { error: 2 };
    } else args.positional.push(a);
  }
  return args;
}

const withSkills = () => listHosts().filter((h) => getHost(h).userSkills);

function resolveHosts(args) {
  const hosts = args.host ? normalizeHosts(args.host) : detectHosts(args.home).filter((h) => withSkills().includes(h));
  const bad = hosts.filter((h) => !withSkills().includes(h));
  if (bad.length) throw new Error(`no user-level skills for: ${bad.join(', ')}`);
  return hosts;
}

function summarize(results, verbs, paint) {
  const hosts = [...new Set(results.map((r) => r.host))];
  for (const host of hosts) {
    const mine = results.filter((r) => r.host === host && r.rel.endsWith('SKILL.md'));
    const counts = {};
    for (const r of mine) counts[r.status] = (counts[r.status] || 0) + 1;
    const parts = verbs.filter((v) => counts[v]).map((v) => `${counts[v]} ${v}`);
    console.log(`  ${paint.bold(host.padEnd(7))} ${parts.join(', ') || 'nothing to do'}`);
    for (const r of results.filter((x) => x.host === host && x.status === 'kept')) {
      console.log(paint.yellow(`    kept ${r.file}  (edited by hand, or not written by cairn — pass --force to replace)`));
    }
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) return args.error;
  const [command] = args.positional;
  if (args.help || !command) {
    process.stdout.write(HELP);
    return args.help || !command ? (args.help ? 0 : 2) : 0;
  }
  const paint = makePaint(args.color);

  let hosts;
  try {
    hosts = resolveHosts(args);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const commands = listCommands();

  if (command === 'install') {
    const results = install({ hosts, home: args.home, dryRun: args.dryRun, force: args.force, commands });
    console.log(paint.bold(`cairn agent-commands install${args.dryRun ? ' --dry-run' : ''}`));
    summarize(results, ['new', 'updated', 'forced', 'unchanged', 'kept'], paint);
    if (!args.dryRun) {
      console.log(paint.dim(`\n  ${commands.map((c) => c.name).join(', ')}`));
      if (hosts.includes('claude')) console.log(paint.dim('  Claude Code: type /cairn-init (restart the session if it was open)'));
      if (hosts.includes('codex')) console.log(paint.dim('  Codex: type $cairn-init (restart the session if it was open)'));
    }
    return results.some((r) => r.status === 'kept') ? 3 : 0;
  }

  if (command === 'remove') {
    const results = remove({ hosts, home: args.home, dryRun: args.dryRun, force: args.force, commands });
    console.log(paint.bold(`cairn agent-commands remove${args.dryRun ? ' --dry-run' : ''}`));
    summarize(results, ['removed', 'absent', 'kept'], paint);
    return results.some((r) => r.status === 'kept') ? 3 : 0;
  }

  if (command === 'list') {
    console.log(paint.bold('cairn agent-commands'));
    for (const c of commands) console.log(`  ${c.name.padEnd(18)} ${paint.dim(c.description)}`);
    console.log('');
    for (const row of status({ hosts, home: args.home, commands })) {
      const bits = [`${row.current}/${row.total} current`];
      if (row.outdated) bits.push(paint.yellow(`${row.outdated} outdated or edited`));
      if (row.missing) bits.push(paint.dim(`${row.missing} not installed`));
      console.log(`  ${paint.bold(row.host.padEnd(7))} ${bits.join(', ')}`);
    }
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  process.stdout.write(HELP);
  return 2;
}

module.exports = { main, HELP };
