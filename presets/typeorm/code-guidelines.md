# TypeORM Guidelines

<!-- cairn preset: typeorm. Composes onto presets/nestjs. A backend on a different
     ORM takes presets/nestjs without this file. -->

## TypeORM Entities

* Use snake_case for database column names: `@Column({ name: 'created_at' })`
* Use camelCase for entity property names: `createdAt`
* Always define primary key with `@PrimaryGeneratedColumn()`
* Use timestamp columns: `@CreateDateColumn()`, `@UpdateDateColumn()`
* Define relationships properly: `@OneToMany()`, `@ManyToOne()`, `@ManyToMany()`
* Add indices for frequently queried columns: `@Index()`
* Set cascade options carefully - avoid unintended deletions
* Use entity listeners when needed: `@BeforeInsert()`, `@BeforeUpdate()`

## Database Operations

**⚠️ MANDATORY RULE**: See the **Query Configuration** section below — this is NOT optional.

* Use repository pattern with `@InjectRepository(EntityName)`
* Use query builders for complex queries
* Optimize queries with proper joins and select statements
* Use transactions for multi-step operations: `queryRunner.startTransaction()`
* Handle concurrent updates with optimistic/pessimistic locking
* Be aware of N+1 query problems - use eager loading or joins
* Update database schema via migrations only
* Follow naming conventions for tables and columns in migrations
* Update `ai/infrastructure/DATABASE_SCHEMA.md` accordingly after schema changes
* Avoid loading unnecessary data - select only required fields
* Always decompose queries with one-to-many relationships
* Relationship one-to-one can be loaded in same query
* Store loaded entities in maps (id -> entity) to avoid duplicate loads
* Prefer to use TypeORM `.find` and `findOne` methods over query builder when possible
* Store IDs of related entities instead of full entities when possible to reduce memory usage
* **MUST extract query configurations to separate files in `queries/` folder** — see **Query Configuration** below

## Query Configuration

**⚠️ MANDATORY RULE**: Extract TypeORM query configurations into separate files in the `queries/` folder within feature modules. This is NOT optional.

**When to extract (ALWAYS)**:
* ✅ Any `FindManyOptions<Entity>` or `FindOneOptions<Entity>` with relations, select, or complex where clauses
* ✅ Any query configuration longer than 3-4 lines
* ✅ Any query that filters by multiple conditions
* ✅ Any query that loads related entities (one-to-one or joins)
* ✅ Any query that is or might be reused in multiple methods

**What NOT to extract**:
* ❌ Very simple queries like `{ where: { id, companyId } }` (can stay inline if truly minimal)
* ❌ One-off queries with no filtering (but prefer extraction for consistency)

**Benefits**:
* Reusable query configurations
* Easier to test and maintain
* Keeps service methods clean and focused
* Centralizes query optimization
* Makes query logic explicit and documented

**Naming Convention** (STRICT):
* File: `get-[entity]-by-[criteria].query.ts`
* Constant: `GET_[ENTITY]_BY_[CRITERIA]_QUERY`
* Example: `get-devices-by-projects.query.ts` exports `GET_DEVICES_BY_PROJECTS_QUERY`

**Structure**:
```typescript
// src/feature/siteDevices/queries/get-devices-by-projects.query.ts
import { FindManyOptions, In } from 'typeorm';
import { SiteDeviceEntity } from '@feature/siteDevices/entities/site-device.entity';
import { WithCompanyId } from '@common/types/with-company-id.interface';

interface GetDevicesByProjectsQueryProps extends WithCompanyId {
  deviceIds?: string[];
  city?: string;
}

export const GET_DEVICES_BY_PROJECTS_QUERY = ({
  companyId,
  deviceIds,
  city,
}: GetDevicesByProjectsQueryProps): FindManyOptions<SiteDeviceEntity> => ({
  where: {
    companyId,
    ...(deviceIds && deviceIds.length > 0 ? { id: In(deviceIds) } : {}),
    ...(city ? { site: { city: { name: ILike(`%${city}%`) } } } : {}),
  },
  relations: {
    site: { city: true },
    equipmentType: { icon: true },
  },
  select: {
    id: true,
    description: true,
    site: {
      id: true,
      name: true,
      address: true,
      city: { name: true },
    },
    equipmentType: {
      name: true,
      icon: { id: true, url: true },
    },
  },
});
```

