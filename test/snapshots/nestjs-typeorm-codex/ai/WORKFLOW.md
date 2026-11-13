# Task Workflow

A task lives in `ai/tasks/[KEY]/` as a set of step files:

| File | Written by |
|---|---|
| `brief-step-[N].md` | you — the raw ask, never modified after creation |
| `description-step-[N].md` | NestjsArchitectAgent (Mode A) — the enriched brief |
| `plan-step-[N].md` | NestjsArchitectAgent (Mode B) — the implementation plan |
| `review-step-[N].md` | NestjsReviewerAgent — overwritten on each re-review |
| `test-plan-[target].md` | NestjsQAArchitectAgent — only for the QA pipeline on existing code |
`[KEY]` is the task folder name. Speculative or un-tracked work uses a `LOCAL-`
prefix so a folder name can never collide with a real issue key.

## No remote tracker

`tracker.provider` is `none` — the workflow steps that would sync are no-ops. A task
is exactly its `ai/tasks/[KEY]/` folder; there is nothing else to update. Pick any
stable `[KEY]` scheme (a sequential id, a sprint slug) and keep it consistent.
