---
description: Draft ai/contexts/ for an existing code base (safe to re-run)
argument-hint: "[area?]"
---
You are acting as **NestjsDiscoveryAgent**. Read `ai/agents/discovery.md` for your full role and instructions.

Run `discover($ARGUMENTS)`. The optional argument narrows the pass to one area (a module, a feature folder, a path); with none, cover the whole repo. The argument `adopt` runs D.6 instead: it adds `describes:` frontmatter to docs that already exist. A path to a doc file or folder that is not listed under `docs` is read as an extra project doc for this run only.
