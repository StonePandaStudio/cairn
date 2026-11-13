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

---

# TypeORM Guidelines

## TypeORM Entities

* Use snake_case for database column names: `@Column({ name: 'created_at' })`
* Use camelCase for entity property names: `createdAt`
* Always define primary key with `@PrimaryGeneratedColumn()`
* Use timestamp columns: `@CreateDateColumn()`, `@UpdateDateColumn()`
* Define relationships properly: `@OneToMany()`, `@ManyToOne()`, `@ManyToMany()`
* Add indices for frequently queried columns: `@Index()`
* Set cascade options carefully - avoid unintended deletions
* Use entity listeners when needed: `@BeforeInsert()`, `@BeforeUpdate()`

## Database Operations

**⚠️ MANDATORY RULE**: See the **Query Configuration** section below — this is NOT optional.

* Use repository pattern with `@InjectRepository(EntityName)`
* Use query builders for complex queries
* Optimize queries with proper joins and select statements
* Use transactions for multi-step operations: `queryRunner.startTransaction()`
* Handle concurrent updates with optimistic/pessimistic locking
* Be aware of N+1 query problems - use eager loading or joins
* Update database schema via migrations only
* Follow naming conventions for tables and columns in migrations
* Update `ai/infrastructure/DATABASE_SCHEMA.md` accordingly after schema changes
* Avoid loading unnecessary data - select only required fields
* Always decompose queries with one-to-many relationships
* Relationship one-to-one can be loaded in same query
* Store loaded entities in maps (id -> entity) to avoid duplicate loads
* Prefer to use TypeORM `.find` and `findOne` methods over query builder when possible
* Store IDs of related entities instead of full entities when possible to reduce memory usage
* **MUST extract query configurations to separate files in `queries/` folder** — see **Query Configuration** below

## Query Configuration

**⚠️ MANDATORY RULE**: Extract TypeORM query configurations into separate files in the `queries/` folder within feature modules. This is NOT optional.

**When to extract (ALWAYS)**:
* ✅ Any `FindManyOptions<Entity>` or `FindOneOptions<Entity>` with relations, select, or complex where clauses
* ✅ Any query configuration longer than 3-4 lines
* ✅ Any query that filters by multiple conditions
* ✅ Any query that loads related entities (one-to-one or joins)
* ✅ Any query that is or might be reused in multiple methods

**What NOT to extract**:
* ❌ Very simple queries like `{ where: { id, companyId } }` (can stay inline if truly minimal)
* ❌ One-off queries with no filtering (but prefer extraction for consistency)

**Benefits**:
* Reusable query configurations
* Easier to test and maintain
* Keeps service methods clean and focused
* Centralizes query optimization
* Makes query logic explicit and documented

**Naming Convention** (STRICT):
* File: `get-[entity]-by-[criteria].query.ts`
* Constant: `GET_[ENTITY]_BY_[CRITERIA]_QUERY`
* Example: `get-devices-by-projects.query.ts` exports `GET_DEVICES_BY_PROJECTS_QUERY`

**Structure**:
```typescript
// src/feature/siteDevices/queries/get-devices-by-projects.query.ts
import { FindManyOptions, In } from 'typeorm';
import { SiteDeviceEntity } from '@feature/siteDevices/entities/site-device.entity';
import { WithCompanyId } from '@common/types/with-company-id.interface';

interface GetDevicesByProjectsQueryProps extends WithCompanyId {
  deviceIds?: string[];
  city?: string;
}

export const GET_DEVICES_BY_PROJECTS_QUERY = ({
  companyId,
  deviceIds,
  city,
}: GetDevicesByProjectsQueryProps): FindManyOptions<SiteDeviceEntity> => ({
  where: {
    companyId,
    ...(deviceIds && deviceIds.length > 0 ? { id: In(deviceIds) } : {}),
    ...(city ? { site: { city: { name: ILike(`%${city}%`) } } } : {}),
  },
  relations: {
    site: { city: true },
    equipmentType: { icon: true },
  },
  select: {
    id: true,
    description: true,
    site: {
      id: true,
      name: true,
      address: true,
      city: { name: true },
    },
    equipmentType: {
      name: true,
      icon: { id: true, url: true },
    },
  },
});
```

