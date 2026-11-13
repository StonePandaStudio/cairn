# Presets

Extracted guideline content shared across the repos. Internal only — an in-repo
folder, deliberately package-shaped so promotion to `@stonepandastudio/cairn-preset-*` is
adding a `package.json` rather than a refactor.

Nothing here is wired into a renderer yet. These are the *inputs* the renderer will
consume once the projects layer and extension mechanisms land (see `DESIGN.md`,
"Multi-repo projects"). Until then they are seeds: readable, diffable, and already
useful as the canonical version of guidance that currently exists in two drifting
copies.

## Layout

```
presets/
  core/       stack-agnostic — agent role contracts, command stub, WORKFLOW/AGENTS skeletons
    agents/   architect.md, developer.md, reviewer.md   (85–92% identical across stacks)
              qa-architect.md, qa-developer.md, qa-orchestrator.md — the QA contract,
              rendered only for a stack that ships qa-* slots (see § QA)
    commands/ _stub.md                                  (renders one file per workflow step)
              plan-tests.md, execute-test-plan.md, run-qa.md — QA command stubs
  nestjs/     NestJS + TypeScript framework spine, ORM agnostic
    slots/    the framework side of each {{> stack/… }} point
    variants/validation-stack/{zod,class-validator}/
              the 6 dto-naming/dto-definition/validation-stack/
              controller-response/response-transformation/pagination-dtos
              slots, one full set per choice. Selected by `cairn.config.json`'s
              `validationStack` (`--validation-stack` on `cairn init`, default
              `zod`) — resolved by `{{> variant/validation-stack/<name> }}` in
              code-guidelines.md, a different (working) mechanism from angular's
              still-dormant `variants/` below — see PLAN.md for why nestjs's
              needed fixing and angular's doesn't yet.
  fastify/    Fastify 5 + TypeScript spine, ORM agnostic — plugin per feature, Zod type provider,
              typed domain errors + one global handler, Lambda notes. No QA slots yet
    slots/    the framework side of each {{> stack/… }} point
  spring/     Spring Boot 3 + Kotlin spine, ORM agnostic — Controller/Service/DAO layering, domain
              packages (not model packages), AppException, JUnit 5 + MockK `buildSut`. Fills the QA slots
    slots/    the framework side of each {{> stack/… }} point
  jpa-flyway/ ORM add-on — JPA/Hibernate entities, BaseDao + Criteria/metamodel, locking, Flyway migrations
    slots/    the ORM side, appended to spring
  typeorm/    ORM add-on — entities, queries, migrations, decomposition
    slots/    the ORM side of the same {{> stack/… }} points (appended to nestjs)
  prisma/     ORM add-on — Prisma 7 schema, migrate, driver adapter, client as a decorator
    slots/    the ORM side, for a Postgres stack (appended to fastify or nestjs)
  drizzle/    ORM add-on — Drizzle schema, drizzle-kit migrations, RLS in migrations
    slots/    the ORM side, for a Postgres/Supabase stack
  angular/    Angular spine + SCSS theming + i18n (styling still inline here — one system, two repos)
    variants/ i18n-glossr.md, i18n-external-service.md
    slots/    the Angular side of the same {{> stack/… }} points
  react/      React frontend spine — components, hooks, state, testing (styling-agnostic)
    slots/    the React side of the same {{> stack/… }} points
  nextjs/     App-Router layer over `react` — server/client boundary, actions, route handlers
    slots/    the Next.js side of the same {{> stack/… }} points
  docker/     infrastructure add-on — Compose base/dev/prod split, dev mounts vs prod multi-stage builds,
              healthcheck-ordered startup, one-shot migrations, env contract. Composes after any framework
    slots/    the infra side of the same {{> stack/… }} points
  css-modules/ styling add-on — CSS Modules, two-tier tokens + private component tokens, typography roles,
              logical properties, `data-theme` dark mode. Alternative to `tailwind`, not a companion
    slots/    the styling side of the same {{> stack/… }} points
  tailwind/   styling add-on — @theme tokens, no tailwind.config.ts, dark mode via token re-map
    slots/    the styling side of the same {{> stack/… }} points
```

