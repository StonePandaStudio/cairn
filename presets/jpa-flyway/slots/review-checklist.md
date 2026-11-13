<!-- cairn preset: jpa-flyway — appended to presets/spring/slots/review-checklist.md
     when the repo is `--stack spring,jpa-flyway`. ORM rules only. -->

| Entities extend `BaseEntity<ID>`, use `jakarta.persistence` (not `org.hibernate`), no behaviour | Entity files |
| One DAO per Entity extending `BaseDao`; query helpers stay `protected`; no query logic in services | DAO / service files |
| Fields referenced via the generated metamodel (`Entity_`), not string names | DAO files |
| Fetch join methods carry a `With{Relation}` name; large payloads / collection graphs loaded in separate queries | DAO files |
| Locks taken in the documented order and state re-validated after the lock | Service files |
| Schema changes go through a new `V<n>__*.sql` migration — no edit to an applied one, no Hibernate DDL | Migration files |
| `ADD COLUMN` has no `AFTER`; destructive changes are called out | Migration files |
| `ai/infrastructure/DATABASE_SCHEMA.md` updated to match a schema change | that file |