**Usage in Service**:
```typescript
// ✅ Correct - use extracted query
import { GET_DEVICES_BY_PROJECTS_QUERY } from './queries/get-devices-by-projects.query';

async getDevicesByProjects(companyId: string, filters: FilterDto) {
  return this.repository.find(
    GET_DEVICES_BY_PROJECTS_QUERY({
      companyId,
      deviceIds: filters.deviceIds,
      city: filters.city,
    })
  );
}

// ❌ Incorrect - inline query configuration
async getDevicesByProjects(companyId: string, filters: FilterDto) {
  return this.repository.find({
    where: { companyId, ... },  // Don't define queries inline
    relations: { ... },
    select: { ... },
  });
}
```

**Common Mistakes to Avoid** (VIOLATIONS REQUIRE REWORK):
* ❌ DON'T inline any query with relations: `relations: { site: { city: true } }` in service code
* ❌ DON'T inline any query with select statements: `select: { id: true, name: true, ... }` in service code
* ❌ DON'T inline any query with complex where clauses in service code
* ❌ DON'T create long query configs (>3-4 lines) anywhere except in `queries/` files
* ✅ DO extract to `queries/` folder and import as a constant
* ✅ DO use extracted queries consistently across all service methods
* ✅ DO name extracted queries with the `GET_*_QUERY` pattern

**Pre-Implementation Checklist**:
1. Before writing a service method with database queries, plan the query extractions
2. Identify all `find()`, `findOne()` calls that need query configs
3. Create query files for each unique configuration
4. Import and use the extracted query constants
5. Never write inline queries with relations/select in service methods

## QueryBuilder Field Selection

**⚠️ MANDATORY**: When using `createQueryBuilder`, always select only the fields needed — never rely on the default `SELECT *` behavior.

### Why it matters

`leftJoinAndSelect('tk.namespace', 'namespace')` selects **every column** of the joined entity. On a namespace with 8 columns when you need only 3, you transfer 5 useless columns per row — multiplied by every key in the list. At scale this wastes network bandwidth, DB I/O, and memory.

### Rules

**Main entity** — replace the implicit `SELECT *` with an explicit `.select([...])`:
```typescript
// ❌ Fetches all 8 columns of translation_keys including deleted_at
.createQueryBuilder('tk')

// ✅ Fetches only what the serializer actually uses
.createQueryBuilder('tk')
.select(['tk.id', 'tk.projectId', 'tk.key', 'tk.description', 'tk.namespaceId', 'tk.createdAt'])
```

**Joined relations** — use `leftJoin` + `addSelect([...])` instead of `leftJoinAndSelect` when you don't need all columns:
```typescript
// ❌ Fetches all 8 namespace columns
.leftJoinAndSelect('tk.namespace', 'namespace')

// ✅ Fetches only the 3 columns used in the response
.leftJoin('tk.namespace', 'namespace')
.addSelect(['namespace.id', 'namespace.name', 'namespace.color'])
```

**Exception** — `leftJoinAndSelect` is acceptable only when the joined entity has ≤ 4 columns total and all are needed (e.g., a tag table with `id`, `translationKeyId`, `tag`).

### Full example
```typescript
const qb = this.translationKeyRepository
  .createQueryBuilder('tk')
  .select(['tk.id', 'tk.projectId', 'tk.key', 'tk.description', 'tk.namespaceId', 'tk.createdAt'])
  .leftJoin('tk.namespace', 'namespace')
  .addSelect(['namespace.id', 'namespace.name', 'namespace.color'])
  .leftJoinAndSelect('tk.tags', 'tags')  // tags has only 3 cols — acceptable
  .where('tk.projectId = :projectId', { projectId })
  .andWhere('tk.companyId = :companyId', { companyId });
```

### Checklist before writing a QueryBuilder query
1. List every field that the serializer/response DTO actually reads
2. Add `.select([...])` with only those fields on the main entity
3. For each joined relation, count its columns — if > 4 or not all needed, use `leftJoin` + `addSelect`
4. Never use `leftJoinAndSelect` on entities with many columns (namespaces, projects, users, companies)

## Database Query Decomposition Pattern

**IMPORTANT**: Always decompose queries with one-to-many or many-to-many relationships into separate queries.

**Why**:
- Avoids Cartesian products from JOINs
- Reduces data duplication over the wire
- Better performance for large datasets
- More explicit control over loaded data

**Pattern**:
1. Load primary entities with only one-to-one relations
2. Extract unique IDs for related entities
3. Load related entities in batch queries (using `In()` operator)
4. Create Maps for O(1) lookup — see the map rule in **Database Operations**
5. Attach related entities to primary entities in memory

