<!-- cairn preset: typeorm — fills {{> stack/discover-targets }} (D.2). -->
**Entities** (`ai/contexts/entities/`): one per `@Entity()` class. Sections: *Fields* (a
table of name, type, nullable), *Relations*, *Invariants* (unique keys, enums, soft delete,
anything the migrations or the class enforce). Skip join tables that have no behavior of
their own.
