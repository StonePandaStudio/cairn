---
description: Merge preset changes into this repo's ai/ files (preview, then three-way merge)
---

# cairn-sync

Bring a repo that already has cairn up to date with the bundled presets. Arguments from the user, if any: $ARGUMENTS

## Procedure

1. **Check the folder.** It needs `cairn.config.json`. Without one, suggest `cairn-init`.
2. **Preview.** `npx cairn sync --repo . --dry-run` prints the outcome per file and writes nothing. Summarise it: what is clean, what the template changed, what the user edited, what conflicts.
3. **Ask** whether to apply. A hand-edited agent doc (`ai/agents/*.md`) is never overwritten: it is reported with a diff and the run exits 3. The lasting way to customise an agent doc is `ai/local/` (`npx cairn override --help`).
4. **Apply.** `npx cairn sync --repo .`. Every other file gets a three-way merge: base (`_cairn/base/`), ours, theirs. Clean results are written; a conflict is written with git markers and the exit code is non-zero.
5. **Conflicts (exit 3).** List the files with markers and help resolve them. `--reset <path>` takes the template for one agent doc and discards the edit; use it only when the user says so. `--only <path>` syncs a single file. `--adopt-base` is for files rendered before cairn tracked a merge base; explain the trade-off before using it.
6. **Leave git to the user:** `git diff`, then commit.

{{common}}
