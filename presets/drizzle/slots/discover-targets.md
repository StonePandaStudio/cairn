<!-- cairn preset: drizzle — fills {{> stack/discover-targets }} (D.2). -->
**Entities** (`ai/contexts/entities/`): one per table definition (`pgTable` or the
dialect's equivalent) in the schema files. Sections: *Fields* (a table of name, type,
nullable), *Relations*, *Invariants* (unique keys, enums, RLS policies in migrations).
Skip join tables that have no behavior of their own.
