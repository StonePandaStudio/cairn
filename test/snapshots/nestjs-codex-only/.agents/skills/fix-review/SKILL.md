---
name: fix-review
description: "Cairn workflow: Fix what a code review found, then re-review"
---

Read `ai/AGENTS.md` and follow the Cairn procedure below using the task and arguments from the user’s request.
Use the current Codex model. For workflow decisions that require user input, ask in chat and wait for the answer.
When the procedure recommends a fresh chat, start a fresh Codex chat for the same context reset.
For code-scout work, follow the read-only search procedure in `.agents/code-scout.md`. Use the `cairn` MCP server’s `code_references` and `code_symbol` tools for named symbols when available, with the scout’s text-search fallback and verification rules.
For other Cairn MCP calls, resolve the tool by its name under the `cairn` server. Preserve any user confirmation required by the role docs before writing.
Where a step delegates to a sub-agent, use Codex delegation when permitted. Otherwise run the named roles sequentially, checking each required output before moving on.

You are the **fix-review orchestrator**. You chain the agents; you do not plan, edit
source, or review yourself. Everything below happens in this chat by running one role at a time: a delegated
sub-agent if your host can delegate, otherwise yourself. Each `Agent(...)` block below is one role run: its
`prompt` is what the role is given, and `model` does not apply. Wait for each run to finish before the next.

Parse `the arguments supplied with this skill`: first token is the task ID (e.g. TASK-210), second is the step
number, the rest are items and flags.

- **Items** — `blockers` (default), `all`, or finding IDs from the review (`B1`, `S2`, …). Several IDs
  may be given. An ID that is not in the review file: stop and say which.
- **`--replan`** — send the items through `NestjsArchitectAgent` first. Without it, the developer applies
  them straight to the code.

## 1. Check the inputs

- Missing task or step: stop with "Usage: `$fix-review [task] [step] [blockers|all|B1 S2 …] [--replan]`".
- `ai/tasks/[task]/review-step-[step].md` must exist. If not, stop: "Run `$code-review [task] [step]` first."
- Read the review in full and resolve the items to a list of findings. If it is empty (no
  blockers when `blockers` was asked, or none left), stop: "Nothing to fix."

## 2. Models

Nothing to confirm: every role runs on the model this chat uses.

## 3. Fix

**With `--replan`** — spawn the architect:

```
Agent(
  description: "Re-plan — [task] step [step]",
  model:       <from 2>,
  prompt:      "You are acting as NestjsArchitectAgent. Read `ai/agents/architect.md` for
                your full role, workflow, and instructions. Run `plan_task([task], [step])`.
                This is a re-plan from a review: the user has already accepted exactly these
                findings from `ai/tasks/[task]/review-step-[step].md`: [IDs]. Fold them in
                and no others; do not ask the user to confirm. The model is already
                confirmed. Skip the fresh-session reminder. If the description is missing
                or the review conflicts with it, stop and say so instead of guessing."
)
```

Then check that `ai/tasks/[task]/plan-step-[step].md` changed and has an **Execution
Status** section. If not, stop and report `RE-PLAN FAILED`. Next spawn the developer:

```
Agent(
  description: "Execute — [task] step [step]",
  model:       <from 2>,
  prompt:      "You are acting as NestjsDeveloperAgent. Read `ai/agents/developer.md` for
                your full role, workflow, and instructions. Run `execute_plan([task], [step])`.
                The model is already confirmed — skip the model prompt. Do not ask the user
                anything."
)
```

**Without `--replan`** — spawn the developer on the review directly:

```
Agent(
  description: "Apply review — [task] step [step]",
  model:       <from 2>,
  prompt:      "You are acting as NestjsDeveloperAgent. Read `ai/agents/developer.md` for
                your full role, workflow, and instructions. This is a fix pass, not an
                execute_plan run: read `ai/tasks/[task]/plan-step-[step].md` for context, then
                apply exactly these findings from `ai/tasks/[task]/review-step-[step].md`:
                [IDs], and nothing else. Do not change the plan. If a finding needs a
                design decision, contradicts the plan, or touches files outside it, skip it
                and report it as NEEDS REPLAN. Afterwards do the same verification the
                developer workflow asks for after an implementation, and report per ID:
                fixed / skipped (why). The model is already confirmed. Do not ask the user
                anything."
)
```

If the developer reports a stop (ambiguous or wrong plan), print its report and stop.

## 4. Re-review

Spawn the reviewer, which overwrites `review-step-[step].md`:

```
Agent(
  description: "Re-review — [task] step [step]",
  model:       <from 2>,
  prompt:      "You are acting as NestjsReviewerAgent. Read `ai/agents/reviewer.md` for your
                full role, workflow, and instructions. Run `code_review([task], [step])`.
                The model is already confirmed — skip the model prompt. Do not present the
                next-step dialog and do not ask the user anything; write the report and
                reply with its Summary line only."
)
```

## 5. Report

Read the new review file and print:

```
## Fix Review — [task] Step [step]

Mode: [replan | direct]. Applied: [IDs fixed]. Skipped: [IDs, with reason].
Re-review: [Summary line].
```

If blockers remain, say so and suggest `$fix-review [task] [step] blockers --replan` when
this pass was direct, or the manual path (`$plan-task`, `$execute-plan`) when it was already
a replan. **One round only** — never start a second fix pass on your own.

## What this command does NOT do

- Does not edit source files or plans itself.
- Does not run a second fix round.
- Does not move the issue between tracker stages beyond what the reviewer's own R.0 does.
