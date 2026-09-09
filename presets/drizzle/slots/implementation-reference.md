<!-- cairn preset: drizzle — appended to the framework preset's
     implementation-reference slot on `--stack <framework>,drizzle`. -->

### Schema
- All tables in `lib/db/schema.ts`, Drizzle syntax; snake_case columns, camelCase fields
- Relations declared with `relations(...)` so typed joins work
- No RLS in the schema module — that goes in the migration

### Migrations
- `pnpm exec drizzle-kit generate` for mechanical diffs
- Hand-write the `.sql` only for RLS policies, functions, triggers, backfills
- One commit = schema edit + its migration

### Access
- Server: the Drizzle client in `lib/db/client.ts` (service-role, never in `"use client"`)
- Browser: the Supabase client only, bounded by RLS
- Reads select named columns; multi-step writes go in `db.transaction(...)`
