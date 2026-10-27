# Fastify Guidelines

<!-- cairn preset: fastify. Framework spine, ORM-agnostic; composes with presets/prisma
     (`--stack fastify,prisma`). Seeded 2026-10-27 from one Fastify 5 + Zod + Prisma API
     that also runs on AWS Lambda. Single consumer: the Zod type provider is assumed, not
     a variant, and there is no QA slot set yet. Refine both when a second Fastify repo
     appears. Anything that names one project's domain, auth provider or tooling stays
     out of this file. -->

## General TypeScript Guidelines

* TypeScript `strict`; no `any` (use `unknown` and narrow)
* `import type { … }` for type-only imports
* Named `function` declarations for top-level exports; default exports only for route functions and plugin wrappers
* Prefix unused arguments with `_`
* `===` / `!==` only; use the repo's `isNullish` / `isPresent` helpers for "null or undefined"
* Never `console.*` — use `request.log` / `fastify.log`

## File Naming Conventions

* kebab-case for every file: `get-articles.ts`, `post-article.ts`, `error-handler.ts`
* Name route, schema and service files for the operation: `<verb>-<resource>.ts`
* One exported function per service file; one schema (and its inferred type) per schema file
* Tests are `<name>.test.ts`, in the plugin's `tests/` folder

## Plugin Structure

A feature is a Fastify **plugin** under `src/plugins/<feature>/`. Business logic stays out of the HTTP layer by living in `services/`, not by a second module tree.

```
src/plugins/<feature>/
  index.ts          fastify-plugin wrapper; registers routes under a prefix
  routes/           one default-exported async function per endpoint
  schemas/          Zod schemas for body, params, query and response
  services/         business logic, one function per file
  tests/            integration tests via app.inject()
```

```ts
// index.ts
export default fp(async function articlesPlugin(fastify: FastifyInstance) {
  await fastify.register(
    async (api) => {
      await api.register(getArticlesRoute)
      await api.register(postArticleRoute)
    },
    { prefix: '/articles' },
  )
})
```

* Wrap a plugin in `fastify-plugin` (`fp`) when it must decorate the parent instance (`prisma`, `requireRole`, config) or when its hooks must apply outside its own scope. A feature plugin that only declares routes may be plain.
* Cross-feature code goes in `src/lib/` (errors, logging, shared schemas, helpers) and infrastructure clients in `src/infrastructure/` — a plugin never imports another plugin's `services/`.
* Declare every decorator with a `declare module 'fastify'` augmentation next to the code that decorates.

## App Bootstrap

* `buildApp(config, opts?)` is the one factory; it returns a ready `FastifyInstance`. The dev server (`src/index.ts`) and any Lambda entry (`src/lambda.ts`) both call it — nothing else constructs the app.
* Register in this order: logger and type-provider compilers → `@fastify/cors`, `@fastify/helmet`, `@fastify/swagger` → infrastructure plugins (database, event publishers, config decorators) → feature plugins.
* Spread caller options into `Fastify({ … })` last, so tests can pass `{ logger: false }`.
* Config is one Zod schema, parsed once at startup (`loadConfig()`); an invalid or missing variable fails the boot with every offender named. The app never loads `.env` itself — the runner does.
* Expose config to plugins by decorating the instance (`fastify.decorate('featureFlagsConfig', …)`), not by reading `process.env` in services.

## Routes

* A route file default-exports `async function xRoute(fastify: FastifyInstance)` and attaches the provider: `fastify.withTypeProvider<ZodTypeProvider>().get(…)`.
* Declare `schema.params`, `schema.querystring`, `schema.body` and a `schema.response` entry for **every** status the endpoint can return, including `ApiErrorResponse` for the error statuses. The schemas are the OpenAPI source of truth — there is no hand-written spec.
* Authorize with `preValidation` / `preHandler` hooks (`fastify.requireRole(…)`), never inside the handler body.
* **Happy path only.** The handler calls one service and `send`s the result. No `try/catch`, no `switch` on a failure reason; failures are thrown by the service and mapped by the global error handler.
* Keep handlers thin: parse nothing (the schema already did), compute nothing, call the service with literal `(params, deps)`.

```ts
async (request, reply) => {
  const data = await createArticle(
    { body: request.body, userId: requireUser(request).id },
    { prisma: fastify.prisma },
  )
  return reply.code(201).send({ data })
}
```

## Schemas and Validation

* **Zod** is the only validation library; `fastify-type-provider-zod` supplies the validator and serializer compilers, set once in `buildApp`.
* Export the schema **and** its inferred type under the same name:

```ts
export const PostArticleBody = z.object({ name: z.string().trim().min(1).max(255) })
export type PostArticleBody = z.infer<typeof PostArticleBody>
```

* Query-string numbers use `z.coerce.number()`; give a pagination `limit` a `.max()`.
* On a PATCH body, do not put `.default()` on a field — it always populates the key and defeats an "at least one field" `.refine`.
* A top-level `superRefine` stops firing once any required field is missing (Zod 4). Check cross-field rules in the service when the fields can be empty.
* Response schemas are the serialization contract: a field not in the response schema is stripped. Never return an ORM row straight from a handler without a matching response schema.

## Response Conventions

