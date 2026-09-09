<!-- cairn preset: nextjs — appended to the review-checklist slot on a
     `--stack nextjs,react,...` repo. Framework-boundary rules only. -->

| Server Component by default — `"use client"` only for interactivity / browser APIs / hooks | component `.tsx` |
| `"use client"` module imports no server-only code (DB client, secrets, `server-only`) | client components |
| No secret read in a Client Component; client env vars are `NEXT_PUBLIC_`-prefixed | `.tsx`, env usage |
| Server Action starts with `'use server'` and validates every argument as untrusted | `actions.ts` |
| Server Action calls `revalidatePath` / `revalidateTag` after a write | `actions.ts` |
| Route Handler verifies the caller before any work | `app/**/route.ts` |
| Data fetched in a Server Component / Action, not a client `useEffect` | component / hook files |
| Routable page exports `Metadata`; content images use `next/image`, fonts use `next/font` | `page.tsx`, `layout.tsx` |
