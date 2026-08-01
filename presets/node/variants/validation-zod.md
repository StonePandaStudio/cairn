<!-- cairn variant: validation-stack = zod. Fills the dto-naming, dto-definition,
     validation-stack, controller-response, response-transformation and
     pagination-dtos slots in presets/node/code-guidelines.md.
     In use by: glossr-api. Requires `zod` + `nestjs-zod`. -->

## slot: dto-naming

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

## slot: dto-definition

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

## slot: validation-stack

* Use **Zod schemas** for all DTO validation
* Use `ZodValidationPipe` (from `nestjs-zod`) globally or per-controller
* Create custom Zod schemas for complex validation logic
* Provide clear, user-friendly validation error messages in schema definitions

## slot: controller-response

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

## slot: response-transformation

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

## slot: pagination-dtos

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
