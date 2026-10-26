<!-- cairn preset: nestjs — fills {{> stack/qa-plan-rules }} (qa-architect P.4) and the
     architect's **Tests** section. -->
- Every row is a complete `it(...)` description — specific, not generic
- Happy path, error (not-found, forbidden, conflict) and validation cases must all be
  represented; add tenant-scoping cases too if this project is multi-tenant
- If this project is multi-tenant, **every tenant-scoped endpoint needs a
  cross-tenant case** (e.g. "should return 404 for a record belonging to another
  company") — multi-tenancy leaks are the highest-value bug class here
- **Every role/permission-guarded endpoint needs at least one forbidden case**
  naming a role that isn't allowed
- Integration cases are written at the HTTP level, with whatever path prefix this
  project's API uses
- Check the testing conventions doc for any project-specific rule about what not to
  assert (e.g. a known response-shape quirk for unloaded relations)
