<!-- cairn variant: translation-source = glossr. Fills the translation-source slot
     in presets/angular/code-guidelines.md.
     In use by: glossr-frontend. This project dogfoods the product. -->

## slot: translation-source

**Glossr itself is the source of truth for all translations.** This project dogfoods the product: keys and values live in the Glossr instance at `glossr.stonepandastudio.com`, not in any file in this repo. There is no `en.json` — do not create one.

### Where Translations Come From

Each app consumes Glossr differently:

| App | Mechanism | Files |
|---|---|---|
| `glossr-frontend` | **Pipeline pull.** `npm run glossr:pull` fetches the CDN and overwrites the locale files, one per target in `glossr.config.json`. | everything under `apps/glossr-frontend/src/assets/i18n/` |
| `glossr-admin` | **Runtime fetch.** `GlossrCdnTranslateLoader` requests `${translationUrl}/${lang}` on load. | none — no locale files on disk |

### Translation Assets Are Generated — Never Touch Them

**Every file under `apps/glossr-frontend/src/assets/i18n/` is a build artifact.** The set is whatever `glossr.config.json` lists as targets (`en-us.json`, `ru-ru.json`, `pl-pl.json`, …) — treat the folder as generated, not the individual filenames, so adding a locale needs no change here.

The pipeline runs `npm run glossr:pull` and **replaces these files wholesale**. Consequences:

* **Never hand-edit them.** Any manual change is silently destroyed by the next pull — including "just adding the one key I need to see the UI render".
* **Never add a key to them** to make a new feature display real text. New keys go to `ai/tasks/GLO-[task]/keys.json` (see below) and reach the app only after a human imports the story and pulls.
* **Read-only reference is fine** — consult `en-us.json` to check whether a key already exists or to copy a naming pattern.
* **Ignore them when reviewing a diff.** A changed locale file is pull output, not authored work; it is neither a finding nor scope creep. The only locale-file change worth flagging is one made *by hand* in place of a `keys.json` entry.
* Adding a locale is a `glossr.config.json` change plus the app's language registration — the resulting `.json` is generated, so do not write it by hand.

### Adding New Keys

The Glossr CLI is **pull-only** (`glossr --help` → `pull` is the only command), so new keys reach Glossr by manual import. A `push` command is planned; until it exists, keys accumulate in a per-story file and are uploaded once.

**One `keys.json` per story — not per step.**

```
ai/tasks/GLO-[task]/keys.json
```

Every step of a story writes into that same file:

* **File does not exist** (usually step 1) → create it, containing only that step's keys.
* **File already exists** (step 2+) → **merge** the new keys into it. Deep-merge the nested structure; keep every key earlier steps added. Never overwrite the file wholesale, and never create `keys-step-2.json` or similar.
* A step that introduces **no** new keys leaves the file untouched.

Shape: nested JSON matching the CDN payload, English values, PascalCase keys per the naming conventions below.

**Lifecycle:**

| When | What | Who |
|---|---|---|
| During each step | Create or merge into `keys.json` | developer agent |
| Story complete | Import `keys.json` into Glossr — **once, for the whole story** | human |
| After import | `npm run glossr:pull` | human |
| After pull | Commit the regenerated files in `assets/i18n/` | human |

The upload is deliberately deferred to story completion: a story's keys tend to churn across steps, and importing per-step would push keys into Glossr that a later step renames or drops.

**Consequence:** for the whole life of the story, the app renders raw key strings for its new keys. That is expected, not a bug — do not "fix" it by editing a locale file. `keys.json` is the durable, git-tracked record of what the story introduced, and it survives the pull that overwrites the locale files.

### Checking Existing Keys

Check `apps/glossr-frontend/src/assets/i18n/en-us.json`. Do not use the root-level `all-keys-en.json` / `all-keys-en-admin.json` dumps as a reference — they are untracked one-off exports and already stale (`all-keys-en.json` is 27 keys behind `en-us.json`).
