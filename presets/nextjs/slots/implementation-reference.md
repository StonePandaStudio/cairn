<!-- cairn preset: nextjs — appended to the implementation-reference slot on a
     `--stack nextjs,react,...` repo. -->

### Server / Client
- Default Server Component; `"use client"` at the smallest island that needs it
- Client boundary never pulls in DB clients, secrets, or `server-only` modules
- Pass data down as props from the Server Component; don't refetch on the client

### Server Actions
- `'use server'`; validate args; do the whole unit of work (authorize → mutate → revalidate)
- `revalidatePath` / `revalidateTag` after a write; return a serializable result
- Colocate as `app/<segment>/actions.ts`

### Route Handlers
- `app/**/route.ts` for webhooks and non-action HTTP; verify the caller first; keep thin

### App Router
- `page` / `layout` / `loading` / `error` / `not-found` per segment
- Route groups `(name)/`, dynamic `[param]` / `[...slug]`
- `Metadata` / `generateMetadata` on every routable page
- `next/font`, `next/image` — no raw `<img>` / `<link>` font

### Data
- Fetch in RSC / Actions; use framework cache primitives, not a client cache
