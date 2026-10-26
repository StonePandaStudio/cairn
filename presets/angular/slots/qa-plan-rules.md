<!-- cairn preset: angular — fills {{> stack/qa-plan-rules }} (qa-architect P.4) and the
     architect's **Tests** section. -->
- **Tests verify behavior, not page loads.** Each case exercises something the user
  can do — navigate, fill a form, click an action, see a result. "Page renders without
  error" is not a case. Golden path first, edge cases after.
- **Each case is independent.** No shared mutable state between tests; it must pass in
  any order and in isolation.
- **Every case ends with an outcome assertion**, and a URL assertion is never the only
  one — pair it with a content assertion.
- **Selector priority** — for each interaction, take the first that resolves to
  exactly one element:
  1. `getByRole('<role>', { name })` — when the role is unambiguous and the name stable
  2. `getByLabel('<label>')` — form inputs paired with a `<label>`
  3. `getByText('<text>')` — non-interactive elements with stable, language-pinned text
  4. `getByTestId('<id>')` — only after the above fail (multiple matches, no accessible
     name, or translated text the test must not depend on)

  Never CSS classes, XPath, `nth-child` or deep DOM-position selectors.
- **`data-testid` is a contract; add as few as possible**, only on elements a case
  interacts with or asserts on. Kebab-case, prefixed by page or feature
  (`sites-add-button`, not `add-button`), named for purpose, not looks
  (`submit-button`, not `blue-button-bottom`), and stable across a redesign. Bad:
  `button1`, `red-icon`, `top-row`.
- **Reuse page objects**; list new ones only for a page that has none.
- **Auth, seed data, determinism.** If the target needs authenticated state with no
  fixture or login helper, depends on backend data that is not available locally,
  has non-deterministic timing or animation, or wraps a third-party widget, flag it in
  the plan (the QA plan's **Blockers** section, an architect plan's Risks) instead of
  planning cases that would be flaky.
