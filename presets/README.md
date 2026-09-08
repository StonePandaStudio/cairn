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
  node/       NestJS + TypeScript spine, validation-stack agnostic
    variants/ validation-zod.md, validation-class-validator.md
  typeorm/    ORM guidance — entities, queries, migrations, decomposition
  angular/    Angular + SCSS theming + i18n spine
    variants/ i18n-glossr.md, i18n-external-service.md
  EXTRACTION.md   what was extracted from where, and what deliberately was not
```

`node` and `typeorm` are separate on purpose. Every backend repo composes both
today, but the split is what proves the composition model works — and a future
backend on Prisma or Drizzle would take `node` without `typeorm`.

## Slots

A slot marks a point where the preset knows a decision exists but not which way a
repo went:

```
{{> slot: validation-stack }}
```

Slot content lives in `variants/`. A repo picks one by name; the renderer
substitutes it. Where a repo needs something no variant covers, it supplies its own
partial — that is the signal that a third variant may be warranted.

Slots exist to keep the merge cheap. A template update that does not touch a slot
never conflicts with a repo's choice, which is the whole reason the extension
mechanisms are three rather than one.

## What is deliberately absent

Sections that are genuinely per-project stay per-project — they are listed in
`EXTRACTION.md` with the measurement that justified leaving them out. Extracting
content that *should* differ is the failure mode this whole exercise is designed to
avoid: it would report every legitimate project difference as drift, forever.
