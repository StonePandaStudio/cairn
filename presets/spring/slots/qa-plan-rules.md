<!-- cairn preset: spring — fills {{> stack/qa-plan-rules }} (qa-architect P.4) and the
     architect's **Tests** section. -->
- Every row is a complete test name in the project's `` `method -- scenario` `` form — specific, not generic
- Happy path, rejected / not-found / conflict, and validation cases must all be represented
- **Every endpoint guarded by a token type or role needs a forbidden case** naming a token or role that must be refused (e.g. a user token on a machine-only route)
- **Every endpoint scoped to a user or project needs a cross-scope case** (a record of another user → not-found, not forbidden, if the code masks existence)
- A service that takes locks needs a case for the "disappeared before lock" path
- Mutations that audit: one case asserts the audit record, and one asserts none is written on a no-op or rejection
- Check the testing conventions doc for any project-specific rule about what not to assert
