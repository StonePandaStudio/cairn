<!-- cairn preset: jpa-flyway — fills {{> stack/discover-targets }} (D.2). -->
**Entities** (`ai/contexts/entities/`): one per `@Entity` class in `data/entity/`. Sections:
*Fields* (a table of name, type, nullable), *Relations*, *Invariants* (unique keys, enums,
locking rules, anything the migrations or the class enforce), *DAO* (its named query
methods and which services use them). Skip join tables that have no behavior of their own.
Persisted JSON payload columns get their schema documented alongside the owning entity.
