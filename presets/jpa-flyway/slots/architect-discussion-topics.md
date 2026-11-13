<!-- cairn preset: jpa-flyway — appended to presets/spring/slots/architect-discussion-topics.md
     on `--stack spring,jpa-flyway`. -->
- **Schema / entity ambiguities** — unclear relationships, nullable vs. required fields, missing constraints, index needs
- **Migration scope** — what needs a Flyway migration vs. a code-only change; destructive changes flagged explicitly
- **Locking and loading** — which rows must be locked and in what order; whether a fetch join or separate queries fits the payload size
