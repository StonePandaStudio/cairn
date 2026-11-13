# Spring Boot Guidelines

## Kotlin and build

* Kotlin on the JVM LTS the project pins; Gradle Kotlin DSL with a version catalog (`libs.versions.toml`) — no version literals in `build.gradle.kts`.
* Compile with `allWarningsAsErrors = true` and `-Xjsr305=strict`. A new warning is a build failure, not a backlog item.
* Use the `kotlin-spring` and `kotlin-jpa` compiler plugins instead of hand-opening classes.
* Prefer constructor injection with `val` parameters. No field injection, no `lateinit` beans.
* No `!!` outside tests. Model absence with nullable types and handle it at the boundary.

## Layering

```
Controller <-(DTO)-> Service <-(Entity)-> DAO
```

* **Controller** — parses the request into a DTO, calls exactly one service (almost always), returns a DTO or lets an exception propagate. Never touches a DAO, never calls another controller.
* **Service** — all business logic, owns the transaction, talks to DAOs in Entity terms, may call other services.
* **DAO** — loads and saves Entities; the only layer that sees `EntityManager`. (Persistence conventions live in the ORM preset.)
* **DTO** — anemic data classes that match what the client sends or receives, so no extra mapping layer is needed. No behaviour.
* Transactions open and close in the service layer, never in a controller or DAO.

## Packages: by domain, not by model

* `core/` — reusable base classes with no knowledge of this app (`BaseController`, base entity, base DAO).
* `data/` — `entity/`, `dao/`, and `dto/` for data contracts shared by several domains.
* `domain/<area>/` — one package per **use-case area with its own lifecycle** (`auth`, `billing`, `reporting`, …): controller, service, `dto/`, `exception/`.
* A table, entity, DAO or persisted JSON payload is **not** a domain. Do not create `domain/user`, `domain/project`, `domain/payload` because a model exists.
* Do not create `common`, `shared`, `model`, `util` or any technical-category package because several domains consume something. Put shared logic with its natural owner, or in a cohesive use-case area.
* Controllers and services are grouped by domain; DAOs are grouped by the model they handle (one DAO per entity).

## Services

* A service boundary follows the domain area and its lifecycle, not the existence of an entity. Before adding a service, check the domain's existing services — if the new scenario continues one's responsibility, add it there.
* `Service` suffix = application boundary that owns use cases. `Manager` = an internal mechanism that coordinates low-level operations without its own use-case contract. A stateless single-operation helper is a private method on its owner, not a class.
* Services have no common parent class.
* No interface for a single implementation. Introduce one only for several real implementations or a genuine polymorphic contract — never just as a test seam; a concrete, mockable component is the default.

## Controllers

* Extend a shared `BaseController` that holds the common `@ExceptionHandler`s and the helper that builds the standard ok-response.
* Named for the domain (`AuthController`), not the model (`UserController`).
* Thin: no business rules, no DAO calls, no transaction annotations.

## Errors

* Domain failures are exceptions extending a single `AppException`, which carries the error payload (stable code) and the HTTP status. Default status 422; override per exception.
* Domain exceptions live in the owning domain's `exception/` package.
* In a simple validation branch, `throw` the exception directly. Do not add a helper that only builds or throws one exception type — the explicit branch shows control flow and payload.
* Never leak a raw persistence error or stack trace to the client. Unexpected exceptions are logged server-side and answered with a neutral message.

## Local expressiveness

* A simple lexical check (shape of a string) uses a named, precompiled `Regex` constant — not chained `split` / `contains` / char checks.
* Standard formats (URI, IP address, …) are validated by the library parser (`URI`, `InetAddress`), never by a hand-rolled regex parser.
* Wrap a system boundary (time, UUID, randomness) in a small concrete component injected where needed (`TimeService`, `UuidService`) so tests control it.

## Security

* Authentication token type maps to a distinct Spring Security authority; routing policy (`/api/**` vs `/admin/**`) accepts only the authority that belongs there. One token type must never be usable on another surface.
* Outbound fetches of user-supplied URLs are SSRF-guarded: global addresses only, DNS pinned to the connection, no redirects, no proxies, bounded time and size.
* Secrets (signing keys, passwords) come from environment configuration, never defaults committed to the repo except clearly-marked local-dev values.

## Testing

* **JUnit 5 + MockK + AssertJ.** `H2` for slices that need a database; OkHttp `MockWebServer` for outbound HTTP.
* Test class is `<ClassUnderTest>Test`. A service with several independent public scenarios may split into `<Class><Aspect>Test` — that is not a reason to split the production service.
* Test method names use backticks and the shape `` `method -- scenario` ``, e.g. `` `validateEmail -- valid simple` ``.
* Build the subject through a `buildSut` function placed at the **bottom** of the class, taking a `Deps.() -> Unit` configurator and returning the SUT plus its mocked dependencies:

```kotlin
private fun buildSut(configure: Deps.() -> Unit = {}): Pair<InvoiceService, Deps> {
    val invoiceDao: InvoiceDao = mockk()
    val timeService: TimeService = mockk()
    return InvoiceService(invoiceDao, timeService) to Deps(invoiceDao, timeService).apply { configure() }
}

private class Deps(val invoiceDao: InvoiceDao, val timeService: TimeService)
```

* Mock only what the SUT calls. Verify behaviour through `Deps`, not through reflection or internals.
* Unit tests do not replace a runtime check: after a backend change, call the API (or run the background job) and observe the result.

## Operations

