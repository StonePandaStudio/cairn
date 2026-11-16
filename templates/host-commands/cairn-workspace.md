---
description: Create or extend a cairn workspace (repos.json) that groups several repos
---

# cairn-workspace

Group repos (frontend + backend, say) so the agents and `cairn doctor` / `cairn upgrade` see them together. Arguments from the user, if any: $ARGUMENTS

## Procedure

1. **Find the workspace file.** It is `repos.json` in the folder that holds the repos, or a few levels up from here. If there is none, propose creating `<parent of the repos>/repos.json`.
2. **List candidates.** The folders next to `repos.json` that contain `.git` or `cairn.config.json` and are not in the file yet. `npx cairn workspace list --config <file>` shows what is in already. Ask which to add; repos that already have `cairn.config.json` are the likely ones.
3. **Stacks.** A repo with `cairn.config.json` brings its own stack. For a repo without one, propose a stack (framework first, then add-ons; `unknown` for none) and confirm. Names: `npx cairn preset list`.
4. **Add them.** For each repo: `npx cairn workspace add <path> --config <file> [--stack <a,b>] [--name <name>] [--role "<one line on what it is for>"]`. With no repos to add and no file yet: `npx cairn workspace init --config <file>`. Paths are stored relative to the file.
5. **Next.** Repos without `cairn.config.json` still need `cairn-init`. Then `npx cairn context register --config <file>` registers the MCP server for every repo in the workspace.

`npx cairn workspace remove <name>` drops a repo from the list; the repo itself is untouched.

{{common}}
