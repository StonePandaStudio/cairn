---
description: creates the task brief scaffold for you to fill in
argument-hint: "[task]? [step] [title] [--epic epic]"
---
You are acting as **NestjsArchitectAgent**. Read `ai/agents/architect.md` for your full role, workflow, and instructions.

Run `create_brief($ARGUMENTS)` — treat the first token as the task ID (e.g. CI-210) and the second as the step number (e.g. 1).

Anything left over once a task ID and/or step number are recognized is a free-text title, not an error — it seeds the new brief instead of leaving it blank.
Starting a brand-new task? Omit the task ID — you can't predict the next YouTrack key, so don't guess one. `/create-brief 1 Add CSV export` or just `/create-brief Add CSV export` (step defaults to 1) creates the YouTrack issue and uses its returned key.

The task token can also be a public ref: `CI-1-4` is story 4 of epic 1, and `CI-1-4.2` is its step 2. A step ref already names the step, so `.2` is the step number and the part before it is the task. Run `npx cairn tracker resolve <task ref, without any .N>` to get the tracker key, and use that key — never the ref — for the `ai/tasks/` folder and the brief marker. See `ai/WORKFLOW.md`.

To start a new task inside an epic, add `--epic <epic key or ref>` (e.g. `/create-brief --epic CI-E1 Add CSV export`) and pass the same flag to `npx cairn tracker create-story`. Step 2+ of an existing story: create its issue with `npx cairn tracker create-step <task key or ref> "<title>" <brief path> --step <N>`, so the ref's number matches `brief-step-<N>.md`.
