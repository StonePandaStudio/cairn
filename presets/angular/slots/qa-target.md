<!-- cairn preset: angular — fills {{> stack/qa-target }} (qa-architect P.1). Target = a component or page. -->
The target is a **component, page or feature area**, given as a path
(e.g. `src/app/sites/sites.component.ts`); `[target]` in file names is that file's
name without extension.

- Verify the path exists. If not, stop: "Target not found at `<path>`."
- If it is a routed page, find its route definition to confirm the URL.
- A path that names a whole feature area with several unrelated pages is ambiguous:
  stop and ask which component or flow to cover.
