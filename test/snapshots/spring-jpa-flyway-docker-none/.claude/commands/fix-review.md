---
description: Fix what a code review found, then re-review
argument-hint: "[task] [step] [blockers|all|B1 S2 …] [--replan]"
---
You are the **fix-review orchestrator**. You chain the agents; you do not plan, edit
source, or review yourself. Everything below happens in this session by spawning
sub-agents with the `Agent` tool, each call **blocking**.

Parse `$ARGUMENTS`: first token is the task ID (e.g. TASK-210), second is the step
number, the rest are items and flags.

- **Items** — `blockers` (default), `all`, or finding IDs from the review (`B1`, `S2`, …). Several IDs
  may be given. An ID that is not in the review file: stop and say which.
- **`--replan`** — send the items through `SpringArchitectAgent` first. Without it, the developer applies
  them straight to the code.

## 1. Check the inputs

- Missing task or step: stop with "Usage: `/fix-review [task] [step] [blockers|all|B1 S2 …] [--replan]`".
- `ai/tasks/[task]/review-step-[step].md` must exist. If not, stop: "Run `/code-review [task] [step]` first."
- Read the review in full and resolve the items to a list of findings. If it is empty (no
  blockers when `blockers` was asked, or none left), stop: "Nothing to fix."

## 2. Confirm models once

The sub-agents cannot ask anything, so ask here, once, with the `AskUserQuestion` tool
(options **OK** / **Not OK**): **"Run SpringArchitectAgent and SpringReviewerAgent on Sonnet and
SpringDeveloperAgent on Haiku (recommended)?"** In direct mode leave out the architect.
OK — pass those as each sub-agent's `model`. Not OK — omit `model`, so they inherit this session's.

## 3. Fix

**With `--replan`** — spawn the architect:

```
Agent(
  description: "Re-plan — [task] step [step]",
  model:       <from 2>,
  prompt:      "You are acting as SpringArchitectAgent. Read `ai/agents/architect.md` for
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
  prompt:      "You are acting as SpringDeveloperAgent. Read `ai/agents/developer.md` for
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
  prompt:      "You are acting as SpringDeveloperAgent. Read `ai/agents/developer.md` for
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
  prompt:      "You are acting as SpringReviewerAgent. Read `ai/agents/reviewer.md` for your
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

If blockers remain, say so and suggest `/fix-review [task] [step] blockers --replan` when
this pass was direct, or the manual path (`/plan-task`, `/execute-plan`) when it was already
a replan. **One round only** — never start a second fix pass on your own.

## What this command does NOT do

- Does not edit source files or plans itself.
- Does not run a second fix round.
- Does not move the issue between tracker stages beyond what the reviewer's own R.0 does.
