'use strict';

// Agent commands: cairn's own operations (init, workspace, upgrade, sync, tools, doctor) as skills
// the agent hosts load from the USER's home, so `/cairn-init` works in a repo that has no cairn yet.
// (The workflow commands that `cairn render` writes into a repo are a different thing.)
//
// One source per command in templates/host-commands/<name>.md; each host adapter says where its
// user-level skills live (`userSkills` in lib/hosts/*.js). A written file carries a marker with the
// hash of its own content, so a later install can tell "cairn wrote this and nobody touched it"
// (safe to update or remove) from "edited by hand" (kept unless --force).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getHost, listHosts } = require('../hosts');
const { UserError } = require('../errors');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'templates', 'host-commands');
const COMMON = '_common.md';
const MARK = 'cairn:host-command';

// Whose home folder the user-level skills go to. CAIRN_HOME overrides it (tests, a sandbox).
const defaultHome = () => process.env.CAIRN_HOME || os.homedir();

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ------------------------------------------------------------------- the commands

function parseSource(name, text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`templates/host-commands/${name}.md has no frontmatter`);
  const description = (m[1].match(/^description:\s*(.+)$/m) || [])[1];
  if (!description) throw new Error(`templates/host-commands/${name}.md has no description`);
  return { name, description: description.trim(), body: m[2].replace(/^\r?\n/, '') };
}

// [{ name, description, body }] with {{common}} filled in, by name.
function listCommands(dir = SOURCE_DIR) {
  const common = fs.readFileSync(path.join(dir, COMMON), 'utf8').trim();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== COMMON)
    .sort()
    .map((f) => {
      const name = f.slice(0, -3);
      const cmd = parseSource(name, fs.readFileSync(path.join(dir, f), 'utf8'));
      return { ...cmd, body: cmd.body.replace('{{common}}', () => common).trimEnd() + '\n' };
    });
}

// ----------------------------------------------------------------- managed files

// A file with a marker line holding the hash of the file as written. `kind` picks the comment syntax.
function withMarker(content, kind) {
  const line = (hash) => (kind === 'yaml' ? `# ${MARK} sha256:${hash}` : `<!-- ${MARK} sha256:${hash} -->`);
  const placeholder = line('');
  const body = content.replace('{{marker}}', () => placeholder);
  return body.replace(placeholder, () => line(sha(body)));
}

