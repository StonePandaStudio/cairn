<!-- cairn preset: nestjs — fills {{> stack/implementation-reference }} in the core
     developer. Framework areas only. `--stack nestjs,typeorm` also appends
     presets/typeorm/slots/implementation-reference.md (entities, migrations,
     repositories). From snap-proof/backend/ai/agents/node-developer.md. -->

Quick reminders for the most common implementation areas. The authoritative source
is always `ai/infrastructure/code-guidelines.md`.

### Module structure
- Feature modules in `src/feature/<name>/` — business logic and services
- API modules in `src/api/modules/<name>/` — HTTP layer only (controllers, API-layer services, request/response DTOs)
- Register providers, imports, and exports explicitly in every module file

### Controllers
- Thin controllers: delegate all business logic to services
- `@Get()` / `@Post()` / `@Put()` / `@Patch()` / `@Delete()` with explicit route paths
- Bind inputs with `@Body()`, `@Param()`, `@Query()`
- Apply {{#if validation.zod}}`ZodValidationPipe`{{else}}`ValidationPipe`{{/if}} and `@UseGuards()` where required
- Return consistent response shapes; {{#if validation.zod}}`@ZodResponse({ type: … })` on every endpoint that returns data{{else}}use response DTOs and `@ResponseMapper(ResponseDtoClass)`{{/if}}

### Services
- All business logic in feature services; API-layer services handle HTTP concerns only
- Throw NestJS built-in exceptions: `NotFoundException`, `BadRequestException`, `UnauthorizedException`, …
- async/await throughout

### DTOs
- One file per DTO, `.dto.ts` suffix; {{#if validation.zod}}a Zod schema per DTO, extended via `createZodDto()`{{else}}validation decorators on every property{{/if}} — see `ai/infrastructure/code-guidelines.md` § DTOs for the naming and validation conventions
- `@ApiProperty()` from `@nestjs/swagger` on every property{{#if validation.zod}} not already covered by Zod schema metadata{{/if}}
- Request DTOs in `src/api/dtos/`; shared/internal DTOs in `src/feature/dtos/`

### Error handling
- Use NestJS exceptions — never expose raw DB errors or stack traces
- Custom exceptions extend `HttpException` only when no built-in fits
- Log errors at service level; never log sensitive data

### Testing
- Unit tests for services: `feature-name.service.spec.ts`
- `Test.createTestingModule()` for NestJS context; mock dependencies
- Cover happy paths, not-found cases, and validation failures

### File naming
- `feature-name.module.ts` / `.service.ts` / `.controller.ts`
- DTOs: `create-feature.dto.ts`, `update-feature.dto.ts`, `feature-response.dto.ts`
- Tests: `feature-name.service.spec.ts`
- All kebab-case
