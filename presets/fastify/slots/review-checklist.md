<!-- cairn preset: fastify — fills {{> stack/review-checklist }} in the core reviewer.
     Framework rules only. A repo on `--stack fastify,prisma` also gets the ORM
     rows from presets/prisma/slots/review-checklist.md (the renderer concatenates
     this slot from every stack entry). -->

| No `any` type; type-only imports use `import type` | All changed files |
| kebab-case filenames; one service function and one schema per file | New files |
| Route handler only calls a service and sends the result — no `try/catch`, no branching on a failure reason | `routes/` files |
| Route declares `schema.response` for every status it can return, errors as `ApiErrorResponse` | `routes/` files |
| Authorization is a route hook (`preValidation` / `preHandler`), not an `if` in the handler | `routes/` files |
| Service takes exactly `(params, deps)` with its own `<Name>Params` / `<Name>Deps`; no positional args, no `FastifyInstance` | `services/` files |
| No HTTP concerns in a service (no status codes, `reply`, response schemas) | `services/` files |
| Failures are thrown domain errors; a new failure kind adds a class and a global-handler branch, not a per-call-site class | `services/`, `lib/errors/`, `lib/error-handler.ts` |
| Response shape follows the repo envelope and is camelCase; 204 has an empty body | `schemas/` files |
| No `console.*`; new sensitive fields added to the single redact list, no inline redaction | Anywhere |
| Config read through the validated config object, not `process.env` in a service | Services, plugins |
| Every new route has integration tests via `app.inject()` covering success, 404, validation failure and unauthorized/forbidden | `tests/` files |
| New tables a test writes to are registered in the clean-up helper, children before parents | `tests/helpers/` |
