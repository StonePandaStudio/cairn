<!-- cairn preset: fastify — fills {{> stack/architect-discussion-topics }} (A.3).
     `--stack fastify,prisma` also appends the prisma slot (schema, migrations). -->
- **API design questions** — endpoint naming, request/response shape, pagination or filtering needs, error codes the client must branch on
- **Authorization** — which role or hook guards each route, and what a denied caller sees
- **Feature flags and entry points** — is the route flag-gated (and what happens flag-off); does the change also touch a Lambda, scheduler or queue consumer beyond the HTTP app
