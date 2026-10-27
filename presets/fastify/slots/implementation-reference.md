<!-- cairn preset: fastify — fills {{> stack/implementation-reference }} in the core
     developer. Framework areas only. `--stack fastify,prisma` also appends
     presets/prisma/slots/implementation-reference.md (schema, migrations, queries). -->

Quick reminders for the most common implementation areas. The authoritative source
is always `ai/infrastructure/code-guidelines.md`.

### Plugin structure
- A feature is `src/plugins/<feature>/` — `index.ts` (fp wrapper + prefix), `routes/`, `schemas/`, `services/`, `tests/`
- Shared code in `src/lib/`, clients in `src/infrastructure/`; never import another plugin's `services/`
- New plugin → register it in `buildApp`; new decorator → add the `declare module 'fastify'` augmentation

### Routes
- Default-exported async function; `fastify.withTypeProvider<ZodTypeProvider>()`
- `schema.body` / `params` / `querystring`, and a `schema.response` entry for every status, errors as `ApiErrorResponse`
- Guards go in `preValidation` / `preHandler`; the handler body is: call one service, `reply.code(n).send({ data })`
- No `try/catch`, no branching on a failure reason

### Schemas
- Zod, one schema per file, `export const X` and `export type X = z.infer<typeof X>` under the same name
- Response schemas strip unknown fields — add a field there before expecting it on the wire

### Services
- `(params, deps)` — two arguments, always; own `<Name>Params` / `<Name>Deps` interfaces; one function per file
- No HTTP in a service; throw `EntityNotFoundError` / `ValidationError` / the other domain errors
- Return the plain success shape, no `{ ok, reason }` union

### Errors
- New failure kind → a class in `lib/errors/domain-errors.ts` plus one `instanceof` branch in `lib/error-handler.ts`
- Never expose stack traces or ORM messages in a response

### Logging
- `request.log` / `fastify.log`, never `console.*`; sensitive keys are added to the single redact list

### Testing
- `buildTestApp()` + `app.inject()`, never a listening server
- `before` seeds, `after` cleans (FK-safe order, registered in the clean-up helper) and `app.close()`s
- Cover the happy path, the 404, the validation failure, the unauthorized/forbidden case and the flag-off case where one exists

### File naming
- kebab-case everywhere: `get-articles.ts`, `create-article.ts`, `get-articles.test.ts`
