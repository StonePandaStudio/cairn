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
