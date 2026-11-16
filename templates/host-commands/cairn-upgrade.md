---
description: Update cairn in every repo of a workspace, then sync each repo
---

# cairn-upgrade

Update the installed cairn in each repo of a workspace and merge the new preset files. Arguments from the user, if any: $ARGUMENTS

## Procedure

1. **Find the workspace file** (`repos.json`), and pass it as `--config <file>` below. With no `repos.json`, run the commands from inside the cairn repo: it is then a workspace of one and `--config` is left out.
2. **Report first, writes nothing.** `npx cairn upgrade [--config <file>]`. Show the table: per repo the installed version, whether the `package.json` pin allows the new one, and whether a sync is pending.
3. **Explain what blocks.** A repo whose pin excludes the new version (on 0.x, `^0.9.0` stops at 0.9.x) is reported as blocked and left alone. `--bump-pin` rewrites that pin through the package manager; offer it, do not assume it.
4. **Ask** whether to apply, for which repos, and whether to bump pins.
5. **Apply.** `npx cairn upgrade [--config <file>] --apply [--bump-pin] [--repo <name> …]`. It runs the package manager's update (npm, yarn or pnpm, from the lockfile), then `cairn sync` in each repo. A repo whose cairn is a link to a checkout is synced, not updated.
6. **Exit codes.** 0 all clean. 3 some repo has sync conflicts: the files hold git conflict markers; list them and help resolve, or take the template with `npx cairn sync --repo <path> --reset <file>` for a hand-edited agent doc. 1 an update failed or was blocked by a pin.
7. **Refresh these skills too.** They belong to the cairn you just installed: run `npx cairn agent-commands install` so `/cairn-*` match it (a skill the user edited is kept, never overwritten).
8. **Leave git to the user:** `git diff` in each repo, then commit.

{{common}}
