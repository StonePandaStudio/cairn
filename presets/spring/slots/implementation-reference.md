<!-- cairn preset: spring — fills {{> stack/implementation-reference }} in the core
     developer. Framework areas only. `--stack spring,jpa-flyway` also appends
     presets/jpa-flyway/slots/implementation-reference.md (entities, DAOs, migrations). -->

Quick reminders for the most common implementation areas. The authoritative source
is always `ai/infrastructure/code-guidelines.md`.

### Layers
- Controller → Service → DAO. A controller never calls a DAO or another controller
- Transactions open in the service, nowhere else
- Controllers are named for the domain (`AuthController`), extend `BaseController`, and are thin

### Domain placement
- New code goes in `domain/<area>/` with its own `dto/` and `exception/` subpackages
- Check the area's existing services first; extend one before adding another
- No `common` / `shared` / `util` / `model` packages. Shared logic lives with its owner
- `Service` = use-case boundary, `Manager` = internal mechanism, otherwise a private method

### DTOs
- Anemic Kotlin data classes matching the client contract; no behaviour, no extra mapping layer
- Shared data-only contracts used by several domains live in `data/dto/`

### Errors
- Throw a domain exception extending `AppException` (stable code, HTTP status, default 422)
- `throw` directly in the validation branch — no helper that only builds one exception
- Never expose raw persistence errors or stack traces

### Kotlin hygiene
- Constructor injection, `val` parameters; no `!!` in production code
- Build must stay warning-free (`allWarningsAsErrors`)
- Format checks: named precompiled `Regex`; `URI` / `InetAddress` for standard formats

### Testing
- JUnit 5 + MockK + AssertJ; class `<Class>Test`, method `` `method -- scenario` ``
- `buildSut { }` + `Deps` at the bottom of the class
- Cover happy path, not-found / rejected, and validation failure

### File naming
- One top-level class per file, file named after the class (`AuthService.kt`)
- Tests mirror the production package: `src/test/kotlin/<same package>/<Class>Test.kt`
