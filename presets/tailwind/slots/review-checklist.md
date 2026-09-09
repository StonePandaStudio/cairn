<!-- cairn preset: tailwind — appended to the framework preset's review-checklist
     slot on `--stack <framework>,tailwind`. -->

| No raw hex / `rgb()` / CSS custom properties in markup — only token utilities (`bg-coral`, `text-ink`) | `.tsx` / `.html` |
| No `tailwind.config.ts` — tokens live in a `@theme` block in the global stylesheet | project root |
| Dark mode via re-mapped semantic tokens, not `dark:` on every element | global stylesheet |
| `@apply` only for a genuinely repeated cluster, component-scoped — not scattered | component stylesheets |
| No hand-written layout media queries — Tailwind breakpoint prefixes | `.tsx` / `.html` |
