# Spring Boot Guidelines

<!-- cairn preset: spring. Spring Boot 3.x + Kotlin spine, ORM-agnostic. Composes with
     presets/jpa-flyway (`--stack spring,jpa-flyway`); a backend on another persistence
     layer takes this preset alone. Seeded 2026-11-13 from one repo (a Kotlin/Spring Boot
     monolith). Single consumer; refine when a second Spring repo appears.

     Not in it: project-specific domain names, concrete auth flows, transport adapters and
     the repo's actual package root. Those stay per-project. -->

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
