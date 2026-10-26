<!-- cairn preset: nestjs — fills {{> stack/qa-write-steps }} (qa-developer T.3 onward). -->
### T.3 — Start the test database, if this project needs one

If the integration specs need a running database or other external fixture, the
conventions doc names the command to start it. **Skip this when the caller says it is
already running** (the orchestrator starts it once for a whole run). Otherwise start it
once and leave it up for the session. Use the project's normal full-suite command only
if it is documented as safe for repeated scoped runs — several projects tear the
fixture down after every invocation of their "run everything" script, which would
break a scoped-run loop.

### T.4 — Create factory files

For each entry under "Factories needed":

1. If the factory doesn't already exist at this project's factory path (see the
   conventions doc):
   - Read the entity for field names and types
   - Create it following this project's factory helper convention
   - Generate a fresh id per build; use a sequence helper for any field under a
     unique constraint
   - Leave a tenant/company-scoped column unset if this project is multi-tenant, so
     callers cannot forget it silently
   - Do not populate relation objects — only scalar columns and foreign key ids
2. If the file exists, leave it alone.

### T.5 — Unit service specs

For each service block, write the spec at this project's conventional path (mirroring
the source file's name and directory). Build through the framework's testing-module
helper, mock every listed dependency, clear mocks between tests, implement each planned
row. Run the single new file, scoped (the conventions doc has the exact command). On
failure: one fix, one re-run, record.

### T.6 — Unit controller specs

Same, at this project's conventional controller-spec path.

### T.7 — Integration spec

Write it at this project's conventional path.

- Import only the modules the plan named, plus whatever auth/bootstrap module this
  project requires for a protected route — never the whole app module
- Truncate/reset state and seed a user (or equivalent caller identity) before each
  test, per the conventions doc
- Close the app cleanly after the suite
- Request paths carry whatever prefix this project's API uses
- Entity-specific seeding goes in local helpers inside the spec, not into the shared
  seed helper, unless the conventions doc says otherwise

Run it scoped, same as the unit specs.

### T.8 — Missing exports

If a spec fails to compile because a symbol is not exported from a feature or API
module, add the missing export. That is the **only** permitted change under `src/`.
Anything more — renaming, new services, schema changes — stop and report instead of
improvising. Do not touch shared test helpers or the base factory helper either.
