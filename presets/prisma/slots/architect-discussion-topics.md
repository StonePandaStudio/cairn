<!-- cairn preset: prisma — appended to the framework preset's
     architect-discussion-topics slot on `--stack <framework>,prisma`. -->
- **Schema shape** — new models/columns, nullability, defaults, relations, indexes, unique constraints
- **Migration scope** — additive vs. destructive, whether it needs a backfill (and who owns it), whether existing rows make a `NOT NULL` unsafe, and whether the change must be split into expand / switch / contract
- **Query shape** — typed client vs. raw SQL, `select` columns, whether a list needs an index for its filter and sort
