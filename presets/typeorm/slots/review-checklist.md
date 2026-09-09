<!-- cairn preset: typeorm — appended to presets/nestjs/slots/review-checklist.md
     when the repo is `--stack nestjs,typeorm`. ORM rules only. -->

| No inline TypeORM queries with relations/select — must be in a `queries/` folder | Service files |
| One-to-many / many-to-many relationships decomposed into separate queries, not JOINs | Service files |
| Mappers only for complex transformations — simple field picking uses `@Expose()` in the DTO | Mapper files |
| Schema changes go through a migration, never a direct entity edit + `synchronize` | Entity + migration files |
| `ai/infrastructure/DATABASE_SCHEMA.md` updated to match a schema change | that file |
