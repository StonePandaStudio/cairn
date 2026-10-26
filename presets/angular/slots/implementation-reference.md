<!-- cairn preset: angular — fills {{> stack/implementation-reference }} in the core
     developer. snap-proof/frontend/ai/agents/angular-developer.md has no block like
     the nestjs one — it points at patterns.md + code-guidelines.md and stops.
     This is a minimal synthesis from angular-developer + angular-reviewer; extend
     it when a second Angular repo shows what is actually shared. -->

The authoritative source is `ai/infrastructure/code-guidelines.md`; the base-class
and header-flow catalogue is `ai/infrastructure/patterns.md`. Reminders:

### Components
- Standalone components — no `NgModule` declarations block
- No `app-` prefix in the selector
- Match the change-detection strategy of nearby components
- Subscriptions collected in a `Subscription`, unsubscribed in `ngOnDestroy`
- Complex data manipulation goes in a `utils/` file, not inlined

### Templates
- Control flow: `@if` / `@for` / `@switch` — never `*ngIf` / `*ngFor`
- Every `@for` carries a `track` expression
- Every static string is a translation key — no bare literals

### Styles
- Only `theme.$variable` from `@use "themes/theme" as theme` — no `#hex`, `rgb()`, or CSS custom properties

### Forms
- Reactive forms only — no `ngModel`

### Files
- Models, enums, constants, and mapper functions each in their own kebab-case file
- `enums/`, `constants/`, `mappers/` folders per module
- Mapper shapes: `EntityResponse → Entity`, `Entity ↔ EntityForm`, `Entity → EntityPayload`

### Build
- Use the **production** build for the E.5 check, not a dev build
