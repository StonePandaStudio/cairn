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
