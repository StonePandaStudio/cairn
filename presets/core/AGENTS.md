# `AGENTS.md`

<!-- cairn preset: core. Rendered from workflow.steps[] + the repo's tracker config.
     The Workflow Example numbering, the Agent Profiles, and the tracker section
     all come from config — which is what stops one repo's AGENTS.md drifting from
     its own commands. -->

The agents in the **{{ project.assistantName }}** — a small multi-agent system that
runs {{ stack.0 }} feature work from brief to review.

## High-Level Architecture

`{{ architectAgent }}` interprets the request, discusses it, and produces the plan.
`{{ developerAgent }}` implements the plan. `{{ reviewerAgent }}` checks the result
against the plan and the guidelines. Each runs in its own session.

**Workflow Example.** A task moves through these named invocations; you own the
transitions. Dispatch table: `ai/INITIAL_PROMPT.md`.

{{#each workflow.steps}}
{{ @index_1 }}. **`/{{ this.command }} {{ tracker.exampleKey }}-NNN 1`** — `{{ this.agentName }}`{{#if this.model}} ({{ this.model }}){{/if}} — {{ this.oneLine }}
{{/each}}

Informal engagement on a task defaults to the first step.

---

## Agent Profiles

{{#each agents}}
### `{{ this.name }}`

Read `{{ this.doc }}` for the full role, workflow, tools, and instructions.{{#if this.note}} {{ this.note }}{{/if}}

{{/each}}

---

## Tracker

{{#if tracker.remote}}
`create_brief`, `enrich_description` and `plan_task` sync task state to the
`{{ tracker.exampleKey }}` project on {{ tracker.providerLabel }} as a side effect.
Mapping, sync points, stage names, and the `LOCAL-*` rule: `ai/WORKFLOW.md`. Manual:
`/{{ tracker.slug }}-status`, `/{{ tracker.slug }}-assign`.
{{else}}
No remote tracker (`tracker.provider` is `none`). A task is its `ai/tasks/[KEY]/`
folder; the sync steps are no-ops. See `ai/WORKFLOW.md`.
{{/if}}
