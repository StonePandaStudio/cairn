<!-- cairn preset: react — fills {{> stack/implementation-reference }} in the core
     developer. -->

### Components
- Function component per file; props via an explicit `interface`
- Folder by role: `components/{ui,feature,brand}/`
- Compose small primitives; lift state only as far as it is shared

### Hooks
- Custom hooks in `hooks/` (or colocated), prefixed `use`
- One concern per hook; return a stable shape
- Effects only for genuine side effects (subscriptions, imperative DOM) — not to mirror props into state

### Styling
- Whatever the styling add-on defines (`presets/tailwind` for Tailwind repos)
- The constant: no inline hex in components, responsive and dark mode handled at the token layer

### Data
- Server state through a query library (or RSC where the framework provides it)
- No `localStorage` / `sessionStorage`
- Loading and error states are explicit, not implicit

### Tests
- `tests/unit/*.test.tsx` — Vitest + Testing Library, behaviour-first
- MSW for any HTTP the component makes
- `tests/e2e/*.spec.ts` — Playwright for the whole flow
