# CSS Modules Guidelines

<!-- cairn preset: css-modules. The styling add-on for apps that style with CSS Modules
     and CSS custom properties — orthogonal to the framework, the way `tailwind` is.
     Compose it: `--stack react,css-modules`. Seeded 2026-11-13 from one repo (a Vite
     React PWA with its own UI kit). Single consumer; refine when a second CSS Modules
     repo appears. An app uses this *or* `tailwind`, not both.

     Not in it: the repo's actual token values, palette, font choice, component list
     and breakpoints beyond the pattern. Those are project-owned. This preset says
     *where* tokens live, *how many tiers* there are, and *how components consume them*. -->

## Approach

* Native HTML elements + **CSS Modules** (`*.module.css`) for most components. CSS Modules ship with the bundler — no styling dependency.
* Headless primitives (e.g. Radix) only where hand-rolling accessibility is costly: dialogs, menus, popovers, tooltips, scroll areas. A plain button or input needs none.
* Every visual value is a CSS custom property. Components never contain "magic" colours, sizes or durations.

## Token tiers

Two global layers, in this order:

1. **Primitive tokens** (`tokens.css`) — the approved atomic scale: palette steps, size scale, radii, font weights, line heights, letter spacings. Named by what they are (`--color-slate-9`, `--size-16`).
2. **Semantic tokens** (`global.css`) — roles that point at primitives or at other semantic tokens: surface/content colours, typography roles, motion, stacking, shared shadows, shared geometry. Named by what they are *for* (`--color-surface-primary`, `--color-content-primary`). Every chain must end at a primitive and must not loop.

Both are declared on `:root` (light theme). Import them once, in the app entry, in a fixed order: **reset → tokens → global**.

**Primitives are a stable contract.** Do not add, remove or change a primitive as part of a feature task. If the work cannot be expressed with the existing scale, stop, explain why, and get explicit approval before touching it. A missing *role* is not a reason to change the scale — add a semantic token on top of existing primitives first.

Allowed literals in semantic tokens: transition and z-index values, composite shadows and font stacks that cannot be one primitive, and `0`.

## Private component tokens

A component's look-and-feel, state colours and customisable geometry live in **private tokens declared at the top of its own root class**, not in the global layer.

```css
.container {
  --checkbox-color-checked: var(--color-slate-12);
  --checkbox-color-hover: var(--color-slate-11);
  --checkbox-size: var(--size-16);

  display: flex;
  inline-size: var(--checkbox-size);
  background: var(--checkbox-color-checked);
}
```

Rules:

* The block of private tokens is the first thing in `.container`, followed by one blank line, then ordinary declarations.
* **Scope.** `.container` must sit on the DOM root of the component's style area (directly or through the wrapper's `className`). Every consumer of a private token must be that root or its DOM descendant. A portal subtree is *not* a descendant — declare the tokens again on the portal's own root.
* **Name** starts with the kebab-case owner name and describes the *role* inside the owner, not the source value: `--dropdown-menu-size-inline-min`, not `--dropdown-menu-size-192`. Add `primary` / `secondary` / `muted` only when the owner really has several such roles.
* Two different roles get two tokens even if their values currently match.
* **Source.** A colour role points at the nearest global semantic token (`--color-surface-primary`, `--color-content-*`). Base palette steps are allowed as a source when no global role exists (local hover / active / status / variant colours).
* Don't create a private token that only proxies a global size or contract — use the global one directly. Don't create a global token just to hide one primitive for a one-off use.
* Private tokens are not external API. Nothing outside the owner reads them.

### Size token grammar

`--<owner>-size-<role>-<axis>-<constraint>` — `axis` is `block` or `inline` (omit for square or axis-independent sizes: `--checkbox-size`); `constraint` is `min` or `max` when present. Example: `--screen-layout-size-content-inline-max`.

`inset` = distance of a positioned element from its containing block or viewport. `offset` = displacement from the original or semantic position (motion, optical correction). Ordinary spacing is named by its real role: `margin-*`, `padding-*`.

## Typography roles

A typography role is four semantic tokens (`font-size`, `font-weight`, `line-height`, `letter-spacing`) plus one class in a shared `Typography.module.css`. Components apply the whole role with composition:

```css
.title {
  composes: typographyScreenTitle from "@/uikit/Typography.module.css";
}
```

* Never assemble a full role from loose `font-*` / `line-height` / `letter-spacing` in a component.
* A new combination is first matched to an existing role. Only a reusable, self-standing combination earns new tokens and a new class.
* Local type properties are fine only for real exceptions: contextual inheritance, text whose size depends on geometry (an indicator glyph).
* Self-host the font (variable font if the languages need it) so the service worker can cache it for offline use.

## Layout and CSS conventions

* **Logical properties everywhere**: `margin-inline-start`, `padding-block-end`, `inline-size`, `block-size` — never `margin-left`, `width`. Enforce with Stylelint + `stylelint-use-logical` at severity `error`. Spacing uses `block` / `inline`, not `vertical` / `horizontal`.
* **Mobile-first**: base styles for small screens, widen with `min-width` media queries. Custom properties cannot be used in `@media` conditions, so breakpoint values are literals there; mirror them in a TS constants module for JS (`useMediaQuery`).
* **Class names are camelCase** (`.itemActive`). Set `css.modules.localsConvention: 'camelCaseOnly'` as a safety net.
* **`.container`** is the root class of every component. Internal parts, variants and states get semantic names.
* **State via attributes**, not extra classes, where the primitive provides them: `[data-state="checked"]`, `[data-disabled]`.
* One global `*:focus-visible` outline in `global.css`; a component with its own focus look overrides it through private tokens.
* A global `.srOnly` utility for screen-reader-only content.

## Theming

* Light is the default on `:root`. Dark is `[data-theme="dark"]`, which re-maps the **primitive** scales (and a few semantic tokens only when needed). Because semantic chains end at primitives, components switch theme without changing.
* Set `data-theme` on `<html>`. Initial theme: saved choice → `prefers-color-scheme` → `light`.
* Read the saved choice **synchronously** (inline script in `index.html`, usually from `localStorage`) before styles load, to avoid a flash of the wrong theme. This is the one place browser storage is justified — an async store cannot meet the requirement.
* Data-defined colours (user-chosen badge colours) are deliberately theme-independent. Use fixed private literals for what sits on top of them (a contrast checkmark) and do not replace those with theme tokens.

## UI kit

* Generic components with no domain logic live in a single `uikit/` folder; domain components live at the root of their domain folder. App-shell layouts and shared hooks go in `core/`.
* One folder per component: `Button/index.tsx` + `Button.module.css`.
* Use the existing UI kit first. When it does not fit, ask which way to go — use it as is and adapt the usage, deviate, add a component, or change the existing one — before inventing a local variant.
* Keep a dev-only showcase route that renders every generic component and state, compiled out of production builds.

## Verification

* Run `stylelint` over `src/**/*.css` and the type checker with the usual lint. Passing lint does not prove a visual change — open the screen and check it in both themes (accessibility tree and DOM state are the primary evidence; screenshots are supplementary).
