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
  nestjs/     NestJS + TypeScript spine, validation-stack agnostic
    variants/ validation-zod.md, validation-class-validator.md
    slots/    fills the {{> stack/… }} points the core agents declare
  typeorm/    ORM guidance — entities, queries, migrations, decomposition
  angular/    Angular + SCSS theming + i18n spine
    variants/ i18n-glossr.md, i18n-external-service.md
    slots/    the Angular side of the same {{> stack/… }} points
  EXTRACTION.md   what was extracted from where, and what deliberately was not
```

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
- **`{{> stack/review-checklist }}`** in a `core/` agent contract — the stack preset
  supplies it from its `slots/` folder. `nestjs` fills it with the TypeORM rule
  table, `angular` with the control-flow rule table.

Slots exist to keep the merge cheap. A template update that does not touch a slot
never conflicts with a repo's choice, which is the whole reason the extension
mechanisms are three rather than one.

Slots exist to keep the merge cheap. A template update that does not touch a slot
never conflicts with a repo's choice, which is the whole reason the extension
mechanisms are three rather than one.

## What is deliberately absent

Sections that are genuinely per-project stay per-project — they are listed in
`EXTRACTION.md` with the measurement that justified leaving them out. Extracting
content that *should* differ is the failure mode this whole exercise is designed to
avoid: it would report every legitimate project difference as drift, forever.
