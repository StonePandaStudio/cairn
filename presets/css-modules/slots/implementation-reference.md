<!-- cairn preset: css-modules — appended to the framework preset's
     implementation-reference slot on `--stack <framework>,css-modules`. -->

### Styling
- `Component/index.tsx` + `Component.module.css`; root class is `.container`, applied to the DOM root
- Private tokens first in `.container`, named `--<owner>-<role>`; consume tokens via `var(--…)`, no literals
- Colour roles → nearest global semantic token; palette steps only when no global role exists
- Never edit primitives (`tokens.css`) in a feature task — stop and ask
- Whole typography role via `composes: … from "…/Typography.module.css"`
- Logical properties only (`inline-size`, `padding-block`); mobile-first `min-width` media queries
- camelCase class names; state via `data-*` attributes
- Reuse the UI kit before adding anything; verify in light and dark
