# Code Guidelines

<!-- cairn preset: nestjs. Composes with presets/typeorm for TypeORM-backed services. -->

## General TypeScript Guidelines

* Use TypeScript strict mode
* Prefer `const` over `let`, never use `var`
* Avoid using `any` type - use proper TypeScript types
* Use async/await instead of raw promises
* Handle all error cases explicitly
* Use proper error types from NestJS (`NotFoundException`, `BadRequestException`, etc.)

## NestJS Module Structure

* Separate business logic (feature modules in `src/feature/`) from API layer (API modules in `src/api/modules/`)
* Use proper dependency injection with `@Injectable()`, `@Module()` decorators
* Register providers, imports, and exports correctly in module files
* Keep controllers thin - delegate business logic to services

## File Naming Conventions

* Use kebab-case (dash-case) for all file names
* Modules: `feature-name.module.ts`
* Services: `feature-name.service.ts`
* Controllers: `feature-name.controller.ts`
* Entities: `feature-name.entity.ts`
* Interfaces: `interface-name.interface.ts` (stored in `interfaces/` folder)
* Tests: `feature-name.service.spec.ts`, `feature-name.controller.spec.ts`

DTO file naming follows the validation stack:

{{> slot: dto-naming }}

## File Organization

Every utility function, model, constant, DTO, or mapping function should be in a separated file.

Files should be placed in appropriate folders within modules (see `ai/infrastructure/project-structure.md` for module details):

