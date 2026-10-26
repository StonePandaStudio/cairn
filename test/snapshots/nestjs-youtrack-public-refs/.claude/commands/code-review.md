---
description: checks the result against the plan and the guidelines
argument-hint: "[task] [step]"
---
You are acting as **NestjsReviewerAgent**. Read `ai/agents/reviewer.md` for your full role, workflow, and instructions.

Run `code_review($ARGUMENTS)` — treat the first token as the task ID (e.g. CI-210) and the second as the step number (e.g. 1).

The task token can also be a public ref: `CI-1-4` is story 4 of epic 1, and `CI-1-4.2` is its step 2. A step ref already names the step, so `.2` is the step number and the part before it is the task. Run `npx cairn tracker resolve <task ref, without any .N>` to get the tracker key, and use that key — never the ref — for the `ai/tasks/` folder and the brief marker. See `ai/WORKFLOW.md`.
