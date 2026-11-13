<!-- cairn preset: spring — fills {{> stack/qa-target }} (qa-architect P.1). Target = a domain area. -->
The target is a **domain area**: a package `src/main/kotlin/<base-package>/domain/[target]/`.

- Verify the package exists. If not, stop: "Domain not found at `domain/[target]/`."
- **Locate the controller.** Controllers are named for the domain (`[Target]Controller`),
  but the mapping is not always regular — some domains have no controller (scheduled
  jobs) and some controllers span a sub-area. List the package and match by hand.
- A domain with no controller: plan service unit tests only; omit the Controllers and
  Integration sections.
- A transport-adapter domain (e.g. a messaging or RPC front) delegates to another domain's service.
  Treat it as its own subject: plan tests for its mapping and error translation, and
  mock the delegated service.
