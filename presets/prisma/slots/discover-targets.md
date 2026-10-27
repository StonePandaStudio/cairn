<!-- cairn preset: prisma — fills {{> stack/discover-targets }} (D.2). -->
**Entities** (`ai/contexts/entities/`): one per `model` in `prisma/schema.prisma`. Sections:
*Fields* (a table of name, type, nullable, default), *Relations*, *Invariants* (`@unique`
and `@@index` keys, enums, soft-delete or `active` flags, constraints added by hand in
`prisma/migrations/`). Skip implicit many-to-many join tables and models that are only a
lookup list of `value` + `active` — document those once, together, as a single
*reference data* doc.
