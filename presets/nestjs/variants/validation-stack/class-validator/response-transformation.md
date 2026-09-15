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
