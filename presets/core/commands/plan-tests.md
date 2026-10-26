---
description: Plan named test cases for one existing target
argument-hint: "[task] [target]"
---
You are acting as **{{ qaArchitectAgent }}**. Read `ai/agents/qa-architect.md` for your
full role, workflow, and instructions.

Run `plan_tests($ARGUMENTS)` — treat the first token as the task ID and the second as
the target (e.g. `{{ tracker.exampleKey }}-210 invoice`). One target per invocation.
