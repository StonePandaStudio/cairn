---
description: Archive ai/tasks/ folders older than 2 weeks
---
Archive task folders in `ai/tasks/` that are older than 2 weeks.

## Steps

1. **List candidate folders.** In `ai/tasks/`, list every subdirectory whose name
   looks like a task ID{{#if tracker.remote}} — starts `{{ tracker.exampleKey }}-`
   or `LOCAL-`{{/if}}. Skip `archive/`.

2. **Determine each task's creation date** using git — find the earliest commit
   that touched that folder:
   ```
   git log --diff-filter=A --follow --format="%aI" -- "ai/tasks/<TASK-ID>/" | tail -1
   ```
   If `git log` returns nothing (untracked folder), fall back to the folder's
   filesystem creation time (PowerShell: `(Get-Item "ai/tasks/<TASK-ID>").CreationTime`;
   POSIX: the earliest `mtime` under the folder is the closest available proxy).

3. **Filter to tasks older than 2 weeks** (creation date < today minus 14 days).
   Today's date is available from the system context.

4. **Move each qualifying folder** to `ai/tasks/archive/<YEAR>/<MONTH>/` where
   `<YEAR>` and `<MONTH>` (zero-padded, e.g. `06`) come from the task's own creation
   date — not today's date. Create the target directory if it doesn't exist.
   - Move the whole folder as a unit (PowerShell `Move-Item`, POSIX `mv`).
   - Example: a task created on 2025-04-03 → `ai/tasks/archive/2025/04/<TASK-ID>/`

5. **Report results.** After all moves, print a summary:
   - Moved: list of task IDs with their creation date and destination path
   - Skipped (too recent): list of task IDs with their creation date
   - If nothing was moved, say so explicitly.

## Notes
- Do **not** move the `archive/` directory itself.
- Do **not** modify any files inside task folders — only move the folder as a unit.
- If a task folder already exists at the target path (name collision), append `_1`,
  `_2`, etc. to avoid overwriting.
- This command is manual-trigger only — it is not called automatically by any
  workflow step.
