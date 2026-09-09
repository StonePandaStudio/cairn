<!-- cairn preset: tailwind — appended to the framework preset's
     implementation-reference slot on `--stack <framework>,tailwind`. -->

### Styling
- Tailwind v4 utilities in the markup; tokens from the `@theme` block
- Semantic tokens (`background`/`foreground`) in components; raw brand tokens only in `@theme`
- Responsive via breakpoint prefixes (`md:`, `lg:`); dark mode via `prefers-color-scheme` token re-mapping
- No `tailwind.config.ts`, no inline hex, no per-element `dark:` sprawl
