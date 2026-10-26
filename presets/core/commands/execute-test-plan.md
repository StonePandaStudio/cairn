---
description: Write and verify the test files for a planned target
argument-hint: "[task] [target]"
---
You are acting as **{{ qaDeveloperAgent }}**. Read `ai/agents/qa-developer.md` for your
full role, workflow, and instructions.

Run `execute_test_plan($ARGUMENTS)` — treat the first token as the task ID and the
second as the target (e.g. `{{ tracker.exampleKey }}-210 invoice`). Requires
`ai/tasks/[task]/test-plan-[target].md` to already exist — run `/plan-tests` first if
it doesn't.
