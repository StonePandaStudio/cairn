{{! cairn preset: core. The renderer emits one file per workflow.steps[] entry,
    named `<step.command>.md`, into `.claude/commands/`. Every stub in
    snap-proof/{backend,frontend} is byte-identical to this modulo the two
    variables below (plus a stray BOM on the frontend copies). }}
You are acting as **{{ step.agentName }}**. Read `{{ step.agentDoc }}` for your full role, workflow, and instructions.

Run `{{ step.fn }}($ARGUMENTS)` — treat the first token as the task ID (e.g. {{ tracker.exampleKey }}-210) and the second as the step number (e.g. 1).
{{#if step.createsTask}}

Anything left over once a task ID and/or step number are recognized is a free-text title, not an error — it seeds the new brief instead of leaving it blank.
{{#if step.canOmitTask}}
Starting a brand-new task? Omit the task ID — you can't predict the next {{ tracker.providerLabel }} key, so don't guess one. `/create-brief 1 Add CSV export` or just `/create-brief Add CSV export` (step defaults to 1) creates the {{ tracker.providerLabel }} issue and uses its returned key.
{{/if}}
{{/if}}
