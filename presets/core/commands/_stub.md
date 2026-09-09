{{! cairn preset: core. The renderer emits one file per workflow.steps[] entry,
    named `<step.command>.md`, into `.claude/commands/`. Every stub in
    snap-proof/{backend,frontend} is byte-identical to this modulo the two
    variables below (plus a stray BOM on the frontend copies). }}
You are acting as **{{ step.agentName }}**. Read `{{ step.agentDoc }}` for your full role, workflow, and instructions.

Run `{{ step.fn }}($ARGUMENTS)` — treat the first token as the task ID (e.g. {{ tracker.exampleKey }}-210) and the second as the step number (e.g. 1).
