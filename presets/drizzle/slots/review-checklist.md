<!-- cairn preset: drizzle — appended to the framework preset's review-checklist
     slot on `--stack <framework>,drizzle`. -->

| No raw SQL in application code — only the Drizzle query builder, or `sql` for expressions it can't model | any `.ts` outside `supabase/migrations/` |
| Schema change committed together with its `drizzle-kit` migration | `lib/db/schema.ts` + `supabase/migrations/` |
| Generated migration reviewed — no accidental drop or type change | the migration `.sql` |
| RLS policy declared in a migration, not assumed | `supabase/migrations/` |
| Server Drizzle client not imported from a `"use client"` module | client components |
| Multi-step write wrapped in `db.transaction(...)` | service / action files |
| `ai/infrastructure/DATABASE_SCHEMA.md` updated to match | that file |
