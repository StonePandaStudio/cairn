<!-- cairn preset: angular — fills {{> stack/qa-write-steps }} (qa-developer T.3 onward). -->
If the plan lists **Blockers**, stop and report them before editing anything.

### T.3 — Add `data-testid` attributes

For each row under "`data-testid` to add":

- Add `data-testid="<value>"` to the **template**, not the component class.
- Do not break existing accessible locators: on a `<button>` with visible text the
  attribute is additive.
- No comments explaining the attribute.
- Do not edit the component class or stylesheet. If a `data-testid` would need a
  previously private element exposed, or would land on a **shared base component**
  used widely, stop and ask.

### T.4 — Write or extend the spec

At the planned path, kebab-case after the feature (`sites.spec.ts`,
`site-photos.spec.ts`). One `test.describe` per page or feature, one `test` per plan
row, titles verbatim. `test.beforeEach` for common setup. Use `getByTestId` only for
the elements you added a `data-testid` to.

```ts
import { test, expect } from '@playwright/test';
import { SitesPage } from './fixtures/page-objects';

test.describe('Sites page', () => {
  test.beforeEach(async ({ page }) => {
    // common setup
  });

  test('adds a new site', async ({ page }) => {
    const sitesPage = new SitesPage(page);
    await sitesPage.goto();
    await sitesPage.addNewSite();
    await expect(page.getByTestId('site-form-name-input')).toBeVisible();
  });
});
```

Leave existing tests alone: do not restyle a spec that works.

### T.5 — Create or extend page objects

In `e2e/tests/fixtures/page-objects.ts` (or a new file under `fixtures/` if that one is
getting large — match what is there). The constructor takes `page: Page` and assigns
`Locator`s as `readonly` properties; methods describe **user intent**
(`addNewSite()`, `selectDevice(name)`), not raw clicks; one `goto()` per page. Prefer
accessible locators inside the class.

### T.6 — Run the new spec

With the exact command `e2e/README.md` documents (typically `yarn test
--project=chromium <spec-file>` from `e2e/`, but confirm rather than assume). Fix a
failure only by adjusting the test or page object, never feature behavior. If it
exposes a real bug in the component, stop and report it.
