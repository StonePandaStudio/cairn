<!-- cairn preset: nestjs — fills {{> stack/qa-source }} (qa-architect P.3). -->
Read every `.ts` file under `src/feature/[target]/` and, when one exists, the API
module folder. Record:

- Every service and its public methods — name, parameters, return type, which
  repository or service calls it makes, which exceptions it throws
- Every controller endpoint — HTTP method, route path, role/auth guards applied,
  request DTO, and which response-shaping class it uses (the integration cases must
  assert against that class's exposed fields, and a mismatched class is itself a
  finding worth a test case)
- Which entities the feature owns and which tenant/company-scoped columns they
  carry, if this project is multi-tenant
- Any endpoint that takes a file upload, or any service that calls an
  external-system client (storage, payment, notification, mail, or similar) — the
  conventions doc should say what's mocked in test setup; plan assertions against
  the mock, not against the real side effect
