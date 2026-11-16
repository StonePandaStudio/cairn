## Ground rules

- Run cairn as `npx cairn …` from the repo root (a local install). Fall back to a global `cairn` when the repo has no local install. Check with `npx cairn version`. If cairn is not installed in the repo, say so and ask before installing it (`npm i -D @stonepandastudio/cairn`, or the repo's package manager's equivalent).
- Ask the user in chat and wait for the answer wherever this procedure says to ask. Propose the answers you can infer from the repo instead of interrogating the user; ask everything in one message where you can.
- Preview before you write: use `--dry-run` where the command has it, and show the user what it printed.
- Never commit, push, or edit `package.json` by hand. cairn never commits either; leave the git step to the user.
- When a command exits non-zero, show its output, say what it means and stop. Do not retry with `--force` unless the user asks for it.
- Finish by telling the user what changed and which cairn commands you ran, so they can repeat them without you.
