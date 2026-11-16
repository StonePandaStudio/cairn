---
description: Set up the current repo with cairn (init, scaffold ai/, docs, MCP registration)
---

# cairn-init

First install of cairn in the repo you are in. Arguments from the user, if any: $ARGUMENTS

## Procedure

1. **Check the folder.** It should be the root of a git repo. If `cairn.config.json` already exists, stop: this repo is set up already. Suggest `cairn-sync` (merge preset changes) or `cairn-upgrade` (update cairn itself).
2. **Look before asking.** Read what tells you the stack, and propose it:
   - `package.json` dependencies: `@nestjs/*` → `nestjs`, `fastify` → `fastify`, `next` → `nextjs` (plus `react`), `react` → `react`, `@angular/core` → `angular`; ORMs `typeorm`, `drizzle-orm`, `prisma`/`@prisma/client`; `tailwindcss` → `tailwind`.
   - `build.gradle(.kts)` / `pom.xml` with Spring → `spring`; Hibernate or Flyway → `jpa-flyway`.
   - `docker-compose*.yml` → `docker`.
   - A docs folder (`docs`, `doc`, `docum`, `documentation`, `wiki`, `adr`).
   The stack is framework first, then add-ons. Valid names: run `npx cairn preset list`. Use `unknown` for no stack.
3. **Ask once, with your proposal:** the agent hosts (`claude`, `codex`, or both), the stack, the issue tracker (`jira-server`, `youtrack` or `none`; with a project key unless `none`), whether the repo belongs to a workspace of several repos (then run `cairn-workspace` afterwards), and whether to list the docs folder you found.
4. **Preview.** `npx cairn init --repo . --stack <a,b> --host <claude,codex> --tracker <provider> [--project-key <KEY>] --render --dry-run`. Add `--validation-stack zod|class-validator` for a NestJS stack when the user cares. Show the output.
5. **Run it** without `--dry-run` once the user agrees.
6. **Docs (only if the user said yes).** `npx cairn docs add <folder>`, then `npx cairn sync`, which carries the Project docs table into `ai/AGENTS.md`. (`/discover` can also pick the docs later.)
7. **MCP server.** `npx cairn context register` so the agent hosts can call cairn. Offer `cairn-tools` for the code lookup tools; it downloads a language server and takes minutes, so do not run it unasked.
8. **Tell the user the next step:** install cairn as a dev dependency if it is not one yet, review `git status` and commit, then run the `/discover` workflow command to draft the project contexts.

{{common}}
