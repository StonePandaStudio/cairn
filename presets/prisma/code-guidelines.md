# Prisma Guidelines

<!-- cairn preset: prisma. ORM add-on, parallel to presets/typeorm and presets/drizzle.
     Seeded 2026-10-27 from one Prisma 7 + @prisma/adapter-pg, Postgres, Fastify API.
     Single consumer: refine when a second Prisma repo appears.
     Composes onto a framework preset (`--stack fastify,prisma`, `--stack nestjs,prisma`);
     the "Client" section assumes a Fastify decorator and is the one part a Nest repo
     would swap for a provider. Anything that names one project's models, helpers or
     reports stays out of this file. -->

## Schema

* One schema file, `prisma/schema.prisma`. Every model, enum and relation is declared there.
* Field names camelCase, database names snake_case: `firstName String @map("first_name")`, `@@map("article")`. Follow the repo's existing table-name form (singular or plural) — do not mix.
* Give every relation both sides and a named `@relation("…")` when a model has two relations to the same target.
* Add `@@index` for columns used in `where` / `orderBy` on large tables, and `@unique` for natural keys; a unique constraint is the database's guard, not the service's `findFirst`.
* Comment a non-obvious column where it is declared (why nullable, why no default) — the migration SQL will not say.
* `Json? @db.JsonB` only for per-row metadata whose shape varies by call site. Type callers as `Record<string, unknown>`, not `any`. JSON content is **not** redacted by the logger; store only what is safe to keep at rest. Add a GIN index only when a real read pattern needs it.
* Reference/lookup tables that the app edits at runtime carry an `active Boolean @default(true)` rather than being deleted.

## Client

* **Prisma 7 uses a driver adapter** (`@prisma/adapter-pg` + a `pg` pool) and a configured `prisma.config.ts` (schema path, migrations path, seed command, datasource URL from the environment).
* The generator writes the client into the source tree (`output = "../src/generated/prisma"`), which is **gitignored** and rebuilt with `prisma generate` (an install/CI step). Import the client from that path, never from `@prisma/client`.
* Build the client in one factory, `buildPrismaClient(adapter)`, which applies every `$extends` extension; export `type PrismaClient = ReturnType<typeof buildPrismaClient>` so extended results type-check everywhere.
* Register it as an `fp` plugin that decorates `fastify.prisma` and adds an `onClose` hook that calls `$disconnect()`. Services receive `prisma` through their `deps` — never import a module-level singleton.
* Export a `TransactionClient` type (`Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>`) for helpers that run inside `$transaction`.
* The pool, not Prisma, owns connection limits, SSL and `statement_timeout`; configure them where the pool is built. A fail-fast `statement_timeout` belongs on the API pool only — batch and worker pools stay unbounded.

## Migrations

* Create with `prisma migrate dev --name <what>`; apply in CI and every deployed environment with `prisma migrate deploy`. Never `migrate dev` or `db push` against a shared database.
* Read every generated `migration.sql` before committing — check for accidental `DROP`, a type change, or a `NOT NULL` column with no default on a table that has rows.
* A schema change and its migration land in the same commit; `prisma/migrations/` is append-only. **Never edit a migration that has been applied anywhere.**
* Hand-written SQL (a backfill, a trigram index, a function) goes inside the migration, after the generated DDL.
* **Live systems migrate additively** (expand → switch → contract): add the nullable or defaulted column, backfill it in the same migration, switch readers and writers in a later change, and drop the old column only in a dedicated, later cleanup. No `DROP COLUMN`, in-place `RENAME` or `ALTER … TYPE` on a column that holds real data in a feature migration. Note each deferred drop in the repo's deferred-work log.
* **A migration that seeds rows must set explicit ids and then `setval` the sequence.** `migrate reset` runs migrations before the seed script, so a value-only `INSERT` hands out ids the seed later collides with.
* Keep `ai/infrastructure/DATABASE_SCHEMA.md` (or the repo's data-model doc) current with each migration.

## Queries

* Use the typed client. **Select only the columns a caller needs** — keep a reusable `<ENTITY>_SELECT = { … } as const` next to the services that return that entity, so the `select` and the response schema stay in step.
* Multi-step writes run inside `prisma.$transaction(async (tx) => { … })`, and everything in the callback uses `tx`, not `prisma`.
* **A read-only page query (`count` + `findMany`) does not go in a `$transaction`.** Prisma's default interactive-transaction timeout is 5 s; a slow count on a large table throws `P2028` and the request 500s. Run both with `Promise.all` and accept the two snapshots.
* Existence and uniqueness checks before a write belong in the same transaction as the write; the unique constraint is still the final guard.
* Case-insensitive match: `{ equals: v, mode: 'insensitive' }`. Treat `null` and `''` as distinct values.
* Avoid N+1: use `include` / a `select` with relations, or `where: { id: { in: ids } }` once, not a query per row.
* Soft-deleted or inactive rows are filtered explicitly in the `where` (`active: true`, `deletedAt: null`); decide the default per list endpoint and test both.

## Raw SQL

* Raw SQL is for reports, window functions, CTEs and index-specific queries the client cannot express. Use the **tagged-template** form of `$queryRaw`, and `Prisma.sql` / `Prisma.join` for dynamic pieces. **Never** `$queryRawUnsafe` or string-concatenated SQL with user input.
* Escape `LIKE` input (`%`, `_`, `\`) before interpolating it into a pattern.
* Raw results are **not** passed through client extensions or `@db.Date` coercion. Select dates as text (`TO_CHAR(col, 'YYYY-MM-DD')`) or map them in the loader; alias columns to the camelCase the response schema expects.
* When a list endpoint keeps a typed `where` (for `count`) and a raw `WHERE` (for the page), they encode the same filters twice — change both together.
* Cast ids and enums explicitly (`id::text`) where the column type differs from the TypeScript type.

## Client Extensions

* Cross-cutting transforms (date columns as `YYYY-MM-DD` strings, computed fields) are `Prisma.defineExtension` modules, one per model or concern, applied in `buildPrismaClient`. A new `@db.Date` column is registered in its extension in the same change, or it silently comes back as a `Date`.
* An extension changes the result type — always use the exported `PrismaClient` type, not the base class.

## Testing

* Tests run against a real Postgres test database migrated with `prisma migrate deploy` (not `db push`), never against a mock Prisma client.
* Seed reference tables once; the suite's own rows are created in `before` and removed in `after` in foreign-key-safe order.
* After a schema change, run `prisma generate` before the type check and the test run.
