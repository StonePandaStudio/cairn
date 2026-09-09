<!-- cairn preset: react — fills {{> stack/review-checklist }} in the core reviewer.
     Concatenated with any other stack entry's slot. -->

| Function components, one per file, typed props (no bare `any`) | component `.tsx` files |
| Component in the right folder — `ui/` primitive, `feature/` domain, `brand/` identity | `components/` |
| No `localStorage` / `sessionStorage` | any client code |
| No fetch-in-`useEffect` for server state — a query library or RSC | component / hook files |
| No hard-coded colours in components — go through the styling preset's token layer | `.tsx` |
| Derived values computed in render, not synced via an effect | component `.tsx` |
| New behaviour has a Vitest test; user-visible flow has a Playwright spec | `tests/unit/`, `tests/e2e/` |
