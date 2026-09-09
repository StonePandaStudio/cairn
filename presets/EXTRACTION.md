# Extraction record

What was pulled into `presets/`, from where, and — more importantly — what was
deliberately left in the repos. Measured 2026-08-01 by splitting each
`code-guidelines.md` on `## ` headings and running cairn's own line differ over
matching sections.

The file-level numbers in `DESIGN.md` (backend 43% same, frontend 76%) turned out
to be the wrong resolution. Per section the picture is much sharper.

## Backend — glossr-api (828 ln) vs snap-backend (404 ln)

| Section | Same | Disposition |
|---|---|---|
| General TypeScript Guidelines | 100% | → `nestjs` |
| NestJS Module Structure | 100% | → `nestjs` |
| Services | 100% | → `nestjs` |
| Error Handling | 100% | → `nestjs` |
| Security | 100% | → `nestjs` |
| Constants | 100% | → `nestjs` |
| Enums | 100% | → `nestjs` |
| Code Quality | 100% | → `nestjs` |
| File Organization | 93% | → `nestjs` (union; glossr's `interfaces/` kept) |
| File Naming Conventions | 80% | → `nestjs`, DTO lines to `dto-naming` slot |
| TypeORM Entities | 100% | → `typeorm` |
| Database Query Decomposition Pattern | 100% | → `typeorm` |
| Mappers | 100% | → `typeorm` — **but see finding 1** |
| Database Operations | 85% | → `typeorm` (glossr's stronger wording) |
| Query Configuration | 75% | → `typeorm` (glossr is a strict superset) |
| Validation | 43% | spine → `nestjs`, rest → `validation-stack` slot |
| DTOs | 28% | spine → `nestjs`, rest → `dto-definition` slot |
| Controllers | 16% | spine → `nestjs`, rest → `controller-response` slot |
| Response Transformation | disjoint | entirely `response-transformation` slot |
| **Testing** | **7%** | **stays project-owned** |
| Interfaces, Error Codes, No Magic Strings, Pagination | glossr only | → `nestjs` (promoted, generic) |
| QueryBuilder Field Selection, Migrations | glossr only | → `typeorm` (promoted, generic) |
| Redis Key Naming | glossr only | **stays project-owned** — names a specific app prefix |

### The backend divergence is one axis, not entropy

Controllers 16%, DTOs 28%, Validation 43% and the two mutually exclusive Response
Transformation sections are all the same disagreement:

```
glossr-api    Zod          nestjs-zod, createZodDto, @ZodResponse
snap-backend  class-*      class-validator, class-transformer, @ResponseMapper
```

That is a **choice with two known values**, not accumulated rot — so it is a slot
with two variants, not a reason to fork the file. The file-level 43% reading
suggested "leave it alone"; the section-level reading says most of the document is
shareable and one decision is not.

## Frontend — glossr-frontend (231 ln) vs snap-frontend (191 ln)

| Section | Same | Disposition |
|---|---|---|
| Preamble (Angular rules) | 100% | → `angular` |
| Theming and Colors (+ 4 subsections, 94 ln) | 100% | → `angular` |
| Component Selectors | 100% | → `angular` |
| Constants | 100% | → `angular` |
| Enums | 100% | → `angular` |
| Translation Key Naming / Examples | 100% | → `angular` |
| Translations — sourcing | 48% | → `translation-source` slot |
| Change detection, Comments | snap only | → `angular` (promoted, generic) |

Cleaner than the backend: after the sourcing slot is carved out, essentially the
whole document is shared.

## CLI — glossr-cli (203 ln)

Not extracted. It shares no section headings with either pair, and per
`DESIGN.md` it is a stack of one, so nothing can be measured against it. A
`presets/cli/` should wait for a second CLI repo or a deliberate hand-authored
decision — not be reverse-engineered from a sample of one.

## Deliberately not extracted

- **Testing (7% same).** Two genuinely different regimes: glossr keeps all tests
  under `test/` with integration helpers and factories; snap colocates `.spec.ts`
  and targets >80% coverage. Extracting this would force one project onto the
  other's layout.
- **Redis Key Naming.** Correct guidance, but it hardcodes `REDIS_APP_PREFIX =
  'glossr'`. Generalising it would leave a rule with no concrete value in it.
- **`code-guidelines.md` as a whole remains `fork` mode** per `DESIGN.md`. These
  presets are seeds. A repo that takes one owns its copy; cairn does not plan to
  rewrite these files on upgrade.

## Findings

Two things surfaced only because the content was read section by section.

### 1. glossr-api's Mappers section documents a decorator it does not have

The section is byte-identical to snap-backend's and says:

> Basic entity-to-DTO conversion (use `@ResponseMapper` decorator)

`grep -rl ResponseMapper glossr-api/src` returns **nothing**. glossr moved to Zod;
the Mappers section was copied and never updated. It has been instructing agents to
reach for a decorator that does not exist in that codebase.

**A 100%-identical section is not automatically a correct one.** Identical means
"nobody has diverged", which includes "nobody has noticed". The preset version now
points at the response-transformation slot instead of naming a decorator.

### 2. Stale line-number cross-references

`glossr-api` contains *"See **Query Configuration** section below (lines 232-325)"*
— the section actually starts at line 323. Both repos contain *"Create Maps for O(1)
lookup (per guideline line 122)"*. Line numbers in a document that gets edited are
wrong the moment it is edited. Replaced with section-name references.

Also fixed in passing, present identically in both frontend repos: the typos
`cosntants` and `inrastructure`. Identical typos across two repos are the clearest
possible proof of copy-paste, and are a decent cheap signal for finding more.

## Not wired up yet

There is no renderer. Nothing consumes `{{> slot: … }}`, and no repo is reading
these files. They are the input for roadmap step 2 (`DESIGN.md`, "Multi-repo
projects"), and are already useful in the meantime as the canonical version of
guidance that currently exists in two drifting copies.