**Usage in Service**:
```typescript
// ✅ Correct - use extracted query
import { GET_DEVICES_BY_PROJECTS_QUERY } from './queries/get-devices-by-projects.query';

async getDevicesByProjects(companyId: string, filters: FilterDto) {
  return this.repository.find(
    GET_DEVICES_BY_PROJECTS_QUERY({
      companyId,
      deviceIds: filters.deviceIds,
      city: filters.city,
    })
  );
}

// ❌ Incorrect - inline query configuration
async getDevicesByProjects(companyId: string, filters: FilterDto) {
  return this.repository.find({
    where: { companyId, ... },  // Don't define queries inline
    relations: { ... },
    select: { ... },
  });
}
```

**Common Mistakes to Avoid** (VIOLATIONS REQUIRE REWORK):
* ❌ DON'T inline any query with relations: `relations: { site: { city: true } }` in service code
* ❌ DON'T inline any query with select statements: `select: { id: true, name: true, ... }` in service code
* ❌ DON'T inline any query with complex where clauses in service code
* ❌ DON'T create long query configs (>3-4 lines) anywhere except in `queries/` files
* ✅ DO extract to `queries/` folder and import as a constant
* ✅ DO use extracted queries consistently across all service methods
* ✅ DO name extracted queries with the `GET_*_QUERY` pattern

**Pre-Implementation Checklist**:
1. Before writing a service method with database queries, plan the query extractions
2. Identify all `find()`, `findOne()` calls that need query configs
3. Create query files for each unique configuration
4. Import and use the extracted query constants
5. Never write inline queries with relations/select in service methods

## QueryBuilder Field Selection

**⚠️ MANDATORY**: When using `createQueryBuilder`, always select only the fields needed — never rely on the default `SELECT *` behavior.

### Why it matters

`leftJoinAndSelect('tk.namespace', 'namespace')` selects **every column** of the joined entity. On a namespace with 8 columns when you need only 3, you transfer 5 useless columns per row — multiplied by every key in the list. At scale this wastes network bandwidth, DB I/O, and memory.

### Rules

**Main entity** — replace the implicit `SELECT *` with an explicit `.select([...])`:
```typescript
// ❌ Fetches all 8 columns of translation_keys including deleted_at
.createQueryBuilder('tk')

// ✅ Fetches only what the serializer actually uses
.createQueryBuilder('tk')
.select(['tk.id', 'tk.projectId', 'tk.key', 'tk.description', 'tk.namespaceId', 'tk.createdAt'])
```

**Joined relations** — use `leftJoin` + `addSelect([...])` instead of `leftJoinAndSelect` when you don't need all columns:
```typescript
// ❌ Fetches all 8 namespace columns
.leftJoinAndSelect('tk.namespace', 'namespace')

// ✅ Fetches only the 3 columns used in the response
.leftJoin('tk.namespace', 'namespace')
.addSelect(['namespace.id', 'namespace.name', 'namespace.color'])
```

**Exception** — `leftJoinAndSelect` is acceptable only when the joined entity has ≤ 4 columns total and all are needed (e.g., a tag table with `id`, `translationKeyId`, `tag`).

### Full example
```typescript
const qb = this.translationKeyRepository
  .createQueryBuilder('tk')
  .select(['tk.id', 'tk.projectId', 'tk.key', 'tk.description', 'tk.namespaceId', 'tk.createdAt'])
  .leftJoin('tk.namespace', 'namespace')
  .addSelect(['namespace.id', 'namespace.name', 'namespace.color'])
  .leftJoinAndSelect('tk.tags', 'tags')  // tags has only 3 cols — acceptable
  .where('tk.projectId = :projectId', { projectId })
  .andWhere('tk.companyId = :companyId', { companyId });
```

### Checklist before writing a QueryBuilder query
1. List every field that the serializer/response DTO actually reads
2. Add `.select([...])` with only those fields on the main entity
3. For each joined relation, count its columns — if > 4 or not all needed, use `leftJoin` + `addSelect`
4. Never use `leftJoinAndSelect` on entities with many columns (namespaces, projects, users, companies)

## Database Query Decomposition Pattern

**IMPORTANT**: Always decompose queries with one-to-many or many-to-many relationships into separate queries.

**Why**:
- Avoids Cartesian products from JOINs
- Reduces data duplication over the wire
- Better performance for large datasets
- More explicit control over loaded data

**Pattern**:
1. Load primary entities with only one-to-one relations
2. Extract unique IDs for related entities
3. Load related entities in batch queries (using `In()` operator)
4. Create Maps for O(1) lookup — see the map rule in **Database Operations**
5. Attach related entities to primary entities in memory