Compose the slots a repo needs. Rough axes — **framework** (`nestjs`, `react`,
`nextjs` on top of `react`), **ORM** (`typeorm` / `drizzle`), **styling** (`tailwind`):

```
--stack nestjs,typeorm                  a NestJS + TypeORM API
--stack fastify,prisma                  a Fastify + Zod + Prisma API
--stack spring,jpa-flyway               a Spring Boot + Kotlin API on JPA with Flyway migrations
--stack spring,jpa-flyway,docker        the same API, with its Docker Compose stack (add `docker` last)
--stack angular                         an Angular frontend (SCSS theming inline for now)
--stack nextjs,react,tailwind,drizzle   a fullstack Next.js app — nextjs primary (owns plan ordering + fullstack refs)
--stack react,tailwind                  a Vite SPA against a separate API
--stack react,css-modules               the same SPA styled with CSS Modules and design tokens
```

`typeorm` and `angular` are seeded from two repos; `drizzle`, `react`, `nextjs`,
`tailwind`, `fastify`, `prisma`, `spring`, `jpa-flyway`, `css-modules` and `docker` from one repo each. A single-consumer preset is hand-judged, not
measured, and gets refined when a second repo on that axis appears — the
`preset-cli` "no peer" limit.

`nestjs` and `typeorm` are separate on purpose. Every backend repo composes both
today, but the split is what proves the composition model works — a future backend
on Prisma or Drizzle takes `nestjs` without `typeorm`, and a repo declares the
composition as `--stack nestjs,typeorm`.

## Slots

A slot marks a point where a shared template knows a decision exists but not which
way a repo (or a stack) went. Two flavours:

- **`{{> slot: validation-stack }}`** in a `code-guidelines.md` — the repo picks a
  file from `variants/` by name. Where a repo needs something no variant covers, it
  supplies its own partial — the signal that a third variant may be warranted.
- **`{{> stack/review-checklist }}`** in a `core/` agent contract — filled from each
  stack entry's `slots/` folder. Two fill modes:
  - **concatenated** — the renderer appends the slot from every entry in `stack[]`,
    in order. `--stack nestjs,typeorm` → `review-checklist` is the nestjs framework
    rows followed by the typeorm ORM rows. Used for checklists, doc lists, reference
    lists.
  - **primary-only** — the slot is taken from `stack[0]` alone, because it is one
    coherent thing that cannot be concatenated. `plan-step-ordering` (a numbered
    sequence) and `architect-references` are primary-only; their file header says so.

Slots exist to keep the merge cheap. A template update that does not touch a slot
never conflicts with a repo's choice, which is the whole reason the extension
mechanisms are three rather than one.

## QA

The QA pipeline (`/plan-tests`, `/execute-test-plan`, `/run-qa`) is a core contract, not
stack-owned agents. A framework preset opts in by shipping a `slots/qa-target.md`; the
renderer then emits the three `core/agents/qa-*.md` docs, their command stubs and an
AGENTS.md section. A stack without it (react, nextjs today) gets none of them.

| Slot | Mode | What it fills |
|---|---|---|
| `qa-target` | primary-only | what a target is, how to validate and locate it |
| `qa-mandatory-docs` | concatenated | the stack's test docs (conventions, e2e README, configs); also read by the architect and developer when a plan has tests |
| `qa-source` | primary-only | what to read and record from the target |
| `qa-plan-rules` | primary-only | what cases a plan must contain; also the rules for the architect's **Tests** section |
| `qa-plan-format` | primary-only | the `test-plan-[target].md` template |
| `qa-write-steps` | primary-only | the writer's procedure (factories, specs, page objects, scoped runs) |
| `qa-all-targets` | primary-only | what `all` means, or that it is unsupported |

The nestjs preset fills them for Jest (unit + integration), spring for JUnit 5 + MockK
(unit, controller, integration), angular for Playwright e2e.
Adding a stack is seven small files, not three agents. Agent names come from the primary
stack (`NestjsQAArchitectAgent`) and can be set with `agents.qaArchitect.name` etc.

## What is deliberately absent

Sections that are genuinely per-project stay per-project and are not extracted. Extracting
content that *should* differ is the failure mode this whole exercise is designed to
avoid: it would report every legitimate project difference as drift, forever.
