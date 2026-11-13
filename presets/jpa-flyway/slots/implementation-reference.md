<!-- cairn preset: jpa-flyway — appended to presets/spring/slots/implementation-reference.md
     on `--stack spring,jpa-flyway`. -->

### Entities
- In `data/entity/`, extend `BaseEntity<ID>`, mutable `var` properties, `jakarta.persistence` annotations only
- Class = table in CamelCase, property = column in camelCase (naming strategy handles snake_case)
- ID type matches the key: `BIGINT AUTO_INCREMENT` → `Long`, `CHAR(36)` → `String`
- Use the generated metamodel (`Entity_`) for field references, never string names

### DAOs
- One DAO per Entity in `data/dao/`, `@Component`, extends `BaseDao<T, ID>`
- Public API is `find*`, `save*`, `delete`, `refresh*` only; query helpers are `protected`
- Complex queries via `Specification` / `CriteriaBuilder` / `QuerySource`
- Names: `findBy{Field}`, `findAllBy{Field}`, `…With{Relation}` for fetch joins, `updateAll{Action}`, `deleteAllBy{Field}`
- Services call DAOs; no query logic in services

### Locking & transactions
- Transaction opens in the service; lock with `findByIdLocked` / `refreshLocked` in the agreed order
- Re-validate after the lock — the row may have disappeared; return a rejected outcome
- Load big payloads and collection graphs in separate queries within one transaction

### Migrations
- New file `V<n>__<description>.sql` in the migrations folder; never edit an applied one
- `ADD COLUMN` without `AFTER`; flag destructive changes in the plan
- Update `ai/infrastructure/DATABASE_SCHEMA.md` with every migration