* **constants/** - Constants specific to the module
* **enums/** - Enums specific to the module
* **interfaces/** - TypeScript interfaces (one per file)
* **dtos/** - Data Transfer Objects for request/response
* **entities/** - Database entities
* **services/** - Business logic services
* **controllers/** - HTTP controllers
* **mappers/** - Mapping functions for transforming data

## Interfaces

**IMPORTANT**: Store interfaces separately from code in dedicated interface files.

**Rules**:
* Each interface gets its own file in `src/feature/[feature-name]/interfaces/` folder
* File naming: convert interface name to kebab-case + `.interface.ts`
  - E.g., `CreateUserData` → `create-user-data.interface.ts`
  - E.g., `RegisterOwnerResult` → `register-owner-result.interface.ts`
* One interface per file — no mixing multiple interfaces
* Interfaces are NOT exported from barrel files unless necessary

**Examples**:
```typescript
// src/feature/user/interfaces/create-user-data.interface.ts
export interface CreateUserData {
  companyId: string;
  email: string;
  name: string;
  passwordHash: string;
  role?: TenantRole;
}

// src/feature/user/interfaces/register-owner-result.interface.ts
export interface RegisterOwnerResult {
  user: User;
  company: Company;
}
```

## Controllers

* Keep controllers thin - only handle HTTP concerns
* Use proper HTTP method decorators: `@Get()`, `@Post()`, `@Put()`, `@Delete()`, `@Patch()`
* Use parameter decorators: `@Body()`, `@Param()`, `@Query()`, `@Headers()`
* Use `@UseGuards()` for authentication and authorization
* Return consistent response structures
* Let NestJS exception filters handle errors

Response typing and serialization are stack-specific:

{{> slot: controller-response }}

## Services

* Implement all business logic in services
* Use dependency injection for all dependencies
* Mark services with `@Injectable()` decorator
* Handle database transactions properly
* Throw appropriate NestJS exceptions
* Keep methods focused and single-purpose
* Use async/await for all asynchronous operations

## DTOs (Data Transfer Objects)

* Create separate DTOs for different operations:
    - `create-*.dto.ts` for POST requests
    - `update-*.dto.ts` for PUT/PATCH requests
    - `*-response.dto.ts` for responses
    - `*-query.dto.ts` for query parameters

{{> slot: dto-definition }}

## Validation

* Validate at API boundaries (in controllers via DTOs)
* Provide clear, user-friendly validation error messages

{{> slot: validation-stack }}

## Error Handling

* Use NestJS built-in exceptions:
    - `NotFoundException` - Resource not found (404)
    - `BadRequestException` - Invalid input (400)
    - `UnauthorizedException` - Not authenticated (401)
    - `ForbiddenException` - Not authorized (403)
    - `ConflictException` - Resource conflict (409)
* Create custom exception classes for domain-specific errors
* Use exception filters for global error handling
* Log errors appropriately (use NestJS Logger)
* Never expose sensitive information in error messages
* Never expose stack traces in production

## Error Codes

**MANDATORY**: Every thrown exception **must** include a machine-readable `code` from `ERROR_CODES`.

**Why**: Frontend uses `code` to display localized messages. String-matching on `message` is forbidden.

**Constants file**: `src/common/constants/error-codes.constant.ts` — single source of truth for all codes.
Add new codes here before using them. Never use inline strings.

**Throw pattern**:
```typescript
// Correct
import { ERROR_CODES } from '@common/constants/error-codes.constant';
throw new NotFoundException({ message: 'User not found', code: ERROR_CODES.USER_NOT_FOUND });

// Incorrect — missing code
throw new NotFoundException('User not found');
```

**Naming convention**: `SCREAMING_SNAKE_CASE`, format `[DOMAIN]_[REASON]`
- `USER_NOT_FOUND`, `USER_DEACTIVATED`
- `INVITATION_NOT_FOUND`, `USER_LIMIT_REACHED`
- `INVALID_CREDENTIALS`, `CONFIRMATION_TOKEN_EXPIRED`

**Exceptions to this rule** (do NOT add codes):
- Validation pipe errors — these carry a per-field `code` in the `errors` array instead
- Bare `UnauthorizedException()` in the JWT strategy — no info leak on invalid token by design

## Response Transformation

{{> slot: response-transformation }}

## Pagination

Use a shared `paginatedResponseSchema` helper for all list endpoints that return paginated data.

**Rules**:
* Query params always use `page`/`pageSize` — never expose `skip`/`take` to the client
* Response always uses the `{ items, total, skip, take }` shape — never `page`/`pageSize`
* `pageSize` max is 100; default is 50
* Always use `getManyAndCount()` so `total` is accurate

**Service** — convert `page`/`pageSize` to `skip`/`take` and return the envelope:

```typescript
async list(params: { page: number; pageSize: number }): Promise<{ items: Foo[]; total: number; skip: number; take: number }> {
  const skip = (params.page - 1) * params.pageSize;
  const take = params.pageSize;
  const [items, total] = await qb.skip(skip).take(take).getManyAndCount();
  return { items, total, skip, take };
}
```

Query-param coercion and response-DTO declaration are stack-specific:

{{> slot: pagination-dtos }}

## Security

* Sanitize all user input
* Use parameterized queries (the ORM handles this automatically)
* Implement authentication with Guards (`@UseGuards(AuthGuard)`)
* Implement authorization checks for protected resources
* Validate file uploads (type, size, content)
* Never commit secrets, API keys, or credentials to version control
* Use environment variables for configuration
* Hash passwords with bcrypt
* Use HTTPS in production

## Constants

File name template: `xx-yy.constant.ts` for `XxYy` constant

Files with constants should be placed in the `constants/` folder within the corresponding module (see
`ai/infrastructure/project-structure.md` for module details)

## Enums

File name template: `xx-yy.enum.ts` for `XxYy` enum

Files with enums should be placed in the `enums/` folder within the corresponding module (see `ai/infrastructure/project-structure.md` for
module details)

## No Magic Strings or Numbers

**MANDATORY**: Never use raw string or number literals where a named constant or enum value can be used instead. Magic values scatter meaning across the codebase, make refactoring error-prone, and produce silent bugs when a value changes in one place but not another.

**Rules**:
* Any string or number that carries domain meaning and appears in more than one place **must** be a constant or enum
* Any string or number that carries domain meaning and appears in only one place **should still** be a constant or enum if it is likely to be referenced elsewhere in the future (e.g. audit action names, entity type labels, JWT token types)
* Raw string comparisons against domain values are always wrong — use the enum

**Enums** for closed sets of values (token types, roles, statuses, entity types, action names):
```typescript
// ✅ Correct
export enum JwtType {
  USER = 'user',
  ADMIN = 'admin',
  IMPERSONATION = 'impersonation',
}

if (payload.type === JwtType.IMPERSONATION) { ... }

// ❌ Incorrect
if (payload.type === 'impersonation') { ... }
```

**Constants** for single values with no closed set (limits, expiry defaults, config keys):
```typescript
// ✅ Correct — src/feature/user/constants/max-invitation-attempts.constant.ts
export const MAX_INVITATION_ATTEMPTS = 5;

// ❌ Incorrect
if (attempts > 5) { ... }
```

**Where to place them**:
* Enums belong in `enums/` within the owning module — see **Enums** section above
* Constants belong in `constants/` within the owning module — see **Constants** section above
* Cross-cutting enums/constants (e.g. `JwtType`, `ERROR_CODES`) belong in `src/common/`

**Common categories that always require an enum or constant**:
* JWT `type` field values
* Audit action names and entity type labels
* Platform and tenant role values
* Any status value with a closed set
* Any HTTP header name, cookie name, or metadata key used in multiple places

## Code Quality

* Follow SOLID principles
* Keep functions small and focused (single responsibility)
* Use meaningful variable and function names
* Add comments only where logic is complex or non-obvious
* Remove commented-out code before committing
* Use TypeScript features: interfaces, types, generics, decorators
* Prefer composition over inheritance
* Use dependency injection for loose coupling
* Write self-documenting code
* Keep code DRY (Don't Repeat Yourself)
