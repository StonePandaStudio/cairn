# Drizzle Guidelines

<!-- cairn preset: drizzle. The ORM add-on for a Postgres/Supabase stack, parallel
     to presets/typeorm. Seeded 2026-09-09 from one repo (Sprint 0 — mostly
     CLAUDE.md hard rules + ADR 0001, no battle-tested code yet). Single consumer:
     refine when a second Drizzle repo appears. Composes onto a framework preset
     (nestjs or react/nextjs) via `--stack <framework>,drizzle`. -->

## Schema

* One schema module — `lib/db/schema.ts`. Every table, column, and relation is declared there in Drizzle syntax.
* Never write raw SQL in application code. The only place hand-written SQL is allowed is a migration file under `supabase/migrations/`.
* Column names snake_case, TypeScript field names camelCase (Drizzle maps them).
* Row-Level Security policies live in the migration files, not in the schema module — the schema describes shape, the migration describes access.

## Migrations

* Generate with `pnpm exec drizzle-kit generate` whenever the diff is mechanical; hand-write the `.sql` only for RLS policies, functions, triggers, and data backfills Drizzle Kit cannot express.
* Review every generated migration before committing — check for accidental drops or type changes.
* A schema change and its migration land in the same commit. The database is the source of truth; the schema module must always match what the migrations have applied.
* Keep `ai/infrastructure/DATABASE_SCHEMA.md` current with each migration.

## Clients

* Server queries go through the `postgres-js` + Drizzle client in `lib/db/client.ts`. It uses the service-role key and must **never** be imported from a `"use client"` module.
* The browser talks to the database only through the Supabase client, constrained by RLS — never the Drizzle client.

## Queries

* Prefer the typed query builder; reach for `sql` template literals only for expressions Drizzle does not model.
* Select only the columns a caller needs.
* Multi-step writes run inside `db.transaction(...)`.
* Watch for N+1 — batch with `inArray` / a join rather than a loop of point reads.
