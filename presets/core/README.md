# `presets/core`

Stack-agnostic content shared by every repo, whatever the framework: the agent
**role contracts**, the command-stub template, and the `WORKFLOW.md` / `AGENTS.md`
skeletons.

Extracted 2026-09-09 from two source repos.
These are **seeds** — no renderer consumes them yet. They are the canonical version
of scaffolding that currently exists as two hand-synced copies, already useful as a
reference to pull the copies back together by hand.

## What lives here vs. in a stack preset

`core` holds the parts the backend and frontend agent docs share **verbatim modulo
two variables** — the workflow scaffold (`R.1`–`R.4`, `E.1`–`E.5`, Mode A / Mode B),
the report and plan-format templates, the "when to stop" lists. Measured 85–92%
identical across the two repos.

A stack preset (`../nestjs`, `../angular`) fills the slots these contracts declare:

| slot in a core agent | nestjs | angular |
|---|---|---|
| `{{> stack/review-checklist }}` | TypeORM / class-validator / `@ResponseMapper` rules | `@if`/`@for` / standalone / theme vars / i18n rules |
| `{{> stack/implementation-reference }}` | module / controller / service / entity / DTO / migration | component / template / SCSS / reactive-form |
| `{{> stack/key-patterns }}` | `project-structure.md` + `DATABASE_SCHEMA.md` pointers | `patterns.md` (base classes, `x-admin-profile`) pointers |

## Variables

Placeholders the renderer substitutes per repo, from `workspace.json` + the repo's
`cairn.config.json`:

- `{{ architectAgent }}` / `{{ developerAgent }}` / `{{ reviewerAgent }}` — the persona names
- `{{ model }}` — the tier the reviewer/QA agents require, by name (`Sonnet`) — never a versioned id
- `{{ step.fn }}` / `{{ step.command }}` — the workflow verb for a step (`code_review` vs `review_plan` is drift to be removed, not a variant)
- `{{ tracker.* }}` — provider, stage names, example issue key — for the sync sub-steps and `WORKFLOW.md`
