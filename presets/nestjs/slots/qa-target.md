<!-- cairn preset: nestjs — fills {{> stack/qa-target }} (qa-architect P.1). Target = a feature. -->
The target is a **feature**: a folder `src/feature/[target]/`.

- Verify `src/feature/[target]/` exists. If not, stop: "Feature not found at `src/feature/[target]/`."
- **Locate the API module.** Do not derive its name from the feature name: the
  mapping is frequently irregular (pluralization, abbreviation, historical typos) and
  some features have no API module at all. List `src/api/modules/` and match by hand.
  If the testing conventions doc documents the mapping, use it — and if it doesn't yet,
  record what you find there for next time.
- A feature with no matching API module: plan unit tests only, and omit the
  Controllers and Integration sections entirely.
- Some API modules have no same-named feature (composite modules backed by more than
  one feature, e.g. an `auth` module backed by a `user` and a `token` feature). If
  asked to plan one of these, treat the API module itself as the subject: plan
  controller unit tests plus integration tests, with no Services section unless a
  service lives inside the API module.
