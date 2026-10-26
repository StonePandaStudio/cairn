<!-- cairn preset: nestjs — fills {{> stack/qa-plan-format }} (qa-architect). -->
````markdown
# Test Plan — [target] ([task])

**Feature module:** `src/feature/[target]/`
**API module:** `src/api/modules/[featureApi]/`  *(or: none — unit tests only)*

---

## Services

### `[FeatureName]Service`

#### Unit tests
File: `test/unit/feature/[target]/[source-file-name].service.spec.ts`

| # | Test case | Method | Category |
|---|---|---|---|
| U1 | should scope the lookup correctly | `getById()` | happy path |
| U2 | should return null when no record matches | `getById()` | error |
| U3 | should throw a not-found error for a record outside scope | `update()` | error |

**Mocks needed:**
- The repository/data-access dependency, with the methods this service actually calls
- Any injected service, with the methods this service actually calls

**Factories needed:**
- A factory for each entity this service reads or writes, per this project's factory
  convention (see the testing conventions doc)

*(Repeat for each service in the feature module.)*

---

## Controllers

### `[ControllerName]`

#### Unit tests
File: `test/unit/api/[featureApi]/[source-file-name].controller.spec.ts`

| # | Test case | Endpoint | Category |
|---|---|---|---|
| U1 | should pass the current user's scope into the payload | `POST /[path]` | happy path |
| U2 | should translate a unique-constraint violation into the domain exception | `POST /[path]` | error |

**Mocks needed:**
- `[FeatureName]Service` → `{ ... }`

**Response mappers / shaping:** `GET /[path]` → `[X]Response`, `PUT /[path]/:id` → `[Y]Response`

---

## Integration tests
File: `test/integration/[target]/[target].integration-spec.ts`

**Modules to import:** the auth module (if any route is protected) + `[FeatureName]ApiModule`
**Roles used:** the least-privileged role that reaches the happy path; a disallowed role for the forbidden cases

| # | Test case | Endpoint | Category |
|---|---|---|---|
| I1 | should return only records in the caller's scope | `GET /[path]` | scoping |
| I2 | should return 404 for a record outside the caller's scope | `GET /[path]/:id` | scoping |
| I3 | should return 401 without a token | `GET /[path]` | auth |
| I4 | should return 403 for a disallowed role | `POST /[path]` | auth |
| I5 | should return 400 when [field] is missing | `POST /[path]` | validation |
| I6 | should expose only the response class's declared fields | `GET /[path]` | response shape |
````

There is no "Entities to register" block unless this project's test module setup needs
one explicitly — check the testing conventions doc.
