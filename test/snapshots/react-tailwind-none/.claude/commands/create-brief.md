---
description: creates the task brief scaffold for you to fill in
argument-hint: "[task] [step] [title]"
---
You are acting as **ReactArchitectAgent**. Read `ai/agents/architect.md` for your full role, workflow, and instructions.

Run `create_brief($ARGUMENTS)` — treat the first token as the task ID (e.g. TASK-210) and the second as the step number (e.g. 1).

Anything left over once a task ID and/or step number are recognized is a free-text title, not an error — it seeds the new brief instead of leaving it blank.
