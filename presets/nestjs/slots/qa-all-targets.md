<!-- cairn preset: nestjs — fills {{> stack/qa-all-targets }} (qa-orchestrator O.5). -->
**Discovery.** List `src/feature/`. Each subdirectory is a target, in listing order.
Skip a subdirectory that holds no service and has nothing to test (the testing
conventions doc may list exclusions, e.g. shared/common code). Features with no API
module get plans without an integration section — expected, not a failure. Confirm the
feature names before spawning any planner.
