<!-- cairn preset: nextjs — fills {{> stack/architect-references }} (A.1).
     Primary-stack-only. This is a fullstack repo — one place holds both the UI
     and the server code. -->
- The App Router tree (`app/`) — pages, layouts, colocated `actions.ts` / `queries.ts`
- Shared server modules (`lib/`) — DB, auth, integrations, the AI client
- Context docs in `ai/contexts/**` — entities, features, page/flow business logic
