# Next.js Guidelines

## The framework moves fast

Next.js's App Router, `"use cache"`, and the RSC model change between minor
versions and are often ahead of training data. Before writing anything non-obvious,
check `node_modules/next/dist/**` or the version's docs. Heed deprecation notices.

## Server / Client boundary

* **Server Components by default.** Add `"use client"` only for interactivity, browser APIs, or hooks (`useState`, `useEffect`, event handlers).
* A `"use client"` module must not import server-only code — DB clients, secrets, anything marked `server-only`. Push the client boundary as far down the tree as possible; a page can be a Server Component that renders a small client island.
* Never read a secret in a Client Component. Client-exposed env vars carry the `NEXT_PUBLIC_` prefix; everything else is server-only.

## Server Actions

* `'use server'` at the top of the module (or the function). Actions run on the server; treat every argument as untrusted input and validate it.
* An action is a mutation entry point — it does the whole unit of work (validate → authorize → mutate → revalidate) and returns a serializable result.
* Call `revalidatePath` / `revalidateTag` after a write so the RSC cache reflects it.
* Do not use an action as a generic RPC for reads — read in the Server Component.

## Route Handlers

* `app/**/route.ts` for webhooks, third-party callbacks, and non-action HTTP (file downloads, health checks).
* Verify the caller (signature, secret, or auth) before doing any work.
* Keep them thin — parse, authorize, delegate to a service, respond.

## App Router structure

* `page.tsx` / `layout.tsx` / `loading.tsx` / `error.tsx` / `not-found.tsx` per segment; route groups `(name)/` for layout scoping without a URL segment; `[param]` / `[...slug]` for dynamic routes.
* Colocate a segment's server code (`actions.ts`, `queries.ts`) inside its folder.
* `Metadata` export (static or `generateMetadata`) on every routable page for SEO.
* `next/font` for fonts, `next/image` for images — never a raw `<img>` for content images or a `<link>` font.

## Data fetching

* Fetch in Server Components and Server Actions, not in client `useEffect`.
* Reach for the framework's caching primitives (`fetch` cache options, `revalidate`, `unstable_cache` / `"use cache"` where stable) rather than a bespoke client cache.

---

# Drizzle Guidelines

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
