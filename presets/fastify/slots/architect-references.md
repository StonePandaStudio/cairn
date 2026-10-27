<!-- cairn preset: fastify — fills {{> stack/architect-references }} (A.1).
     Primary-stack-only, not concatenated. -->
- Backend source files (plugins: routes, schemas, services; `lib/` shared code; `infrastructure/` clients)
- Context docs in `ai/contexts/**` — entity definitions, business logic, feature docs
- The frontend repo's context docs, and its generated API client or OpenAPI types, if the task changes a route or schema the frontend consumes
