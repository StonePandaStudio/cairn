'use strict';

// `describes: <kind> <Symbol>` anchors are checked against a code provider, which may be
// asynchronous (a language server). `check()` is deliberately pure and synchronous, so the
// lookups happen here first and `check` receives a plain synchronous resolver over the
// answers. Each distinct (repo, symbol) is asked once.

const { anchorsOf } = require('./index');

const keyOf = (repoName, symbol) => `${repoName}\u0000${symbol}`;

// -> a `(repoName, symbol) => { status, reason? }` function for `check(graph, { resolveAnchor })`.
async function buildAnchorResolver({ graph, repos, source }) {
  const byName = new Map(repos.map((r) => [r.name, r]));
  const answers = new Map();

  for (const node of graph.nodes.values()) {
    for (const symbol of anchorsOf(node)) {
      const key = keyOf(node.repo, symbol);
      if (answers.has(key)) continue;
      const repo = byName.get(node.repo);
      answers.set(key, repo ? await source.symbol(repo, symbol) : { status: 'unknown', reason: `unknown repo ${node.repo}` });
    }
  }

  return (repoName, symbol) => answers.get(keyOf(repoName, symbol)) || { status: 'unknown', reason: 'anchor was not resolved' };
}

module.exports = { buildAnchorResolver };