* One `application.yml` plus `application-dev.yml` / `application-prod.yml` profiles. Environment variables override everything; no environment-specific value in the base file except safe defaults.
* Remote debug on in dev, off in prod. Admin tools (DB web UI) dev-only.
* Schema changes ship as migrations run by a separate step, not by the application on startup (see the persistence preset).

---

# JPA + Flyway Guidelines

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

---

# Docker Guidelines

## File layout

* Three Compose files at the repo root: `docker-compose.yml` (base — everything common), `docker-compose-dev.yml` (dev overrides), `docker-compose-prod.yml` (prod overrides). Run as `docker compose -f docker-compose.yml -f docker-compose-<env>.yml …`.
* Each buildable service has its own folder with `Dockerfile-dev` and `Dockerfile-prod` (not a single parameterised file) — the two environments differ in kind, not in a flag.
* The base file names services, images, networks, volumes, environment and `depends_on`. It contains **no** `build:` and **no** host `ports:`; the env files add them.
* Wrap the long commands in a `Makefile` (`dev-up`, `dev-down`, `dev-logs`, `prod-up`, `prod-make`, `clean`, …) and pin the Compose project name (`-p "$(COMPOSE_PROJECT)"`) so container, volume and network names are stable across machines.

## Dev vs prod

| | Dev | Prod |
|---|---|---|
| Source | Built **on the host**; artifact (jar, `dist/`) is **mounted** into a thin runtime image | Copied into a **multi-stage** build; image is self-contained |
| Image | Runtime only (JRE, nginx) — no build tools | Builder stage discarded; runtime stage only |
| Config files | Mounted read-only (`:ro`) so edits apply on restart | Baked in |
| Debug | Debug port exposed, extra verbose profile | Off |
| Admin tools | DB web UI etc. allowed | Absent |
| Host ports | Published for every service you need to poke | Only the public entry point |

* Dev mounts are read-only unless the container must write.
* Admin tools and debug ports exist **only** in the dev override — never in base or prod.
* Prod images must run with no mounts and no host toolchain.

## Dockerfiles

* Pin base images to an explicit version (`eclipse-temurin:21-jre`, `nginx:1.28.1-alpine`) — never `latest`. Expose a `ARG DOCKERHUB=docker.io` (or similar) in front of every `FROM` so a mirror can be substituted.
* Multi-stage for prod: `builder` stage compiles; the final stage copies only the artifact. Copy dependency manifests first (`package.json` + lockfile, Gradle files), install, then copy sources, so the dependency layer caches.
* Use the lockfile install (`npm ci`), not `npm install`.
* Keep the process in the foreground as PID 1 and `exec` the real command in any wrapper script, so signals reach it.
* No secrets in images or build args. Nothing sensitive in a layer, even one that is later deleted.
* `EXPOSE` the container port; host mapping is a Compose concern.
* Add a `.dockerignore` per build context (`build`, `node_modules`, `.git`, `.env`).

## Startup order and migrations

* **Order by readiness, not by start**: a dependency declares a `healthcheck`; dependents use `depends_on: { <svc>: { condition: service_healthy } }`.
* Database migrations are a **separate run-to-completion service** (`restart: "no"`). The app depends on it with `condition: service_completed_successfully`. The app never runs DDL itself.
* The migration service depends on the DB being healthy and shares the same credentials as the app, passed through environment variables.
* Add an application-level connection retry as a second line of defence — Compose ordering does not cover a DB that restarts later.
* Long-lived services use `restart: unless-stopped`; one-shot services use `restart: "no"`.

## Configuration

* All configuration reaches a container through **environment variables** set in Compose. Defaults live in the Compose files (`${DB_NAME:-appname}`); `.env` (git-ignored) or the host environment overrides them.
* Ship a committed **`.env.example`** listing every variable, with local-dev-only values clearly marked. `.env` is in `.gitignore`.
* A variable the stack cannot run without has **no default** and fails fast with a message: `${PUBLIC_BASE_URL:?PUBLIC_BASE_URL must be configured}`. Secrets (signing keys, passwords for real environments) take this form; a default password is acceptable only for the local database.
* Host ports are variables with defaults (`"${PORT_FRONTEND:-50000}:80"`), so two checkouts can run side by side.
* One bridge network per project; one named volume per stateful service. Services reach each other by service name, never by published host port.
* Document the variable table (name, default, purpose) in the repo's architecture doc and keep it in step with the Compose files.

## Networking and edge

* Publish as few host ports as possible. In prod, one entry point (the static-frontend nginx or a gateway) fronts the stack and proxies API calls to the backend over the internal network; the backend and DB are not published.
* A real reverse proxy / TLS terminator belongs to the deployment, outside this stack. If the app can be served under a sub-path, pass the prefix as one variable (`APP_LOCATION_PREFIX`) consumed by the proxy config template **and** the backend's public-URL setting, and keep the two consistent.
* Proxy configuration is a template rendered from environment at container start (nginx `templates/` + an entrypoint script), not baked-in hostnames.

## Logging and operations

* Log to stdout/stderr only; read with `docker compose logs`. No log files inside containers.
* Do not add centralised logging, metrics stacks or orchestration to the stack unless the project asks for it.
* Image tags are `<project>/<service>:latest` for local builds; a `clean` target removes them. Version tagging for a registry is a separate concern.
* A change that touches the stack is verified by bringing it up (`make dev-up` / `prod-up`) and checking the service is healthy and reachable, not only by building.
