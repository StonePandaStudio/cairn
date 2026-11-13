'use strict';

// The Codex host adapter: what cairn adds on top of the shared baseline for Codex.
//
//   - one skill per built-in workflow command, `.agents/skills/<name>/SKILL.md`, derived from the
//     rendered Claude-format command (a short Codex preamble, then the same procedure);
//   - a root `AGENTS.md` pointer to `ai/AGENTS.md` and the skills;
//   - the machine-local MCP entry in `.codex/config.toml` (see `context/register.js`).

const { registerCodexRepo, CODEX_FILE } = require('../context/register');

const COMMAND_PATH = /^\.claude\/commands\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

// `baseline` is the list of [rel, content, source] targets the renderer has built so far;
// `hosts` and `ctx` are the repo's hosts and the render context. Returns the extra targets, in the
// order they are appended.
function targets(baseline, { hosts = [], ctx = {} } = {}) {
  const scoutDoc = ctx.scoutDoc || '.claude/agents/code-scout.md';
  const withClaude = hosts.includes('claude');
  // What a Codex session needs to know on top of the procedure. When the repo also uses Claude Code the
  // shared docs are written in Claude's vocabulary, so the skill says how to read it; a Codex-only
  // repo's docs already speak Codex, so those translation lines are left out.
  const preamble = [
    ...(withClaude
      ? [
          'Cairn docs use Claude command names. In Codex, treat those names as references to the corresponding skills.',
          'Use the current Codex model and skip Claude model selection. For workflow decisions that require user input, ask in chat and wait for the answer.',
          'When the procedure recommends a fresh Claude session, use a fresh Codex chat for the same context reset.',
        ]
      : [
          'Use the current Codex model. For workflow decisions that require user input, ask in chat and wait for the answer.',
          'When the procedure recommends a fresh chat, start a fresh Codex chat for the same context reset.',
        ]),
    'For code-scout work, follow the read-only search procedure in `' + scoutDoc + '`. Use the `cairn` MCP server’s `code_references` and `code_symbol` tools for named symbols when available, with the scout’s text-search fallback and verification rules.',
    'For other Cairn MCP calls, resolve the tool by its name under the `cairn` server. Preserve any user confirmation required by the role docs before writing.',
    withClaude
      ? 'For orchestration steps that specify the Claude Agent tool, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.'
      : 'Where a step delegates to a sub-agent, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.',
  ];
  const skills = [];
  for (const [rel, content, source] of baseline) {
    const command = rel.match(COMMAND_PATH);
    if (!command || !source.startsWith('core/commands/')) continue;
    const [, name] = command;
    const frontmatter = content.trimStart().match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!frontmatter) continue;
    const descriptionLine = frontmatter[1].match(/^description: (.+)$/m);
    if (!descriptionLine) continue;
    const description = descriptionLine[1].trim();
    const instructions = content.trimStart().slice(frontmatter[0].length).trimStart()
      .replace(/\$ARGUMENTS/g, 'the arguments supplied with this skill');
    skills.push([
      `.agents/skills/${name}/SKILL.md`,
      [
        '---',
        `name: ${name}`,
        `description: ${JSON.stringify(`Cairn workflow: ${description}`)}`,
        '---',
        '',
        'Read `ai/AGENTS.md` and follow the Cairn procedure below using the task and arguments from the user’s request.',
        ...preamble,
        '',
        instructions,
      ].join('\n'),
      source,
    ]);
  }

  const out = [...skills];
  // Without Claude Code there is no `.claude/agents/code-scout.md`. The scout procedure is plain
  // read-only search instructions, so Codex gets it as a doc of its own, without the Claude
  // subagent frontmatter.
  if (!hosts.includes('claude')) {
    const scout = baseline.find(([rel]) => rel === '.claude/agents/code-scout.md');
    if (scout) {
      const body = scout[1].trimStart().replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trimStart();
      const intro =
        'The read-only search procedure the Cairn workflow hands to a code scout. ' +
        'Run it as a delegated sub-agent when you can, otherwise follow it yourself.';
      out.push([scoutDoc, `# code-scout\n\n${intro}\n\n${body}`, scout[2]]);
    }
  }
  // Codex reads the repo-root AGENTS.md on its own; the Cairn guide lives in ai/. A short pointer
  // lets a plain Codex session find the workflow without a skill being invoked first. A repo that
  // already has its own root AGENTS.md keeps it (the render guard never touches a file cairn did
  // not write) — add the same pointer there by hand.
  if (skills.length) {
    out.push([
      'AGENTS.md',
      [
        '# AGENTS.md',
        '',
        'This repo uses the Cairn agent workflow.',
        '',
        '- Read `ai/AGENTS.md` for the roles, the workflow and the conventions; `ai/WORKFLOW.md` has the step-by-step procedure.',
        '- Start a workflow step with its Codex skill (`$create-brief`, `$enrich-description`, `$plan-task`, `$execute-plan`, `$code-review`, …); they live in `.agents/skills/`.',
        '- Code conventions are in `ai/infrastructure/code-guidelines.md`.',
        '',
      ].join('\n'),
      'core/AGENTS.md',
    ]);
  }
  return out;
}

module.exports = {
  id: 'codex',
  label: 'Codex',
  targets,
  mcp: { file: CODEX_FILE, register: registerCodexRepo },
};
