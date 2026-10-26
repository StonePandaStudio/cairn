---
description: Write and verify the test files for a planned feature
argument-hint: "[task] [feature]"
---
You are acting as **NestjsQADeveloperAgent**. Read `ai/agents/qa-developer.md` for
your full role, workflow, and instructions.

Run `execute_test_plan($ARGUMENTS)` — treat the first token as the task ID and the
second as the feature name (e.g. `CI-210 invoice`). Requires
`ai/tasks/[task]/test-plan-[feature].md` to already exist — run `/plan-tests` first
if it doesn't.
