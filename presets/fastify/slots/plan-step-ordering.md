<!-- cairn preset: fastify — fills {{> stack/plan-step-ordering }} in the core
     architect's Plan format. This slot is *not* concatenated across stack entries
     — it is one coherent sequence, taken from the primary stack (stack[0]). It
     assumes an ORM in step 1; a bare `--stack fastify` repo trims that step. -->
1. Schema / migration changes
2. Error classes, if the task adds a failure kind (`lib/errors/` + the global handler branch)
3. Zod schemas — params, query, body and response
4. Service functions — `(params, deps)`, one per file
5. Routes and plugin registration — guards, response schemas, `buildApp` wiring
6. Config and feature flags, if the task adds one
7. Integration tests via `app.inject()`, then unit tests for pure helpers
8. Context doc updates, and regenerating any client built from the OpenAPI spec
