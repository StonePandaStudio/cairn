'use strict';

const { escapeRe } = require('./scan');

// Raw file comparison across these repos is close to useless: every copy differs
// on the project key (GLO vs PROOF), on absolute paths, and on line endings.
// Normalizing those axes away is what separates "cosmetic, safe to extract" from
// "someone genuinely edited this in one repo only".

function buildNormalizer(repos, opts = {}) {
  const keys = [...new Set(repos.map((r) => r.vars && r.vars.jiraKey).filter(Boolean))];
  const keyAlt = keys.map(escapeRe).join('|');

  const issueRe = keyAlt ? new RegExp(`\\b(?:${keyAlt})-\\d+\\b`, 'g') : null;
  const bareKeyRe = keyAlt ? new RegExp(`\\b(?:${keyAlt})\\b`, 'g') : null;

  // Longest paths first so D:/projects/snap-proof/backend wins over D:/projects.
  const pathEntries = repos
    .map((r) => r.path.replace(/\\/g, '/'))
    .sort((a, b) => b.length - a.length);
  const nameEntries = repos.map((r) => r.name).sort((a, b) => b.length - a.length);

  // Var names to fold into placeholders, read from each repo's `vars` block.
  // jiraKey is handled separately below because it also appears as `KEY-123`.
  const varNames = (opts.vars || []).filter((v) => v !== 'jiraKey');

  return function normalize(text, repo) {
    let s = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

    if (opts.trailingWhitespace !== false) {
      s = s.replace(/[ \t]+$/gm, '');
      s = s.replace(/\n+$/, '\n');
    }

    if (opts.repoPaths !== false) {
      for (const p of pathEntries) {
        // Match either separator flavour; markdown in these repos mixes them.
        const flexible = escapeRe(p).replace(/\//g, '[\\\\/]');
        s = s.replace(new RegExp(flexible, 'gi'), '{{REPO_PATH}}');
      }
      for (const n of nameEntries) {
        s = s.replace(new RegExp(`\\b${escapeRe(n)}\\b`, 'g'), '{{REPO_NAME}}');
      }
    }

    if (opts.jiraKeys !== false && issueRe) {
      s = s.replace(issueRe, '{{ISSUE}}');
      s = s.replace(bareKeyRe, '{{KEY}}');
    }

    // Fold declared per-repo vars (agent role names, agent doc paths, …). These
    // are exactly the values a template would parameterize, so collapsing them
    // shows what is left over — the drift that is nobody's variable.
    if (repo && repo.vars && varNames.length) {
      const pairs = varNames
        .filter((name) => typeof repo.vars[name] === 'string' && repo.vars[name])
        .map((name) => [name, repo.vars[name]])
        .sort((a, b) => b[1].length - a[1].length);
      for (const [name, value] of pairs) {
        const bare = /^[\w-]+$/.test(value);
        const re = new RegExp(bare ? `\\b${escapeRe(value)}\\b` : escapeRe(value), 'g');
        s = s.replace(re, `{{${name}}}`);
      }
    }

    // Off by default: "Task" and "Story" appear constantly as ordinary prose, so
    // this normalizer trades false-identical risk for signal. Opt in when you
    // specifically want to see past the Story/Task issue-type split.
    if (opts.issueTypes && repo && repo.vars) {
      const { storyType, subtaskType } = repo.vars;
      if (subtaskType) {
        s = s.replace(new RegExp(`\\b${escapeRe(subtaskType)}\\b`, 'g'), '{{SUBTASK_TYPE}}');
      }
      if (storyType) {
        s = s.replace(new RegExp(`\\b${escapeRe(storyType)}\\b`, 'g'), '{{STORY_TYPE}}');
      }
    }

    return s;
  };
}

module.exports = { buildNormalizer };