**Example**:
```typescript
// Step 1: Load devices with only image (one-to-one)
const devices = await this.deviceRepository.find({
  where: { companyId },
  relations: { image: true },  // ✅ One-to-one OK
  select: { id: true, siteId: true, equipmentTypeId: true, ... }
});

// Step 2: Extract unique IDs
const siteIds = [...new Set(devices.map(d => d.siteId).filter(Boolean))];
const equipmentTypeIds = [...new Set(devices.map(d => d.equipmentTypeId).filter(Boolean))];

// Step 3: Load related entities in batch
const sites = await this.siteRepository.find({
  where: { id: In(siteIds) },
  select: { id: true, name: true, cityId: true }
});

const equipmentTypes = await this.equipmentTypeRepository.find({
  where: { id: In(equipmentTypeIds) },
  relations: { icon: true },  // ✅ One-to-one OK
});

// Step 4: Create lookup maps (O(1) access)
const siteMap = new Map(sites.map(s => [s.id, s]));
const equipmentTypeMap = new Map(equipmentTypes.map(e => [e.id, e]));

// Step 5: Attach in memory
return devices.map(device => ({
  ...device,
  site: device.siteId ? siteMap.get(device.siteId) : null,
  equipmentType: device.equipmentTypeId ? equipmentTypeMap.get(device.equipmentTypeId) : null,
}));
```

**When to use this pattern**:
- ✅ Loading entities with one-to-many relations (e.g., devices → sites)
- ✅ Loading entities with many-to-many relations (e.g., devices ↔ projects)
- ✅ When same related entity appears multiple times (sites, cities)
- ✅ When related entities need their own related entities (site → city → province)

**When NOT to use this pattern**:
- ❌ Simple one-to-one relations (use `relations` in single query)
- ❌ Loading single entity by ID
- ❌ Very small datasets (< 10 records)

## Migrations

> **⚠️ CRITICAL — read before touching any migration file.**
> TypeORM runs migrations in ascending timestamp order. A wrong timestamp silently runs a migration out of sequence, corrupting the schema. This has happened in production. Do not repeat it.

### File naming

```
{timestamp}-{PascalCaseName}.ts
```

- **`{timestamp}`** — 13-digit Unix millisecond timestamp captured **at the exact moment the file is created**. Run `Date.now()` in a Node REPL or browser console and copy that value verbatim. Examples of acceptable timestamps: `1749481200000`, `1749523417382`.
- **`{PascalCaseName}`** — short, descriptive, PascalCase description of what the migration does.

**Anti-patterns that are strictly forbidden**:
- ❌ Round numbers with trailing zeros: `1780700000000`, `1780600000000` — these are fake timestamps, not real `Date.now()` values
- ❌ Hand-crafting a timestamp to slot between two existing ones (e.g. setting it to `existingTimestamp - 8` to force ordering)
- ❌ Copying a timestamp from a plan doc, a chat message, or another migration file
- ❌ Guessing or estimating the current time

**Correct examples**:
```
1749481200000-AddStripePriceId.ts
1749512863741-AddInvoicesTable.ts
1749523417382-SubscriptionModelRework.ts
```

### Ordering guarantee

If migration B depends on migration A (e.g. B drops a column A created), A's timestamp **must** be lower than B's. Because timestamps are generated at creation time, the natural order of development guarantees this — as long as you always use real `Date.now()` values. If you fabricate timestamps, you lose this guarantee.

### In plan / description documents

Never hardcode a specific timestamp in plan or description files. Write the placeholder instead:

```
{TIMESTAMP}-MigrationName.ts
```

Include a note alongside: *"Replace `{TIMESTAMP}` with the output of `Date.now()` at the moment you create the file."*

This prevents developers from copying a stale or fabricated timestamp out of a plan doc.

### Generation

TypeORM CLI generates a real timestamp automatically:

```bash
npm run migration:generate -- src/database/migrations/MigrationName
```

For hand-written migrations: create the file manually, but get the timestamp from `Date.now()` at that moment — never invent one.

## Mappers

**When to use mappers**:
* Complex business logic transformations that go beyond simple field picking
* Data format conversions (e.g., string to Date, unit conversions)
* Aggregating data from multiple sources
* Complex nested structure transformations

**When NOT to use mappers**:
* Simple field selection — the response layer already does this
* Basic entity-to-DTO conversion — see **Response Transformation** in the nestjs preset
* Picking a subset of fields

Place mapping functions in `mappers/` folder only when truly needed for complex transformations beyond what the response layer provides.
