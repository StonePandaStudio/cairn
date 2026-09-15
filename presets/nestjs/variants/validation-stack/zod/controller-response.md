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
