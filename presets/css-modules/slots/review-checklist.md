<!-- cairn preset: css-modules — appended to the framework preset's review-checklist
     slot on `--stack <framework>,css-modules`. -->

| No literal colours, sizes or durations in a component stylesheet — only `var(--…)` tokens (documented literals aside) | `*.module.css` |
| Primitive token file untouched, or the change was explicitly approved | `tokens.css` |
| Private tokens declared first in `.container`, named `--<owner>-<role>` for the role (not the source value), each consumer inside the root's DOM subtree | `*.module.css` |
| No private token that only proxies a global token; no global token made for a one-off | `*.module.css` / `global.css` |
| Full typography role via `composes`, not assembled from loose `font-*` properties | `*.module.css` |
| Logical properties only (`inline-size`, `margin-inline-start`) — no `left` / `width` / `margin-top` style physical ones | `*.module.css` |
| Mobile-first `min-width` queries; breakpoint literals match the shared constants | `*.module.css` |
| Root class is `.container`; camelCase class names; states via `data-*` attributes where available | `*.module.css`, `.tsx` |
| Portal content declares its own private tokens on its own root | Dialog / popover styles |
| Existing UI kit component used before a new one; no domain logic in the UI kit | `.tsx` |
| Change checked in both light and dark themes | PR notes |
