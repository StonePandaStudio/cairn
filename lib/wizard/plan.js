'use strict';

// A plan is a list of cairn commands ({ label, argv, cwd? }) that an interactive flow built from the
// user's answers. These helpers show it, run it and print the equivalent command lines, so every
// flow (wizard, shell actions) reports the same way and none of them does work of its own.

function shellQuote(s) {
  return /^[\w@%+=:,./\\-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

function commandLine(argv) {
  return ['cairn', ...argv].map(shellQuote).join(' ');
}

function printPlan(p, cmds, title) {
  p.write(`\n${title}\n`);
  cmds.forEach((c, i) => {
    p.write(`  ${i + 1}. ${c.label}\n       ${commandLine(c.argv)}${c.cwd ? `    (run inside ${c.cwd})` : ''}\n`);
  });
}

// Runs the commands in order; stops at the first non-zero exit and lists what was not run.
// Resolves to { code, ran } with code 0 when all of them passed.
async function runCommands(p, exec, cmds) {
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    p.write(`\n[${i + 1}/${cmds.length}] ${c.label}\n`);
    const code = await exec(c.argv, { cwd: c.cwd });
    if (code) {
      p.write(`\nStopped: \`${commandLine(c.argv)}\` exited with ${code}.\n`);
      const rest = cmds.slice(i + 1);
      if (rest.length) printPlan(p, rest, 'Not run');
      return { code, ran: i + 1 };
    }
  }
  return { code: 0, ran: cmds.length };
}

function printEquivalent(p, cmds, title) {
  p.write(`\n${title}\n`);
  cmds.forEach((c) => p.write(`  ${commandLine(c.argv)}${c.cwd ? `    # from ${c.cwd}` : ''}\n`));
}

module.exports = { shellQuote, commandLine, printPlan, runCommands, printEquivalent };
