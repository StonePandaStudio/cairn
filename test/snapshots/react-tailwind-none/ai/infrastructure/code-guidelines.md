# React Guidelines

## Components

* Function components only. One component per file, named after the file.
* Group by role: `components/ui/` (primitives), `components/feature/` (domain), `components/brand/` (marketing/identity).
* Props typed with an explicit `interface` or `type`; no `any` without a comment saying why.
* Derive, don't duplicate — compute from props/state in render, not in an effect.

## State

* **No `localStorage` or `sessionStorage`.** Persistent state lives server-side; per-session state lives in signed cookies. Client caches that survive a reload leak data across users on shared devices.
* Local UI state via `useState` / `useReducer`. Cross-tree state via context, kept small.
* Server state via a query library (or RSC) — not hand-rolled fetch-in-effect.

## Styling

* Framework-agnostic — the styling system is a composable add-on. For Tailwind, see
  `presets/tailwind` (`--stack react,tailwind`). The one rule that holds regardless:
  no hard-coded colours in components; go through whatever token layer the styling
  preset defines.

## Tests

* Unit: **Vitest** + jsdom + Testing Library, in `tests/unit/`. Test behaviour, not implementation.
* HTTP mocks: **MSW**.
* End-to-end: **Playwright**, in `tests/e2e/`.

## Tooling

* TypeScript strict.
* **Biome** for formatting (tabs, double quotes) and import organisation; ESLint for lint rules Biome does not cover.
* Path alias `@/*` → repo root.

---

# Tailwind Guidelines

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
