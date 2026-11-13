# JPA + Flyway Guidelines

<!-- cairn preset: jpa-flyway. Composes onto presets/spring. A backend on a different
     persistence layer takes presets/spring without this file. Seeded 2026-11-13 from
     one repo (Hibernate on a SQL database, Flyway in a separate container). Single consumer;
     refine when a second JPA repo appears.

     Not in it: the repo's table and column names, payload schemas, or the choice of
     database engine beyond "Flyway runs the migrations". -->

## Entities

* An Entity is a Hibernate model of one table. Anemic: all properties are mutable `var`, no behaviour (usually none at all).
* Live in `data/entity/`, extend `BaseEntity<ID>` from `core/entity/`.
* Use `jakarta.persistence` annotations, not `org.hibernate` ones, wherever possible.
* `BaseEntity` supplies `equals` / `hashCode` by **real class and id**, not by `HibernateProxy` identity, plus a `@Transient entityClass` that unwraps proxies. Do not override these per entity.
* ID type matches the primary key: `BIGINT AUTO_INCREMENT` → `Long`; `CHAR(36)` UUID → `String`.
* Class name = table name in CamelCase (`user_identity` → `UserIdentity`). Property name = column name in camelCase (`created_at_millis` → `createdAtMillis`). The naming strategy maps camelCase to snake_case; do not repeat names in `@Column` unless they differ.
* Generate the JPA Static Metamodel (`hibernate-jpamodelgen` via `kapt`). Entity `User` gets companion `User_`.

## DAOs

* **One DAO per Entity**, in `data/dao/`, extending `BaseDao<T, ID>` (in `core/data/`), annotated `@Component`. DAOs are grouped by the model they handle — unlike controllers and services, which are grouped by domain.
* `BaseDao` exposes only: `findAll`, `findById`, `findByIdLocked`, `refresh`, `refreshLocked`, `save`, `saveAndFlush`, `delete`. Everything else on it is `protected` and for use inside the DAO layer only (`findSingle`, `updateAll`, `deleteAll`, `createQuery`, …).
* Services receive and return Entities; no query logic in services.
* Complex reads, updates and deletes go through `Specification`, `CriteriaBuilder`, `CriteriaUpdate` / `UpdateSpecification` / `DeleteSpecification`, or a `QuerySource` for JPQL built in parts.
* Reference fields through the metamodel (`root.get(UserIdentity_.email)`, `Sort.by(UserToken_.CREATED_AT_MILLIS)`) — never string field names.

### DAO method names

| Pattern | Meaning |
|---|---|
| `findBy{Field}` | one record by field |
| `findBy{Field}AndSkipId` | same, excluding an id (uniqueness check on update) |
| `findAllBy{Field}` | all records by field |
| `findAll{Filter}SortedBy{Field}` | filtered and sorted |
| `countBy{Field}` | count |
| `updateAll{Action}` / `deleteAllBy{Field}` | bulk update / delete |

The name describes the selection **and the relations it preloads**: `…With{Relation}` or `…With{Relation1}And{Relation2}` for fetch joins (`findByProjectIdAndUserIdWithProjectAndUsers`). Consumers needing the same query shape share one DAO method; differences between use cases stay in the services.

## Loading and fetch joins

* Fetch join when the consumer needs the whole relation graph. A single-valued relation fetch join does not change result cardinality and saves round trips.
* A **collection** fetch join returns a row per element. Judge cost by rows and bytes transferred, not by SQL statement count.
* Load large payloads (LOB / JSON columns) and collection graphs in **separate queries inside one transaction**, so each LOB is sent once rather than repeated across joined rows. Exact SQL statement count is not a contract.
* Read-only use cases run in a read-only transaction. A consistent multi-query snapshot (export) uses `REPEATABLE_READ` and no pessimistic locks.

## Locking and transactions

* The service owns the transaction. A mutation takes locks (`findByIdLocked`, `refreshLocked`) in a documented, consistent order across all code paths — see the domain's processors for the order — to avoid deadlocks.
* Validate again **after** taking a lock: a row seen in an early lookup may be gone by the time the lock is held. Treat that as a normal rejected outcome, not an invariant violation.
* A bulk operation that touches many rows runs in one transaction and writes its audit record in the same transaction, so a failure leaves neither partial data nor an orphan audit row.

## Migrations (Flyway)

* Schema changes ship **only** as Flyway migrations, `V<n>__<snake_case_description>.sql`, in the migrations folder. The application never alters schema on startup and Hibernate DDL auto-generation stays off.
* Migrations run in their own container/step (a dedicated migrations container or CI step), before the backend starts, against the same database.
* Never edit a migration that has been applied anywhere. Fix forward with a new version.
* `ADD COLUMN` without `AFTER` (or other positional clauses): physical column order is not part of the schema contract.
* A destructive change (drop column/table, narrowing a type) is called out explicitly in the plan and reviewed as such.
* Keep `ai/infrastructure/DATABASE_SCHEMA.md` (and any payload-schema doc) in step with every migration.

## Testing

* DAO and mapping tests use H2 when the SQL is portable; anything engine-specific is verified against a real instance.
* Services are unit-tested with MockK DAOs; the DAO layer is tested at the DAO level, not through services.
