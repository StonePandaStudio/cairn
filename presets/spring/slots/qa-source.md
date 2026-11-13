<!-- cairn preset: spring — fills {{> stack/qa-source }} (qa-architect P.3). -->
Read every `.kt` file under `domain/[target]/` (including `dto/` and `exception/`) and the
matching mirror under `src/test/kotlin/`. Record:

- Every service and its public methods — name, parameters, return type, which DAOs,
  services and managers it calls, which `AppException` subclasses it throws
- Every controller endpoint — HTTP method, path, required authority (token type), request
  and response DTO
- Which entities the domain reads or writes, and where it takes locks (`findByIdLocked`) and in what order
- Any outbound HTTP client, clock or UUID use — the conventions doc should say what is
  mocked (`MockWebServer`, `TimeService`, `UuidService`); plan assertions against the mock
- Existing tests: which scenarios are already covered, so the plan lists only new rows
