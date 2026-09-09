<!-- cairn preset: nestjs — fills {{> stack/review-checklist }} in the core reviewer.
     Framework rules only. A repo on `--stack nestjs,typeorm` also gets the ORM
     rows from presets/typeorm/slots/review-checklist.md (the renderer concatenates
     this slot from every stack entry). Response-mapping and validation-decorator
     rows come from the chosen validation-stack variant, not here. -->

| No `any` type — use proper TypeScript types | All changed files |
| Enums in `enums/` folder, constants in `constants/` folder, kebab-case filenames | Feature module |
| No magic strings — use enum values or named constants | Anywhere |
| API modules contain no business logic (thin controllers, delegate to feature services) | Controller / API service files |
| Feature modules export only the services that API modules need | Module files |
| NestJS built-in exceptions used for errors (`NotFoundException`, `BadRequestException`, …) | Service and controller files |
