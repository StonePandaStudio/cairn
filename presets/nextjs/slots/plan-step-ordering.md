<!-- cairn preset: nextjs — fills {{> stack/plan-step-ordering }} in the core
     architect's Plan format. Primary-stack-only. Put `nextjs` first in `--stack`
     so this fullstack ordering wins over the plain-react one. -->
1. Types / schema / DB migration
2. Server modules — queries, integrations, `lib/` helpers
3. Server Actions / Route Handlers
4. Server Components — pages, layouts, data loading
5. Client islands — interactive components
6. Styling and responsive / dark-mode passes
7. Tests — Vitest units, then a Playwright flow
8. Context doc updates
