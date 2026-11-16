'use strict';

// The shell's "agent commands" action: install, refresh or remove cairn's own skills for the agent
// hosts (see lib/host-commands). Same shape as the other actions: steps (Esc goes back), ordinary
// cairn commands through `ctx.exec`, equivalent lines printed.

const { listHosts, getHost } = require('../hosts');
const { runCommands, printEquivalent } = require('../wizard/plan');
const { runSteps } = require('../wizard/steps');
const { detectHosts } = require('../host-commands');

const withSkills = () => listHosts().filter((h) => getHost(h).userSkills);

// 'none' | 'outdated' | 'current' from the per-host rows of host-commands.status().
function overall(rows) {
  if (!rows || !rows.length) return 'none';
  if (rows.every((r) => r.current === 0 && r.outdated === 0)) return 'none';
  return rows.some((r) => r.outdated > 0 || (r.missing > 0 && r.current + r.outdated > 0)) ? 'outdated' : 'current';
}

// Only a non-default home (tests, --cwd tricks) goes on the command line; the usual one stays implicit.
const argvHome = (state) => (state.home && state.home !== require('os').homedir() ? state.home : null);

function buildAgentCommand({ what, hosts, home, dryRun }) {
  const argv = ['agent-commands', what, '--host', hosts.join(',')];
  if (home) argv.push('--home', home);
  if (dryRun) argv.push('--dry-run');
  return argv;
}

async function agentCommandsAction(ctx, state) {
  const p = ctx.prompter;
  const rows = state.agentCommands || [];
  const installed = overall(rows) !== 'none';
  const hostOptions = withSkills().map((h) => {
    const row = rows.find((r) => r.host === h);
    const hint = row && row.current + row.outdated > 0 ? `${row.current}/${row.total} current` : 'not installed';
    return { value: h, label: getHost(h).label || h, hint };
  });
  const detected = detectHosts(state.home);
  const defaults = hostOptions.map((o, i) => (detected.includes(o.value) ? i : -1)).filter((i) => i >= 0);
  const s = { what: 'install' };
  let previewCode = 0;

  await runSteps(
    p,
    [
      {
        id: 'what',
        when: () => installed,
        run: async (pp, st) => {
          const options = [
            { value: 'install', label: overall(rows) === 'outdated' ? 'Update the skills' : 'Reinstall the skills' },
            { value: 'remove', label: 'Remove the skills', hint: 'only the ones cairn wrote and you did not edit' },
          ];
          st.what = await pp.choose('\nAgent commands', options, st.what === 'remove' ? 1 : 0);
        },
      },
      {
        id: 'hosts',
        run: async (pp, st) => {
          const idx = st.hosts ? hostOptions.map((o, i) => (st.hosts.includes(o.value) ? i : -1)).filter((i) => i >= 0) : defaults;
          st.hosts = await pp.multi('\nWhich agent hosts', hostOptions, idx);
          if (!st.hosts.length) pp.write('  none selected\n');
        },
      },
      {
        id: 'confirm',
        when: (st) => st.hosts.length > 0,
        run: async (pp, st) => {
          pp.write('\n(preview, nothing is written yet)\n');
          previewCode = await ctx.exec(buildAgentCommand({ what: st.what, hosts: st.hosts, home: argvHome(state), dryRun: true }), {});
          if (previewCode && previewCode !== 3) return;
          st.confirmed = await pp.confirm(`\n${st.what === 'remove' ? 'Remove' : 'Write'} them`, true);
        },
      },
    ],
    s,
  );

  if (!s.hosts.length || !s.confirmed) {
    p.write('Nothing was changed.\n');
    return 0;
  }
  const cmd = { label: s.what === 'remove' ? 'remove the agent commands' : 'install the agent commands', argv: buildAgentCommand({ what: s.what, hosts: s.hosts, home: argvHome(state) }) };
  const { code } = await runCommands(p, ctx.exec, [cmd]);
  if (!code) printEquivalent(p, [cmd], 'Done. The same without the shell:');
  return code;
}

module.exports = { agentCommandsAction, overall, buildAgentCommand };
