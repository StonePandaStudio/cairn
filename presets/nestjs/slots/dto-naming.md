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