// Does the file still hold exactly what cairn wrote (its marker hash matches its own content)?
function untouched(text) {
  const m = text.match(/(?:<!-- |# )cairn:host-command sha256:([0-9a-f]{16})(?: -->)?/);
  if (!m) return false;
  return sha(text.replace(m[1], '')) === m[1];
}

// 'new' | 'unchanged' | 'updated' | 'kept' (hand-edited or not ours) | 'forced'
function classify(file, content, force) {
  if (!fs.existsSync(file)) return 'new';
  const current = fs.readFileSync(file, 'utf8');
  if (current === content) return 'unchanged';
  if (untouched(current)) return 'updated';
  return force ? 'forced' : 'kept';
}

// ---------------------------------------------------------------------- per host

function userSkills(hostId) {
  const host = getHost(hostId);
  if (!host.userSkills) throw new UserError(`host "${hostId}" has no user-level skills location`);
  return host.userSkills;
}

function skillText(cmd, hostId) {
  const skills = userSkills(hostId);
  const body = skills.arguments ? cmd.body.replace(/\$ARGUMENTS/g, skills.arguments) : cmd.body;
  const front = ['---', `name: ${cmd.name}`, `description: ${JSON.stringify(cmd.description)}`, ...(skills.frontmatter || []), '---'];
  return withMarker(`${front.join('\n')}\n{{marker}}\n\n${body}`, 'md');
}

// [{ rel, content }] relative to the host's skills dir.
function filesFor(cmd, hostId) {
  const skills = userSkills(hostId);
  const out = [{ rel: `${cmd.name}/SKILL.md`, content: skillText(cmd, hostId) }];
  for (const [rel, text] of (skills.extra && skills.extra(cmd)) || []) {
    out.push({ rel: `${cmd.name}/${rel}`, content: withMarker(text, 'yaml') });
  }
  return out;
}

function skillsDir(hostId, home) {
  return path.join(home, ...userSkills(hostId).dir.split('/'));
}

// Hosts that look present on this machine; claude when none does.
function detectHosts(home = defaultHome()) {
  const has = (...p) => fs.existsSync(path.join(home, ...p));
  const found = [];
  if (has('.claude')) found.push('claude');
  if (has('.codex') || has('.agents')) found.push('codex');
  return found.length ? found : ['claude'];
}

// ------------------------------------------------------------------ operations

// Writes (or, with dryRun, only classifies) every command for every host.
// Resolves to [{ host, name, file, status }] where status is as `classify`.
function install({ hosts, home = defaultHome(), dryRun = false, force = false, commands = listCommands() } = {}) {
  const results = [];
  for (const hostId of hosts) {
    const dir = skillsDir(hostId, home);
    for (const cmd of commands) {
      for (const { rel, content } of filesFor(cmd, hostId)) {
        const file = path.join(dir, ...rel.split('/'));
        const status = classify(file, content, force);
        if (!dryRun && (status === 'new' || status === 'updated' || status === 'forced')) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, content, 'utf8');
        }
        results.push({ host: hostId, name: cmd.name, file, rel, status });
      }
    }
  }
  return results;
}

// Removes the files cairn wrote and nobody edited. Resolves to [{ host, name, file, status }] with
// status 'removed' | 'kept' (edited) | 'absent'.
function remove({ hosts, home = defaultHome(), dryRun = false, force = false, commands = listCommands() } = {}) {
  const results = [];
  for (const hostId of hosts) {
    const dir = skillsDir(hostId, home);
    for (const cmd of commands) {
      for (const { rel } of filesFor(cmd, hostId)) {
        const file = path.join(dir, ...rel.split('/'));
        if (!fs.existsSync(file)) {
          results.push({ host: hostId, name: cmd.name, file, rel, status: 'absent' });
          continue;
        }
        const ours = untouched(fs.readFileSync(file, 'utf8'));
        if (ours || force) {
          if (!dryRun) fs.rmSync(file);
          results.push({ host: hostId, name: cmd.name, file, rel, status: 'removed' });
        } else results.push({ host: hostId, name: cmd.name, file, rel, status: 'kept' });
      }
      const folder = path.join(dir, cmd.name);
      if (!dryRun && fs.existsSync(folder)) {
        try {
          fs.rmdirSync(path.join(folder, 'agents'));
        } catch {
          /* not empty or absent */
        }
        try {
          fs.rmdirSync(folder);
        } catch {
          /* not empty: someone's own files live there */
        }
      }
    }
  }
  return results;
}

// Per host: how many commands are installed and current, outdated (a different version, or edited
// by hand) or missing. Read-only.
function status({ hosts = listHosts().filter((h) => getHost(h).userSkills), home = defaultHome(), commands = listCommands() } = {}) {
  return hosts.map((hostId) => {
    const dir = skillsDir(hostId, home);
    const row = { host: hostId, total: commands.length, current: 0, outdated: 0, missing: 0 };
    for (const cmd of commands) {
      const [main] = filesFor(cmd, hostId);
      const file = path.join(dir, ...main.rel.split('/'));
      if (!fs.existsSync(file)) row.missing += 1;
      else if (fs.readFileSync(file, 'utf8') === main.content) row.current += 1;
      else row.outdated += 1;
    }
    return row;
  });
}

module.exports = { defaultHome, listCommands, install, remove, status, detectHosts, skillText, filesFor, skillsDir, untouched, SOURCE_DIR };
