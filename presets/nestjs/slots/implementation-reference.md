<!-- cairn preset: nestjs — fills {{> stack/implementation-reference }} in the core
     developer. Verbatim from snap-proof/backend/ai/agents/node-developer.md.
     The angular preset's equivalent slot is much thinner — the frontend developer
     doc has no block like this. -->

Quick reminders for the most common implementation areas. The authoritative source
is always `ai/infrastructure/code-guidelines.md`.

### Module structure
- Feature modules in `src/feature/<name>/` — business logic, services, repositories, entities
- API modules in `src/api/modules/<name>/` — HTTP layer only (controllers, API-layer services, request/response DTOs)
- Register providers, imports, and exports explicitly in every module file

### Controllers
- Thin controllers: delegate all business logic to services
- `@Get()` / `@Post()` / `@Put()` / `@Patch()` / `@Delete()` with explicit route paths
- Bind inputs with `@Body()`, `@Param()`, `@Query()`
- Apply `@UsePipes(ValidationPipe)` and `@UseGuards()` where required
- Return consistent response shapes; use response DTOs and mappers

### Services
- All business logic in feature services; API-layer services handle HTTP concerns only
- Inject repositories via `@InjectRepository(Entity)`
- Throw NestJS built-in exceptions: `NotFoundException`, `BadRequestException`, `UnauthorizedException`, …
- async/await throughout; wrap multi-step DB operations in transactions

### Entities
- `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()`, `@CreateDateColumn()`, `@UpdateDateColumn()`
- snake_case column names (`@Column({ name: 'created_at' })`), camelCase properties
- Relationships: `@OneToMany()`, `@ManyToOne()`, `@ManyToMany()` with explicit `@JoinColumn()` / `@JoinTable()`
- `@Index()` where queries filter or sort by a column
- **Never mutate schema directly** — always generate and run a migration

### DTOs
- One file per DTO, `.dto.ts` suffix; class-validator decorators for every property
- `@ApiProperty()` from `@nestjs/swagger` on every property
- Request DTOs in `src/api/dtos/`; shared/internal DTOs in `src/feature/dtos/`
- `@Type()`, `@Exclude()` / `@Expose()` from class-transformer where needed

### Migrations
- Generate: `npm run migration:generate -- --name=<MigrationName>`
- Verify the generated SQL before committing — review for accidental destructive changes
- Never edit entities and skip migrations; the DB is the source of truth

### Error handling
- Use NestJS exceptions — never expose raw DB errors or stack traces
- Custom exceptions extend `HttpException` only when no built-in fits
- Log errors at service level; never log sensitive data

### Testing
- Unit tests for services: `feature-name.service.spec.ts`
- Mock dependencies with Jest; `Test.createTestingModule()` for NestJS context
- Cover happy paths, not-found cases, and validation failures

### File naming
- `feature-name.module.ts` / `.service.ts` / `.controller.ts` / `.entity.ts`
- DTOs: `create-feature.dto.ts`, `update-feature.dto.ts`, `feature-response.dto.ts`
- Tests: `feature-name.service.spec.ts`
- All kebab-case
