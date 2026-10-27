<!-- cairn preset: fastify — fills {{> stack/key-patterns }} in the core architect
     and developer. `--stack fastify,prisma` also appends the prisma slot. -->

Plugin and layer conventions: **`ai/infrastructure/code-guidelines.md`** § Plugin Structure
and § Services — one plugin per feature under `src/plugins/`, shared code in `src/lib/`,
clients in `src/infrastructure/`. Plans should follow the same shape.

Error conventions: **`ai/infrastructure/code-guidelines.md`** § Error Handling — services
throw typed domain errors, one global handler maps them to HTTP. A plan that adds a failure
kind names the new class and the handler branch.

Response envelope, schemas, logging and redaction: the same file, §§ Response Conventions,
Schemas and Validation, Logging.
