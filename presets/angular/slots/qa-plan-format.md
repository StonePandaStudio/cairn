<!-- cairn preset: angular — fills {{> stack/qa-plan-format }} (qa-architect). -->
````markdown
# Test Plan — [target] ([task])

**Target:** `<path>`  (route: `/<url>` if a page)
**Spec file:** `e2e/tests/[feature].spec.ts`  *(new, or the existing one to extend)*

## Flows

| # | Test case | Flow | Selectors |
|---|---|---|---|
| E1 | adds a new site | click Add, fill the form, submit | `getByRole('button', { name: 'Add site' })`, `getByTestId('site-form-name-input')` |

## `data-testid` to add

| Template | Element | Value |
|---|---|---|
| `src/app/.../foo.component.html` | the name input | `site-form-name-input` |

*(None, if every selector above resolves without one.)*

## Page objects

- `SitesPage` in `e2e/tests/fixtures/page-objects.ts` — extend with `addNewSite()`
- *(or: none needed)*

## Blockers

*(Auth state, seed data, flakiness — or: none.)*
````
