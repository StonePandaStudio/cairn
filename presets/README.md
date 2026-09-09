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
    commands/ _stub.md                                  (renders one file per workflow step)
  nestjs/     NestJS + TypeScript framework spine, validation-stack + ORM agnostic
    variants/ validation-zod.md, validation-class-validator.md
    slots/    the framework side of each {{> stack/… }} point
  typeorm/    ORM add-on — entities, queries, migrations, decomposition
    slots/    the ORM side of the same {{> stack/… }} points (appended to nestjs)
  drizzle/    ORM add-on — Drizzle schema, drizzle-kit migrations, RLS in migrations
    slots/    the ORM side, for a Postgres/Supabase stack
  angular/    Angular spine + SCSS theming + i18n (styling still inline here — one system, two repos)
    variants/ i18n-glossr.md, i18n-external-service.md
    slots/    the Angular side of the same {{> stack/… }} points
  react/      React frontend spine — components, hooks, state, testing (styling-agnostic)
    slots/    the React side of the same {{> stack/… }} points
  nextjs/     App-Router layer over `react` — server/client boundary, actions, route handlers
    slots/    the Next.js side of the same {{> stack/… }} points
  tailwind/   styling add-on — @theme tokens, no tailwind.config.ts, dark mode via token re-map
    slots/    the styling side of the same {{> stack/… }} points
  EXTRACTION.md   what was extracted from where, and what deliberately was not
```

Compose the slots a repo needs. Rough axes — **framework** (`nestjs`, `react`,
`nextjs` on top of `react`), **ORM** (`typeorm` / `drizzle`), **styling** (`tailwind`):

```
--stack nestjs,typeorm                  snap-proof / glossr backend
--stack angular                         snap-proof / glossr frontend (SCSS theming inline for now)
--stack nextjs,react,tailwind,drizzle   charityiq — nextjs primary (owns plan ordering + fullstack refs)
--stack react,tailwind                  a Vite SPA against a separate API
```

`typeorm` and `angular` are seeded from two repos; `drizzle`, `react`, `nextjs`,
`tailwind` from one (charityiq). A single-consumer preset is hand-judged, not
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

## What is deliberately absent

Sections that are genuinely per-project stay per-project — they are listed in
`EXTRACTION.md` with the measurement that justified leaving them out. Extracting
content that *should* differ is the failure mode this whole exercise is designed to
avoid: it would report every legitimate project difference as drift, forever.
