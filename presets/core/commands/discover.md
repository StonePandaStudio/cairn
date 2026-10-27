{{! cairn preset: core. Standalone command, not a workflow.steps[] entry: it has no
    task/step shape. Rendered for every stack; the stack's discover-targets slots
    only say what to look for. }}
---
description: Draft ai/contexts/ for an existing code base (safe to re-run)
argument-hint: "[area?]"
---
You are acting as **{{ discoveryAgent }}**. Read `ai/agents/discovery.md` for your full role and instructions.

Run `discover($ARGUMENTS)`. The optional argument narrows the pass to one area (a module, a feature folder, a path); with none, cover the whole repo.
