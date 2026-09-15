**Query params** — declare `page` and `pageSize` with `@Type(() => Number)` so query strings coerce:

```typescript
export class FooListQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}
```

**Response DTO** — expose the envelope fields and type the items:

```typescript
export class FooListResponse {
  @Expose() @Type(() => FooResponse) items: FooResponse[];
  @Expose() total: number;
  @Expose() skip: number;
  @Expose() take: number;
}
```
