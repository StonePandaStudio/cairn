# ai-kit doctor

Read-only drift report for the `ai/` + `.claude/` workflow scaffolding shared across
several repos. Step 1 of extracting that scaffolding into a real framework: before
deciding what to share, find out what already is shared and what quietly diverged.

It never writes to the repos it inspects.

## Run

```bash
node doctor.js                                   # full table
node doctor.js --diff .claude/commands/run-qa.md # hunks for one file
node doctor.js --json                            # machine-readable
node doctor.js --strict                          # exit 1 on any gap or drift
```

Options: `--config <file>`, `--context <n>`, `--no-color`, `--normalize-issue-type`.

## How it decides

Raw file comparison across these repos is noise — every copy differs on the project
key, on absolute paths, on line endings, and on stack-specific agent names. So each
file is **normalized** before comparison: BOM and CRLF stripped, repo paths and repo
names folded, `GLO-18`/`PROOF-210` folded to `{{ISSUE}}`, and every var declared in
`repos.json` (`architectAgent`, `architectDoc`, …) folded to its `{{placeholder}}`.

What survives that folding is drift that no template variable explains.

Files are then clustered by normalized content. Each cluster is one real variant; the
cluster with the most repos becomes the reference, and the others are diffed against it.

## Statuses

| Status | Meaning | What to do |
|---|---|---|
| `IDENTICAL` | byte-identical everywhere | extract as-is |
| `COSMETIC` | differs only in declared vars | extract as a template — zero merge cost |
| `DRIFT` | two or more genuinely different variants | merge by hand before extracting |
| `MISSING` | some repos in the cohort lack it | decide whether they should have it |
| `STRANDED` | exactly one repo has it | promotion candidate |

`DRIFT` reports changed lines and a similarity percentage against the reference
variant, so you can sort cheap merges from expensive ones.

## Cohorts

A rule's `cohort` decides who gets compared with whom:

- `all` — every repo. Used for command stubs, `ai/scripts/`, and top-level `ai/*.md`,
  which should be identical modulo vars regardless of stack.
- `stack` — backend-with-backend, frontend-with-frontend. Used for `ai/agents/*.md`
  and the infrastructure guidelines, where the persona body is legitimately different
  per stack and comparing across stacks would be meaningless.

## Config (`repos.json`)

- `repos[]` — name, path, stack, and the `vars` block that drives normalization.
  Adding a repo means adding an entry here; adding a role means adding a var and
  listing its name under `normalize.vars`.
- `shared[]` — glob rules for which paths are supposed to be shared, with optional
  `exclude` and `note`. Anything not matched by a rule (`ai/contexts/`, `ai/progress/`,
  `ai/tasks/`, `DATABASE_SCHEMA.md`) is per-project by design and never inspected.
- `normalize` — toggles. `issueTypes` is off by default: folding `Story`/`Task` also
  hits those words in ordinary prose, so it trades false-identical risk for signal.

## Layout

```
doctor.js          CLI, analysis, reporting
lib/scan.js        minimal glob + targeted directory walk
lib/normalize.js   the normalizers described above
lib/diff.js        LCS line diff, no dependencies
repos.json         repo list + shared-path rules
```

No dependencies. Node >= 18.
