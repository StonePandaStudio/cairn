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

**After a review.** `{{ reviewerAgent }}` ends by offering the next step: replan and re-review,
fix now without replanning, or stop. Either fix runs as `/fix-review [task] [step] [blockers|all|B1 S2 …] [--replan]`,
which chains the agents as sub-agents (one fix round, then a re-review). Run it by hand to pick
individual findings.
{{#if tracker.publicRefs}}

The task can also be given as a public ref: `/plan-task {{ tracker.exampleKey }}-1-4.2` is step 2 of
story 4 in epic 1. Details: `ai/WORKFLOW.md`.
{{/if}}

---

## Agent Profiles

{{#each agents}}
### `{{ this.name }}`

Read `{{ this.doc }}` for the full role, workflow, tools, and instructions.{{#if this.note}} {{ this.note }}{{/if}}

{{/each}}

---

## Starting on an existing code base

Run once, before the first task, when `ai/contexts/` is empty or thin. Safe to re-run:
it only adds what is missing.

- `/discover [area]` — `{{ discoveryAgent }}` (`ai/agents/discovery.md`) proposes, then drafts, `ai/contexts/**` docs from the code (`status: draft` until you review them), and writes `ai/discovery-report.md`

---

{{#if qa}}
## QA for existing code

Separate from the workflow above, which gets its tests from the plan's **Tests**
section. These add tests to code that already exists:

- `/plan-tests [task] [target]` — `{{ qaArchitectAgent }}` (`ai/agents/qa-architect.md`) writes `ai/tasks/[task]/test-plan-[target].md`
- `/execute-test-plan [task] [target]` — `{{ qaDeveloperAgent }}` (`ai/agents/qa-developer.md`) writes and verifies the tests
- `/run-qa [task] [target|all]` — `{{ qaOrchestratorAgent }}` (`ai/agents/qa-orchestrator.md`) runs both

---

{{/if}}
{{#if workspace}}
## Workspace

This repo is one of {{ workspace.count }} in a workspace (`{{ workspace.file }}`). The others:

| Repo | Path | Stack | Role |
|---|---|---|---|
{{#each workspace.siblings}}
| `{{ this.name }}` | `{{ this.path }}` | {{ this.stack }} | {{ this.role }} |
{{/each}}

Work in this repo, but do not plan in ignorance of the rest. When a task touches what a
sibling owns (an API, a schema, a screen, a decision record), read that sibling's
`CLAUDE.md` and `ai/contexts/**` first. Never edit a sibling as a side effect: a needed
change there is a separate task in that repo. A missing contract is a finding to report,
not something to mock silently.{{#if tracker.remote}} `/request-change [repo] [task]` files it as a
linked {{ tracker.providerLabel }} issue for that repo's architect to pick up.{{/if}}

---

{{/if}}
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
