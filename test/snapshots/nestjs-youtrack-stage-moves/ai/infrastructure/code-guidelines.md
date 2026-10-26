# Code Guidelines

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

* Use **`Payload` prefix** for incoming request data (body, query params):
    - `RegisterOwnerPayload`, `CreateProjectPayload`, `UpdateUserPayload`
    - File: `register-owner-payload.dto.ts`
* Use **`Response` prefix** for server response shapes:
    - `RegisterOwnerResponse`, `UserResponse`, `ProjectListResponse`
    - File: `register-owner-response.dto.ts`

**Examples**:
```typescript
// Request DTO
export class RegisterOwnerPayload extends createZodDto(RegisterOwnerSchema) {}

// Response DTO
export class RegisterOwnerResponse extends createZodDto(RegisterOwnerResponseSchema) {}
```

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

* **ALWAYS** use `@ZodResponse({ type: MyResponse })` on every endpoint that returns data — do NOT add explicit TypeScript return types when using `@ZodResponse` as it infers them

**`@ZodResponse` rules:**
* Replaces `@ZodSerializerDto`, `@ApiResponse`, and the return type annotation in one decorator
* Keeps run-time serialization, compile-time types, and OpenAPI docs in sync
* For arrays use `[MyDto]` syntax: `@ZodResponse({ type: [UserResponse] })`
* For non-200 status codes: `@ZodResponse({ status: 201, type: MyResponse })`
* For endpoints returning `void` (e.g. DELETE), omit `@ZodResponse`
* For endpoints returning raw streams/files (using `@Res()`), omit `@ZodResponse`

**Example**:
```typescript
import { ZodResponse } from 'nestjs-zod';

@Controller('users')
export class UserController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ZodResponse({ type: UserResponse })
  async getMe(@CurrentUser('sub') userId: string) {
    return this.userService.findById(userId);
  }

  @Get()
  @ZodResponse({ type: [UserResponse] })
  async listUsers() {
    return this.userService.findAll();
  }

  @Post()
  @ZodResponse({ status: 201, type: UserResponse })
  async createUser(@Body() dto: CreateUserPayload) {
    return this.userService.create(dto);
  }

  @Delete(':id')
  // No @ZodResponse — returns void
  async deleteUser(@Param('id') id: string): Promise<void> {
    await this.userService.delete(id);
  }
}
```

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

* Use **Zod schemas** with `nestjs-zod` integration: `z.string()`, `z.number()`, `z.email()`, `z.optional()`, etc.
* Create DTOs by extending `createZodDto()` from Zod schemas
* Add Swagger documentation via Zod schema metadata or `@ApiProperty()` decorators
* Provide validation error messages in Zod schema definitions

**Example**:
```typescript
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const CreateUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
```

## Validation

* Validate at API boundaries (in controllers via DTOs)
* Provide clear, user-friendly validation error messages

* Use **Zod schemas** for all DTO validation
* Use `ZodValidationPipe` (from `nestjs-zod`) globally or per-controller
* Create custom Zod schemas for complex validation logic
* Provide clear, user-friendly validation error messages in schema definitions

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

**IMPORTANT**: Use Zod schemas for response DTOs to automatically handle entity-to-DTO transformation with type safety.

**How it works**:
* Response DTOs extend `createZodDto()` from Zod schemas
* Zod schemas pick which fields to include in the response
* Automatic type inference from Zod schemas
* Built-in serialization support via `nestjs-zod`

**Best Practices**:
* Return entities or plain objects from service methods
* Define response DTOs as separate Zod schemas
* Only perform minimal transformations needed for data structure (e.g., flattening nested properties)
* Let Zod handle field selection and type transformation
* Do **NOT** create separate mapper functions just to pick fields

**Example - Correct approach**:
```typescript
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Response schema - pick fields that should be returned
const DeviceWithProjectsSchema = z.object({
  id: z.string(),
  description: z.string(),
  site: z.object({
    id: z.string(),
    name: z.string(),
    city: z.string().nullable(),
  }).nullable(),
});

export class DeviceWithProjectsResponse extends createZodDto(DeviceWithProjectsSchema) {}

// Service method - minimal transformation
async getDevicesByProjects() {
  const devices = await this.siteDeviceService.getDevicesByProjects();

  // Only flatten nested structures that don't match schema
  return devices.map(device => ({
    ...device,
    site: device.site ? {
      ...device.site,
      city: device.site.city?.name || null  // Flatten CityEntity to string
    } : null,
  }));
}
```

**Example - Incorrect approach** (avoid this):
```typescript
// ❌ DON'T create mapper functions just to pick fields
function mapToResponse(device) {
  return {
    id: device.id,              // The Zod schema does this automatically
    description: device.description,
  };
}
```

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

**Query params** — always `page` + `pageSize` with `z.coerce.number()` (coercion required because query params arrive as strings):

```typescript
// src/api/modules/fooApi/dtos/foo-list-query.dto.ts
const FooListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  // add sorting / filter fields as needed
});

export class FooListQuery extends createZodDto(FooListQuerySchema) {}
```

**Response DTO** — wrap the item schema with `paginatedResponseSchema`:

```typescript
// src/api/modules/fooApi/dtos/foo-list-response.dto.ts
import { createZodDto } from 'nestjs-zod';
import { paginatedResponseSchema } from '@common/dtos/paginated-response.schema';
import { FooResponseSchema } from './foo-response.dto';

const FooListResponseSchema = paginatedResponseSchema(FooResponseSchema);

export class FooListResponse extends createZodDto(FooListResponseSchema) {}
```

**Controller**:

```typescript
@Get()
@ZodResponse({ type: FooListResponse })
async list(@Query() query: FooListQuery) {
  return this.fooService.list(query);
}
```

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
