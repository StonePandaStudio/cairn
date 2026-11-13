{{! cairn preset: core. The renderer emits one file per workflow.steps[] entry,
    named `<step.command>.md`, into `.claude/commands/`. Every stub in
    each source repo is byte-identical to this modulo the two
    variables below (plus a stray BOM on the frontend copies).

    The frontmatter is what Claude Code's slash-command picker shows — without
    it, the picker falls back to this file's first body line verbatim, literal
    `**bold**` asterisks and all. See PLAN.md for how that was found. }}
---
description: {{ step.summary }}
argument-hint: "[task]{{#if step.canOmitTask}}?{{/if}} [step]{{#if step.createsTask}} [title]{{#if tracker.publicRefs}} [--epic epic]{{/if}}{{/if}}"
---
You are acting as **{{ step.agentName }}**. Read `{{ step.agentDoc }}` for your full role, workflow, and instructions.

Run `{{ step.fn }}($ARGUMENTS)` — treat the first token as the task ID (e.g. {{ tracker.exampleKey }}-210) and the second as the step number (e.g. 1).
{{#if step.createsTask}}

Anything left over once a task ID and/or step number are recognized is a free-text title, not an error — it seeds the new brief instead of leaving it blank.
{{#if step.canOmitTask}}
Starting a brand-new task? Omit the task ID — you can't predict the next {{ tracker.providerLabel }} key, so don't guess one. `{{ cmdPrefix }}create-brief 1 Add CSV export` or just `{{ cmdPrefix }}create-brief Add CSV export` (step defaults to 1) creates the {{ tracker.providerLabel }} issue and uses its returned key.
{{/if}}
{{/if}}
{{#if tracker.publicRefs}}

The task token can also be a public ref: `{{ tracker.exampleKey }}-1-4` is story 4 of epic 1, and `{{ tracker.exampleKey }}-1-4.2` is its step 2. A step ref already names the step, so `.2` is the step number and the part before it is the task. Run `npx cairn tracker resolve <task ref, without any .N>` to get the tracker key, and use that key — never the ref — for the `ai/tasks/` folder and the brief marker. See `ai/WORKFLOW.md`.
{{#if step.createsTask}}

To start a new task inside an epic, add `--epic <epic key or ref>` (e.g. `{{ cmdPrefix }}create-brief --epic {{ tracker.exampleKey }}-E1 Add CSV export`) and pass the same flag to `npx cairn tracker create-story`. Step 2+ of an existing story: create its issue with `npx cairn tracker create-step <task key or ref> "<title>" <brief path> --step <N>`, so the ref's number matches `brief-step-<N>.md`.
{{/if}}
{{/if}}
