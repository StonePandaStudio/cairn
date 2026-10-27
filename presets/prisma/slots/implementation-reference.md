<!-- cairn preset: prisma — appended to the framework preset's
     implementation-reference slot on `--stack <framework>,prisma`. -->

### Schema
- All models in `prisma/schema.prisma`; camelCase fields with `@map("snake_case")`, `@@map("table")`
- Both sides of every relation; `@@index` for filtered/sorted columns on large tables
- Run `prisma generate` after a schema edit (the client is generated, gitignored, imported from `src/generated/prisma`)

### Migrations
- `prisma migrate dev --name <what>` to create; `prisma migrate deploy` to apply — never `db push` on a shared DB
- Read the generated SQL for drops and type changes; never edit an applied migration
- One commit = schema edit + its migration; live data → additive only
- A migration that inserts seed rows sets explicit ids and `setval`s the sequence

### Access
- `fastify.prisma` through a service's `deps` — no module-level client
- Named `select` (a shared `<ENTITY>_SELECT as const`), not whole rows
- Multi-step writes in `prisma.$transaction(async (tx) => …)` using `tx` throughout
- Paginated reads: `Promise.all([count, findMany])`, **not** in a `$transaction` (5 s timeout, `P2028`)
- Raw SQL only as a tagged template with `Prisma.sql`; dates and extensions do not apply to raw results
