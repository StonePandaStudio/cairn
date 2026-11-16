---
description: Report drift between the repos of a cairn workspace (read-only)
---

# cairn-doctor

A read-only drift report: shared files that differ across repos, repos behind on cairn, hand-modified generated files. Arguments from the user, if any: $ARGUMENTS

## Procedure

1. **Find the workspace file** (`repos.json`). `cairn doctor` compares repos with each other, so it needs one.
2. **Run it.** `npx cairn doctor --config <file>`. `--json` gives machine-readable output; `--strict` exits 1 on drift, gaps or hand-modified generated files (for CI, not for this).
3. **Read the table for the user.** Say which files drift, between which repos, and whether the drift looks intentional (one repo's own edit) or accidental (one repo behind). For a single file: `npx cairn doctor --config <file> --diff <relPath>` shows the hunks across repos.
4. **Suggest the fix, do not do it:** `cairn-sync` for a repo behind on presets, `cairn-upgrade` for repos behind on cairn itself, `ai/local/` for an edit that should stay.

{{common}}
