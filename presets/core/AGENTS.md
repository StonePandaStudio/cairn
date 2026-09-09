# `AGENTS.md`

<!-- cairn preset: core. Skeleton shared by snap-proof/{backend,frontend}. The
     Workflow Example numbering, the Agent Profiles pointers, and the tracker-sync
     section are all rendered from workflow.steps[] + tracker.* — which is what
     removes the current drift (frontend's AGENTS.md still says "Jira" while its
     .env and commands are already on YouTrack). -->

This document outlines the agents in the **{{ project.assistantName }}**, a
multi-agent system that accelerates {{ stack.0 }} development — from feature scaffolding
to testing and review.

## High-Level Architecture

A lead `{{ architectAgent }}` interprets user requests, plans the steps, and
coordinates a team of specialized agents. All changes stay consistent with the
project's conventions and existing structure.

**Workflow Example.** A complete task moves through these named invocations. The user
owns the transitions between them; see the dispatch table in `ai/INITIAL_PROMPT.md`.

{{#each workflow.steps}}
{{ @index_1 }}. **`/{{ this.command }} {{ ../tracker.exampleKey }}-NNN 1`** — `{{ this.agentName }}`{{#if this.model}} ({{ this.model }}){{/if}} — {{ this.oneLine }}
{{/each}}

Informal engagement on a task (e.g. "let's discuss {{ tracker.exampleKey }}-NNN")
defaults to the first step.

---

## Agent Profiles

{{#each agents}}
### `{{ this.name }}`

Read `{{ this.doc }}` for the full role, workflow, tools, and instructions.{{#if this.note}} {{ this.note }}{{/if}}

{{/each}}

---

## Tracker sync

`create_brief`, `enrich_description`, and `plan_task` sync task state to the
`{{ tracker.exampleKey }}` project on {{ tracker.providerLabel }} as a side effect.
Full mapping, sync points, stage names, and the rule for the pre-migration
`ai/tasks/LOCAL-*` folders: `ai/WORKFLOW.md`. Manual stage/assignee commands:
`/{{ tracker.slug }}-status`, `/{{ tracker.slug }}-assign`.
