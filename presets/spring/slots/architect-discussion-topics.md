<!-- cairn preset: spring — fills {{> stack/architect-discussion-topics }} (A.3).
     `--stack spring,jpa-flyway` also appends the jpa-flyway slot (schema, migrations). -->
- **API design questions** — endpoint naming, request/response DTO shape, error codes, pagination or filtering needs
- **Domain placement** — which existing domain area owns the use case; whether it extends an existing service or truly needs a new one
- **Transaction and locking boundary** — where the transaction opens, what must be locked, and in which order
- **Security surface** — which token type / authority may call it, and what the audit record should say
