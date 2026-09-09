# React Guidelines

<!-- cairn preset: react. The frontend framework spine for a React app — Vite SPA
     or the client layer of a Next.js app. Seeded 2026-09-09 from charityiq-app
     (Sprint 0: CLAUDE.md conventions + ADR 0001, no component code yet). Single
     consumer; refine when a second React repo appears.

     What is NOT here: RSC, Server Actions, route handlers, the App Router. Those
     are Next.js-specific — a `presets/nextjs` composes on top (`--stack
     nextjs,drizzle`) if the repo stays Next.js. If it splits into a NestJS API +
     a React SPA, this preset pairs with `presets/nestjs` (`--stack
     nestjs,react,typeorm` on the API side is nonsense — each repo has its own
     stack). The styling system is a separate add-on (`presets/tailwind`); this
     preset is styling-agnostic. -->

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