**Example**:
```typescript
// Step 1: Load devices with only image (one-to-one)
const devices = await this.deviceRepository.find({
  where: { companyId },
  relations: { image: true },  // ✅ One-to-one OK
  select: { id: true, siteId: true, equipmentTypeId: true, ... }
});

// Step 2: Extract unique IDs
const siteIds = [...new Set(devices.map(d => d.siteId).filter(Boolean))];
const equipmentTypeIds = [...new Set(devices.map(d => d.equipmentTypeId).filter(Boolean))];

// Step 3: Load related entities in batch
const sites = await this.siteRepository.find({
  where: { id: In(siteIds) },
  select: { id: true, name: true, cityId: true }
});

const equipmentTypes = await this.equipmentTypeRepository.find({
  where: { id: In(equipmentTypeIds) },
  relations: { icon: true },  // ✅ One-to-one OK
});

// Step 4: Create lookup maps (O(1) access)
const siteMap = new Map(sites.map(s => [s.id, s]));
const equipmentTypeMap = new Map(equipmentTypes.map(e => [e.id, e]));

// Step 5: Attach in memory
return devices.map(device => ({
  ...device,
  site: device.siteId ? siteMap.get(device.siteId) : null,
  equipmentType: device.equipmentTypeId ? equipmentTypeMap.get(device.equipmentTypeId) : null,
}));
```

**When to use this pattern**:
- ✅ Loading entities with one-to-many relations (e.g., devices → sites)
- ✅ Loading entities with many-to-many relations (e.g., devices ↔ projects)
- ✅ When same related entity appears multiple times (sites, cities)
- ✅ When related entities need their own related entities (site → city → province)

**When NOT to use this pattern**:
- ❌ Simple one-to-one relations (use `relations` in single query)
- ❌ Loading single entity by ID
- ❌ Very small datasets (< 10 records)

## Migrations

> **⚠️ CRITICAL — read before touching any migration file.**
> TypeORM runs migrations in ascending timestamp order. A wrong timestamp silently runs a migration out of sequence, corrupting the schema. This has happened in production. Do not repeat it.

### File naming

```
{timestamp}-{PascalCaseName}.ts
```

- **`{timestamp}`** — 13-digit Unix millisecond timestamp captured **at the exact moment the file is created**. Run `Date.now()` in a Node REPL or browser console and copy that value verbatim. Examples of acceptable timestamps: `1749481200000`, `1749523417382`.
- **`{PascalCaseName}`** — short, descriptive, PascalCase description of what the migration does.

**Anti-patterns that are strictly forbidden**:
- ❌ Round numbers with trailing zeros: `1780700000000`, `1780600000000` — these are fake timestamps, not real `Date.now()` values
- ❌ Hand-crafting a timestamp to slot between two existing ones (e.g. setting it to `existingTimestamp - 8` to force ordering)
- ❌ Copying a timestamp from a plan doc, a chat message, or another migration file
- ❌ Guessing or estimating the current time

**Correct examples**:
```
1749481200000-AddStripePriceId.ts
1749512863741-AddInvoicesTable.ts
1749523417382-SubscriptionModelRework.ts
```

### Ordering guarantee

If migration B depends on migration A (e.g. B drops a column A created), A's timestamp **must** be lower than B's. Because timestamps are generated at creation time, the natural order of development guarantees this — as long as you always use real `Date.now()` values. If you fabricate timestamps, you lose this guarantee.

### In plan / description documents

Never hardcode a specific timestamp in plan or description files. Write the placeholder instead:

```
{TIMESTAMP}-MigrationName.ts
```

Include a note alongside: *"Replace `{TIMESTAMP}` with the output of `Date.now()` at the moment you create the file."*

This prevents developers from copying a stale or fabricated timestamp out of a plan doc.

### Generation

TypeORM CLI generates a real timestamp automatically:

```bash
npm run migration:generate -- src/database/migrations/MigrationName
```

For hand-written migrations: create the file manually, but get the timestamp from `Date.now()` at that moment — never invent one.

## Mappers

**When to use mappers**:
* Complex business logic transformations that go beyond simple field picking
* Data format conversions (e.g., string to Date, unit conversions)
* Aggregating data from multiple sources
* Complex nested structure transformations

**When NOT to use mappers**:
* Simple field selection — the response layer already does this
* Basic entity-to-DTO conversion — see **Response Transformation** in the nestjs preset
* Picking a subset of fields

Place mapping functions in `mappers/` folder only when truly needed for complex transformations beyond what the response layer provides.