Pick one envelope per repo and record it in `ai/infrastructure/`; the rows below are the default.

| Aspect | Convention |
|---|---|
| Single resource | `{ data: T }` via a shared `apiSuccessResponse(Schema)` |
| Paginated list | `{ data: T[], meta: { total, page, limit } }` via `apiPaginatedResponse(Schema)` |
| No content | `204`, empty body — never `{ data: null }` |
| Error | `{ message: string, errors?: [{ field?, code, message }] }` via one shared `ApiErrorResponse` |
| Discriminator | the HTTP status code; clients never branch on a body field |
| JSON fields | camelCase, whatever the database column is |

## Services

* **A service takes exactly two arguments: `(params, deps)`.** Never positional `(prisma, id, body)`, never a `FastifyInstance`.
* Each service file exports its own `<Name>Params` and `<Name>Deps` interfaces. `Deps` lists only the infrastructure that service uses (usually `{ prisma }`; add `log: FastifyBaseLogger` if it logs). No shared `ServiceDeps` type.
* A service with no inputs declares an empty `<Name>Params` interface and takes it as `_params`.
* Services contain no HTTP: no status codes, no `reply`, no imports from the response-schema module.
* Return the plain success shape. A failure leaves by `throw`, not by a `{ ok, reason }` union.
* Helpers that only run inside a transaction keep a `(tx, params)` shape and are never called from a route.

## Error Handling

* Throw typed errors from `src/lib/errors/domain-errors.ts`: a `DomainError` base, `EntityNotFoundError(entity, id)`, `ValidationError(issues[])`, and one class per *kind* of failure (`UnauthorizedError`, `ForbiddenError`, `ConflictError`) — not one per call site (`UserNotFoundError` is wrong; the entity name is the argument).
* Error classes carry domain data only — never a status code or response body. The same service must be callable from a script or queue consumer.
* `ValidationError` issues are `{ field, code, message }`; `code` is a stable `SCREAMING_SNAKE` string the client may branch on. Build the message at the throw site.
* **One global `setErrorHandler`** (`src/lib/error-handler.ts`, registered with `fp`) maps each class to a status. Unknown errors log the error with the request id and return a generic 500 — no stack trace, no ORM message.
* Fastify's own `FST_ERR_VALIDATION` passes through with its status (400).
* To add a failure class: add the class and one `instanceof` branch in the handler. Do not smuggle HTTP data into an existing class.
* A thrown domain error rolls back an enclosing database transaction — rely on that, don't catch and rewrap.

## Logging

* One Pino logger, configured in `buildApp`. When a request-logging plugin emits structured request/response lines, Fastify's built-in ones are off (`disableRequestLogging: true`).
* Every request has a correlation id (`genReqId`, stamped as `requestId` on each line and echoed in `x-request-id`); honour a well-formed inbound header, else mint a UUID.
* **Redaction has a single source of truth** — one list of sensitive keys expanded into Pino `redact` paths. To redact a new field, add it to that list; never inline a redaction decision at a log call. Redaction only covers the logged envelopes (`body`, `query`, `params`, `response`), so keep sensitive data inside them.
* Log expected denials (401/403) at `info`, unexpected failures at `error`. Never log tokens, passwords or raw payloads outside the redacted envelopes.

## Security

* `@fastify/helmet` on; `@fastify/cors` with an **explicit** `allowedHeaders` and `methods` allowlist — the default reflects any requested header.
* Authentication runs in a hook before the handler; an unauthenticated request must not reach a service.
* Never expose raw ORM errors, SQL, stack traces or other tenants' ids in an error response.
* Validate every input in the route schema; services trust their typed params and do not re-validate shape.
* Secrets come from config (environment / secrets manager), never from source or logs.

## Serverless (when the repo deploys to Lambda)

* The handler is `awsLambdaFastify(app, { callbackWaitsForEmptyEventLoop: false })`; without that flag every request waits for idle sockets to time out.
* Build the app **once at module scope**, outside the handler, so the connection pool survives warm invocations.
* Anything that reads static files from disk at runtime (`@fastify/swagger-ui`) is skipped in Lambda (`if (!process.env.AWS_LAMBDA_FUNCTION_NAME)`); the OpenAPI JSON is enough.
* One esbuild entry per Lambda; mark the ORM client and native modules `--external`.

## Testing

* **Integration tests are the default**: build the real app against a test database with a shared `buildTestApp()` helper and call it with `app.inject()`. Never start a listening server, never call `buildApp()` with hand-rolled config in a test.
* Structure: `before` builds the app and seeds what the suite needs; `after` removes the test rows and calls `app.close()`.
* Reference/lookup tables are seeded once and never mutated or deleted by tests. Tables a test writes to are registered in the shared clean-up helper, in foreign-key-safe order (children first).
* Test both states of every feature flag, including the flag-off path (the route 404s).
* Unit tests are for pure functions (parsing, mapping, decision logic) and sit beside the file as `name.test.ts`.
* A bug fix starts with a failing test.
* Use the repo's existing test runner and its own assertion library; do not add a second framework.

## Code Quality

* Constants and enums in their own files; no magic strings or numbers in logic — name them.
* Prefer early returns and flat code over nesting.
* A comment explains *why* (a trap, a constraint, a decision), not what the code does.
