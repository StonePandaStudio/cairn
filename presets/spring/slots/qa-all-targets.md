<!-- cairn preset: spring — fills {{> stack/qa-all-targets }} (qa-orchestrator O.5). -->
**Discovery.** List `src/main/kotlin/<base-package>/domain/`. Each subdirectory is a
target, in listing order. Skip a directory that holds no service and has nothing to test
(the testing conventions doc may list exclusions). Domains without a controller get plans
without an integration section — expected, not a failure. Confirm the domain names before
spawning any planner.
