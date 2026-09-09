<!-- cairn preset: nestjs — fills {{> stack/review-checklist }} in the core reviewer.
     Verbatim from snap-proof/backend/ai/agents/node-reviewer.md § Dimension 2.
     The @ResponseMapper and "class-validator — no Zod" rows are validation-stack
     specific (see ../variants/); glossr-api on Zod would swap those two lines. -->

| Rule | Where to look |
|---|---|
| No inline TypeORM queries with relations/select (must be in `queries/` folder) | Service files |
| One-to-many / many-to-many relationships decomposed into separate queries (not JOINs) | Service files |
| `@ResponseMapper(DtoClass)` on every controller endpoint returning data | Controller files |
| DTOs use class-validator decorators (`@IsString()`, `@IsOptional()`, etc.) — no Zod | DTO files |
| No `any` type — use proper TypeScript types | All changed files |
| Enums in `enums/` folder, constants in `constants/` folder, kebab-case filenames | Feature module |
| No magic strings — use enum values or named constants | Anywhere |
| API modules contain no business logic (thin controllers, delegate to feature services) | Controller / API service files |
| Feature modules export only the services that API modules need | Module files |
| Mappers only for complex transformations — simple field picking uses `@Expose()` in the DTO | Mapper files |
| NestJS built-in exceptions used for errors (`NotFoundException`, `BadRequestException`, …) | Service and controller files |
