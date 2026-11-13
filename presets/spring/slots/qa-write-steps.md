<!-- cairn preset: spring — fills {{> stack/qa-write-steps }} (qa-developer T.3 onward). -->
### T.3 — Start the test database, if this project needs one

Unit tests with MockK need nothing. If the integration tests need a running database
(not H2), the conventions doc names the command. **Skip this when the caller says it is
already running.** Otherwise start it once and leave it up for the session. Use the
project's full-suite command only if it is documented as safe for repeated scoped runs.

### T.4 — Test data builders

For each entry under "Mocks needed" that has no existing builder or factory at this
project's test-support path (see the conventions doc): create one following the existing
convention, with a fresh id per build. If it exists, leave it alone.

### T.5 — Unit service tests

For each service block, write `<Class>Test.kt` mirroring the production package. Use the
`buildSut` pattern at the bottom of the class and `` `method -- scenario` `` names. Mock every listed
dependency with MockK, verify through `Deps`, implement each planned row. Run the single
new class, scoped (`./gradlew :<module>:test --tests '<fqcn>'` — the conventions doc has the
exact command). On failure: one fix, one re-run, record.

### T.6 — Controller tests

Same, at the conventional controller-test path.

### T.7 — Integration tests

- Import only what the plan named, plus the security configuration needed for a protected route — never the whole application context unless the conventions doc says that is the convention
- Reset and seed state per test, per the conventions doc
- Authenticate with the token type the plan names

Run it scoped, same as the unit tests.

### T.8 — Visibility fixes

If a test fails to compile because a class is `private` / `internal` where it must be reachable, widen only that visibility. That is the **only** permitted change under `src/main/`.
Anything more — renaming, new services, schema changes — stop and report instead of
improvising. Do not touch shared test support or base classes either.
