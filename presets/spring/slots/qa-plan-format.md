<!-- cairn preset: spring — fills {{> stack/qa-plan-format }} (qa-architect). -->
````markdown
# Test Plan — [target] ([task])

**Domain package:** `domain/[target]/`
**Controller:** `[Target]Controller`  *(or: none — unit tests only)*

---

## Services

### `[Name]Service`

#### Unit tests
File: `src/test/kotlin/<base-package>/domain/[target]/[Name]ServiceTest.kt`

| # | Test case | Method | Category |
|---|---|---|---|
| U1 | `getById -- found` | `getById()` | happy path |
| U2 | `getById -- missing record throws NotFound` | `getById()` | error |
| U3 | `update -- record of another user is masked as NotFound` | `update()` | error |

**Mocks needed (via `buildSut` / `Deps`):**
- Each DAO the service calls, with the methods it actually uses
- `TimeService` / `UuidService` where the service reads the clock or generates ids
- Any injected service or manager

*(Repeat for each service in the domain.)*

---

## Controllers

### `[Target]Controller`

#### Unit / slice tests
File: `src/test/kotlin/<base-package>/domain/[target]/[Target]ControllerTest.kt`

| # | Test case | Endpoint | Category |
|---|---|---|---|
| C1 | `create -- returns ok payload` | `POST /[path]` | happy path |
| C2 | `create -- AppException maps to its status and code` | `POST /[path]` | error |

**Mocks needed:**
- `[Name]Service` → the methods the controller calls

---

## Integration tests
File: `src/test/kotlin/<base-package>/domain/[target]/[Target]IntegrationTest.kt`

**Context:** Spring Security test support; token of the least-privileged type that reaches the happy path
**Database:** per the conventions doc (H2 or a real instance)

| # | Test case | Endpoint | Category |
|---|---|---|---|
| I1 | `list -- only own records` | `POST /[path]` | scoping |
| I2 | `get -- another user's record is not found` | `POST /[path]` | scoping |
| I3 | `list -- no token is unauthorized` | `POST /[path]` | auth |
| I4 | `list -- wrong token type is forbidden` | `POST /[path]` | auth |
| I5 | `create -- missing field is rejected` | `POST /[path]` | validation |
````

There is no "Entities to register" block unless this project's test setup needs one
explicitly — check the testing conventions doc.
