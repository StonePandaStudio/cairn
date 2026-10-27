# Tailwind Guidelines

<!-- cairn preset: tailwind. The styling add-on — orthogonal to the framework, the
     way an ORM add-on is. Compose it: `--stack nextjs,tailwind,drizzle`,
     `--stack react,tailwind`. Seeded 2026-09-09 from one repo (Tailwind v4).
     Single consumer; refine when a second Tailwind repo appears.

     Not in it: the repo's actual brand token values and font choice — those are
     project-owned (the app's `app/globals.css` holds its brand colors and
     font). This preset says *where* tokens go and *how* to consume them. -->

## Tokens

* Design tokens live in a `@theme` block in the app's global stylesheet (Tailwind v4). **Never create a `tailwind.config.ts`** — Tailwind v4 ignores it.
* Semantic tokens (`--color-background`, `--color-foreground`) map to raw brand tokens; components use the semantic ones.
* Dark mode via `@media (prefers-color-scheme: dark)` re-mapping the semantic tokens — not a `dark:` variant on every element.

## Usage

* Consume tokens through the standard utility names Tailwind generates (`bg-coral`, `text-ink`, `font-sans`). No raw hex, `rgb()`, or CSS custom properties in component markup.
* Utility classes in the markup; reach for `@apply` only for a genuinely repeated cluster, in a component-scoped stylesheet.
* Responsive with Tailwind's breakpoint prefixes; do not hand-write media queries for layout.
* Class order left to the formatter (Biome / Prettier plugin) — do not hand-sort.

## Structure

* One global stylesheet for tokens and base layer; everything else is utilities in components.
* No global element selectors beyond a minimal base (`body`, `:root`).
