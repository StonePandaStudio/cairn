<!-- cairn preset: angular — fills {{> stack/qa-mandatory-docs }} in the QA agents and in the
     architect's / developer's reading list when a plan has tests. Concatenated across the stack. -->
- `e2e/README.md` — running tests, conventions; it names the exact commands and layout this project uses
- `e2e/playwright.config.ts` — base URL, projects, web server config
- `e2e/tests/fixtures/page-objects.ts` — existing page object classes; reuse and extend
- Any existing `e2e/tests/*.spec.ts` that touches the same area — match their structure, fixtures and assertion style
