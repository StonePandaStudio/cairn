# Code Guidelines

<!-- cairn preset: angular -->

* In angular templates use new template syntax instead of old `*ng` syntax.
* Unsubscribe from observables in `ngOnDestroy`
* Use standalone Angular components by default, refactor component to standalone if it's not standalone component
* Every utility function, model, constant or mapping function should stay in separated file.
* For file names use dash-case (Example: `my-long-module.module.ts`)
* Use Reactive Forms for any new forms.
* All data access is handled through dedicated services.
* Complex data manipulation is placed in utils files

## Theming and Colors

The application uses a CSS variables-based theming system with the following architecture:

**Chain**: Global CSS Variables → SCSS Palette Variables → Abstract SCSS Variables → Component `.scss` files

### Architecture Layers

1. **Global CSS Variables** (`src/scss/themes/default/colors.scss`)
   - Defines actual color values as CSS custom properties
   - Example: `--fotofixer-color-primary: #00aabc;`
   - Changing these allows dynamic theme switching without page refresh

2. **SCSS Palette Variables** (`src/scss/themes/colors.scss`)
   - Maps CSS variables to SCSS variables using `var()` function
   - Example: `$fotofixer-color-primary: var(--fotofixer-color-primary);`
   - **DO NOT import this file directly in component SCSS**

3. **Abstract SCSS Variables** (`src/scss/themes/theme.scss`)
   - Provides semantic/abstract names for colors
   - Example: `$font-color-secondary: colors.$main-color-main-10;`
   - **This is the only file you should import in component SCSS files**

### Rules for Using Colors in SCSS Files

* **DO NOT** use hardcoded colors (e.g., `#ffffff`, `white`, `rgb(...)`)
* **DO NOT** use CSS variables directly (e.g., `var(--main-color-main-11)`)
* **DO NOT** import `colors.scss` directly
* **DO** import `theme.scss` using `@use` directive
* **DO** use abstract SCSS variables from `theme.scss`
* **DO** add new abstract variables to `theme.scss` if needed

### Example Usage

```scss
@use "themes/theme" as theme;

.my-component {
  background-color: theme.$background-color-white;
  border: 1px solid theme.$border-color-secondary;
  color: theme.$font-color;

  .secondary-text {
    color: theme.$font-color-secondary;
  }

  .muted-text {
    color: theme.$font-color-muted;
  }

  .primary-action {
    background-color: theme.$fotofixer-color-primary;

    &:hover {
      background-color: theme.$fotofixer-color-hover;
    }
  }
}
```

### Available Abstract Variables (from `theme.scss`)

**Primary Colors:**
- `$fotofixer-color-primary` - Main brand color (cyan)
- `$fotofixer-color-secondary` - Light brand color
- `$fotofixer-color-tetriary` - Very light brand color
- `$fotofixer-color-hover` - Brand hover state

**Background Colors:**
- `$background-color-main` - Main background (light gray)
- `$background-color-secondary` - Secondary background
- `$background-color-secondary-hover` - Secondary hover state
- `$background-color-white` - White background

**Font Colors:**
- `$font-color` - Main text color (black)
- `$font-color-navbar` - Navbar text
- `$font-color-secondary` - Secondary text (dark gray)
- `$font-color-muted` - Muted/disabled text (medium gray)
- `$invert-font-color` - Inverted text (white)

**Border Colors:**
- `$border-color` - Main border color
- `$border-color-secondary` - Secondary border (light gray)
- `$divider-color` - Divider lines (very light gray)

**Message Colors:**
- `$error-message-color` - Error text
- `$error-message-background-color` - Error background
- `$success-message-color` - Success text

**Other:**
- `$disabled-color` - Disabled state
- `$link-hover-color` - Link hover state

## Component Selectors

* Do NOT use `app-` prefix for component selectors in new components
* Use descriptive, kebab-case selector names (Example: `popover`, `project-status-icon`, `connected-projects-popover`)
* Selector should match the component's purpose without generic prefixes

## Translations and Internationalization

### General Rules

* Always use translation keys for static text in templates.
* For dynamic text in templates use translation keys when possible. If not possible, add a comment explaining why.
* **Locale files are generated artifacts.** Never hand-edit them and never add a key to one to make a feature render — any manual change is destroyed by the next sync.

Where translations come from, and how new keys are submitted, is project-specific:

{{> slot: translation-source }}

### Translation Key Naming Conventions

* Use PascalCase for naming translation keys.
* Key structure depends on context:
  * **Common text (no specific context)**: Use 2 parts - `"Common.SaveButton"`, `"Common.CancelButton"`
  * **Context-specific text**: Use nested structure - `"[PageName].[Subcontext].[TextDescription]"`

### Examples

**Common keys:**
```json
"Common": {
  "SaveButton": "Save",
  "CancelButton": "Cancel",
  "Loading": "Loading..."
}
```

**Page-specific keys:**
```json
"DevicesTable": {
  "Title": "Devices Table",
  "Header": {
    "CityColumn": "City",
    "DeviceColumn": "Device"
  },
  "Button": {
    "DownloadReport": "Download Report"
  }
}
```

**Message keys:**
```json
"Messages": {
  "Devices": {
    "FailedLoadDevices": "Failed to load devices",
    "FailedDownloadReport": "Failed to download report"
  }
}
```

### Checking Existing Keys

Before creating new translation keys, check the existing English locale file for examples and to avoid duplication. Read it only — see the generated-artifact rule above.

## Change detection

* **Match the strategy used by nearby/similar components.** The codebase mixes `Default` and `OnPush`; don't default to `OnPush` unless the surrounding components use it. Most page-level components currently use `ChangeDetectionStrategy.Default`.
* If you're adding a component to an area where everything is `Default`, use `Default`. If you're adding one next to `OnPush` components, use `OnPush`.
* Don't "upgrade" an existing component from `Default` to `OnPush` as a drive-by change — that's a focused refactor, not part of a feature plan.

## Comments

* **Default to no comments.** Good names carry meaning; small functions are self-documenting.
* Only write a comment when the *why* is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, behavior that would surprise a reader.
* Don't explain *what* the code does — identifiers and structure already do that.
* Don't reference task IDs, PR flows, or "added for feature X" in code comments — that context belongs in commit messages and PR descriptions, and rots as the codebase evolves.
* No multi-paragraph docstrings or multi-line comment blocks — one short line is the ceiling.

## Constants

File name template: `xx-yy.constant.ts` for `XxYy` constant

Files with constants should be placed in the `constants/` folder within the corresponding module (see `ai/infrastructure/project-structure.md` for module details)

## Enums

File name template: `xx-yy.enum.ts` for `XxYy` enum

Files with enums should be placed in the `enums/` folder within the corresponding module (see `ai/infrastructure/project-structure.md` for module details)
