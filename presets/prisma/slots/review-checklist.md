<!-- cairn preset: prisma — appended to the framework preset's review-checklist
     slot on `--stack <framework>,prisma`. ORM rules only. -->

| Schema change committed together with its generated migration | `prisma/schema.prisma` + `prisma/migrations/` |
| Generated `migration.sql` reviewed — no accidental `DROP`, type change, or `NOT NULL` without a default on a populated table | the migration `.sql` |
| Live data: migration is additive; a retired column is left in place, with the drop deferred | the migration `.sql` |
| Applied migration not edited; a seed migration sets explicit ids and `setval` | `prisma/migrations/` |
| New `@db.Date` column registered in its client extension | `infrastructure/prisma/` |
| Queries use a named `select`, not whole rows | service files |
| Multi-step write wrapped in `$transaction` and uses `tx` throughout | service files |
| Paginated read (`count` + page) is not wrapped in a `$transaction` | service files |
| No `$queryRawUnsafe` or string-built SQL; `LIKE` input escaped | any raw query |
| Typed `where` and raw `WHERE` for the same list kept in sync | list services |
| `prisma` reached through `deps`, no module-level client; `PrismaClient` type imported from the app's factory | service files |
| `ai/infrastructure/DATABASE_SCHEMA.md` updated to match | that file |
