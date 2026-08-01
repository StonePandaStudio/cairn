<!-- cairn variant: validation-stack = class-validator. Fills the dto-naming,
     dto-definition, validation-stack, controller-response,
     response-transformation and pagination-dtos slots in
     presets/node/code-guidelines.md.
     In use by: snap-backend. Requires `class-validator` + `class-transformer`
     and the project's own `@ResponseMapper` decorator. -->

## slot: dto-naming

* Use operation-prefixed names for incoming request data:
    - `CreateProjectDto`, `UpdateUserDto`
    - File: `create-feature.dto.ts`, `update-feature.dto.ts`
* Use the `Response` suffix for server response shapes:
    - `UserResponse`, `ProjectListResponse`
    - File: `feature-response.dto.ts`

## slot: dto-definition

* Use class-validator decorators: `@IsString()`, `@IsNumber()`, `@IsEmail()`, `@IsOptional()`, `@IsNotEmpty()`
* Use class-transformer decorators: `@Type()`, `@Exclude()`, `@Expose()`
* Add Swagger documentation: `@ApiProperty()`, `@ApiPropertyOptional()`
* Provide validation error messages where appropriate

## slot: validation-stack

* Use class-validator decorators on all DTO properties
* Use `ValidationPipe` globally or per-controller
* Create custom validators for complex validation logic

## slot: controller-response

* Apply `@UsePipes(ValidationPipe)` for automatic DTO validation
* Annotate the response shape with `@ResponseMapper(ResponseDtoClass)` on every endpoint that returns data

## slot: response-transformation

**IMPORTANT**: The `@ResponseMapper(ResponseDtoClass)` decorator automatically handles entity-to-DTO transformation using class-transformer.

**How it works**:
* The decorator uses `@Expose()` decorators in the response DTO to pick which fields to include
* The decorator uses `@Type()` decorators to handle nested object transformations
* You **DO NOT** need to manually create mapper functions to pick fields

**Best Practices**:
* Return entities or plain objects from service methods
* Only perform minimal transformations needed for data structure (e.g., flattening nested properties)
* Let `@ResponseMapper` handle field selection and type transformation
* Do **NOT** create separate mapper functions just to pick fields - the decorator does this automatically

**Example - Correct approach**:
```typescript
// Service method - minimal transformation
async getDevicesByProjects() {
  const devices = await this.siteDeviceService.getDevicesByProjects();

  // Only flatten nested structures that don't match DTO
  return devices.map(device => ({
    ...device,
    site: device.site ? {
      ...device.site,
      city: device.site.city?.name || null  // Flatten CityEntity to string
    } : null,
  }));
}

// Controller - @ResponseMapper handles field picking
@Get('by-projects')
@ResponseMapper(DeviceWithProjectsResponse)
async getDevicesByProjects(@Query() query: QueryDto) {
  return this.service.getDevicesByProjects(query);
}

// Response DTO - @Expose() picks fields automatically
export class DeviceWithProjectsResponse {
  @Expose() id: string;
  @Expose() description: string;
  // Only exposed fields will be returned
}
```

**Example - Incorrect approach** (avoid this):
```typescript
// ❌ DON'T create mapper functions just to pick fields
function mapToResponse(device) {
  return {
    id: device.id,              // @ResponseMapper does this
    description: device.description,  // automatically
  };
}
```

## slot: pagination-dtos

**Query params** — declare `page` and `pageSize` with `@Type(() => Number)` so query strings coerce:

```typescript
export class FooListQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}
```

**Response DTO** — expose the envelope fields and type the items:

```typescript
export class FooListResponse {
  @Expose() @Type(() => FooResponse) items: FooResponse[];
  @Expose() total: number;
  @Expose() skip: number;
  @Expose() take: number;
}
```
