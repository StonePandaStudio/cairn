<!-- cairn preset: prisma — appended to the framework preset's key-patterns slot
     on `--stack <framework>,prisma`. -->

Database schema: **`prisma/schema.prisma`** and **`ai/infrastructure/DATABASE_SCHEMA.md`**
(or the repo's data-model doc) — keep both current with every migration.

Client, query and migration conventions: **`ai/infrastructure/code-guidelines.md`** §
Prisma — client construction and extensions, `select` and transaction rules, raw SQL, and
the additive-only migration rule for live data.
