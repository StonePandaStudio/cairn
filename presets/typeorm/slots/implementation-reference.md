<!-- cairn preset: typeorm — appended to presets/nestjs/slots/implementation-reference.md
     on `--stack nestjs,typeorm`. -->

### Entities
- `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()`, `@CreateDateColumn()`, `@UpdateDateColumn()`
- snake_case column names (`@Column({ name: 'created_at' })`), camelCase properties
- Relationships: `@OneToMany()`, `@ManyToOne()`, `@ManyToMany()` with explicit `@JoinColumn()` / `@JoinTable()`
- `@Index()` where queries filter or sort by a column
- **Never mutate schema directly** — always generate and run a migration

### Repositories & transactions
- Inject repositories via `@InjectRepository(Entity)`
- Wrap multi-step DB operations in a transaction (`queryRunner.startTransaction()`)
- Complex reads go through a query builder in a `queries/` file, not inline in the service

### Migrations
- Generate: `npm run migration:generate -- --name=<MigrationName>`
- Verify the generated SQL before committing — review for accidental destructive changes
- The DB is the source of truth; never edit entities and skip the migration
