<!-- cairn preset: spring — fills {{> stack/review-checklist }} in the core reviewer.
     Framework rules only. A repo on `--stack spring,jpa-flyway` also gets the ORM
     rows from presets/jpa-flyway/slots/review-checklist.md. -->

| Controller calls only its service — no DAO, no other controller | Controller files |
| No business logic or `@Transactional` in a controller or DAO | Controller / DAO files |
| New service justified: no existing service in the domain already owns this lifecycle | Service files |
| No `common` / `shared` / `util` / `model` package introduced; packages follow domain areas, not data models | New packages |
| Domain failures use an `AppException` subclass in the domain's `exception/` package, no raw persistence errors leaked | Service and controller files |
| No helper whose only job is to build or throw one exception type; no interface with a single implementation | Anywhere |
| Constructor injection only; no `!!` or `lateinit` bean in production code | Kotlin files |
| Token type → authority routing unchanged or deliberately extended; no surface accepts a foreign token type | Security config |
| Simple string-shape checks use a named `Regex`; URI / IP checks use library parsers | Validation code |
| Tests follow `<Class>Test`, `` `method -- scenario` `` names and a bottom-of-class `buildSut` | Test files |
| Build is warning-free (`allWarningsAsErrors` still on) | Build files |
