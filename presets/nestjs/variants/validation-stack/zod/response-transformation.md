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
