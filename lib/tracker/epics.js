'use strict';

const { TrackerError } = require('./jira-server');

// Epics and public refs, layered on the provider interface so every provider gets
// them for the cost of a few primitives (createEpic, setEpic, epicChildren,
// listEpics, findByLabel, addLabel).
//
// Two kinds of key:
//   internal  CI-79     the tracker's own key. Immutable, what API calls use.
//   public    CI-E1     epic 1
//             CI-1-4    story 4 of epic 1
//             CI-1-4.2  step 2 of that story (step 1 is the story itself)
//
// A public ref is stored on the issue as a label/tag `ref-<ref>` — searchable in
// the tracker, no custom field, nothing for the user to configure. Both kinds are
// opt-in: with `tracker.publicRefs` off nothing here assigns anything, and
// `resolveKey` is a pass-through for internal keys (no request is made).

const PROJECT = '([A-Za-z][A-Za-z0-9_]*)';
const EPIC_RE = new RegExp(`^${PROJECT}-E(\\d+)$`, 'i');
const STORY_RE = new RegExp(`^${PROJECT}-(\\d+)-(\\d+)$`);
const STEP_RE = new RegExp(`^${PROJECT}-(\\d+)-(\\d+)\\.(\\d+)$`);
const LABEL_PREFIX = 'ref-';

// -> { kind: 'epic', project, epic } | { kind: 'story', project, epic, story }
//    | { kind: 'step', project, epic, story, step } | null
// `null` covers internal keys and anything else — callers treat it as "pass through".
function parseRef(input) {
  const s = String(input || '').trim();
  let m = s.match(EPIC_RE);
  if (m) return { kind: 'epic', project: m[1].toUpperCase(), epic: Number(m[2]) };
  m = s.match(STEP_RE);
  if (m) {
    return { kind: 'step', project: m[1].toUpperCase(), epic: Number(m[2]), story: Number(m[3]), step: Number(m[4]) };
  }
  m = s.match(STORY_RE);
  if (m) return { kind: 'story', project: m[1].toUpperCase(), epic: Number(m[2]), story: Number(m[3]) };
  return null;
}

const formatEpicRef = (project, n) => `${project}-E${n}`;
const formatStoryRef = (project, epic, n) => `${project}-${epic}-${n}`;
const formatStepRef = (story, n) => `${story}.${n}`;
const labelFor = (ref) => `${LABEL_PREFIX}${ref}`;

// The public ref carried by a label list, or null. Labels that merely start with
// "ref-" but are not a ref (a team's own `ref-needed` label) are ignored.
function refFromLabels(labels = []) {
  for (const label of labels) {
    if (!label.startsWith(LABEL_PREFIX)) continue;
    const ref = label.slice(LABEL_PREFIX.length);
    if (parseRef(ref)) return ref;
  }
  return null;
}

function nextNumber(issues, project, pick) {
  let max = 0;
  for (const issue of issues) {
    const parsed = parseRef(refFromLabels(issue.labels));
    if (!parsed || parsed.project !== project) continue;
    const n = pick(parsed);
    if (n && n > max) max = n;
  }
  return max + 1;
}

// Internal key for whatever the user typed. Public refs cost one search; internal
// keys cost nothing.
async function resolveKey(tracker, input) {
  const parsed = parseRef(input);
  if (!parsed) return input;
  let ref;
  if (parsed.kind === 'epic') ref = formatEpicRef(parsed.project, parsed.epic);
  else if (parsed.kind === 'story') ref = formatStoryRef(parsed.project, parsed.epic, parsed.story);
  else {
    const story = formatStoryRef(parsed.project, parsed.epic, parsed.story);
    // Step 1 is the story's own issue — it never has a child of its own.
    ref = parsed.step === 1 ? story : formatStepRef(story, parsed.step);
  }
  const key = await tracker.findByLabel(labelFor(ref));
  if (!key) throw new TrackerError(`No issue has public ref ${ref}`);
  return key;
}

// Give an epic its public ref. Refs are immutable: an epic that already has one
// keeps it. Numbers are max+1 over the project's epics, so two people creating an
// epic at the same moment can collide — `findDuplicateRefs` reports it.
async function assignEpicRef(tracker, epicKey) {
  const existing = refFromLabels((await tracker.get(epicKey)).labels);
  if (existing) return existing;
  const project = String(tracker.projectKey).toUpperCase();
  const n = nextNumber(await tracker.listEpics(), project, (p) => p.kind === 'epic' && p.epic);
  const ref = formatEpicRef(project, n);
  await tracker.addLabel(epicKey, labelFor(ref));
  return ref;
}

// Give a story its `<PROJ>-<epic>-<n>` ref. Returns null — assigns nothing — when
// the epic has no public ref itself (it predates `publicRefs`). Same immutability:
// a story moved to another epic keeps the ref it was born with.
async function assignStoryRef(tracker, storyKey, epicKey) {
  const existing = refFromLabels((await tracker.get(storyKey)).labels);
  if (existing) return existing;
  const epicRef = parseRef(refFromLabels((await tracker.get(epicKey)).labels));
  if (!epicRef || epicRef.kind !== 'epic') return null;
  const n = nextNumber(
    await tracker.epicChildren(epicKey),
    epicRef.project,
    (p) => p.kind === 'story' && p.epic === epicRef.epic && p.story,
  );
  const ref = formatStoryRef(epicRef.project, epicRef.epic, n);
  await tracker.addLabel(storyKey, labelFor(ref));
  return ref;
}

// Give a step issue (a child of a story) its `<story ref>.<n>` ref. `step` is the
// workflow's step number (brief-step-N); without it the next free number is used,
// starting at 2 because step 1 is the story itself. Returns null when the parent
// has no story ref. Refuses a number a sibling already holds.
async function assignStepRef(tracker, stepKey, parentKey, step) {
  const existing = refFromLabels((await tracker.get(stepKey)).labels);
  if (existing) return existing;
  const story = parseRef(refFromLabels((await tracker.get(parentKey)).labels));
  if (!story || story.kind !== 'story') return null;
  const storyRef = formatStoryRef(story.project, story.epic, story.story);

  const taken = new Set();
  for (const sibling of await tracker.subtaskList(parentKey)) {
    const p = parseRef(refFromLabels(sibling.labels));
    if (p && p.kind === 'step' && p.story === story.story && p.epic === story.epic) taken.add(p.step);
  }
  let n = step;
  if (n === undefined) {
    n = Math.max(1, ...taken) + 1;
  } else if (!Number.isInteger(n) || n < 2) {
    throw new TrackerError(`step must be a whole number from 2 (step 1 is the story itself), got "${step}"`);
  } else if (taken.has(n)) {
    throw new TrackerError(`${storyRef}.${n} is already taken by another step`);
  }
  const ref = formatStepRef(storyRef, n);
  await tracker.addLabel(stepKey, labelFor(ref));
  return ref;
}

// Refs carried by more than one issue. Takes issues with `labels` (the shape
// epicChildren / listEpics return) and groups by ref.
function findDuplicateRefs(issues) {
  const byRef = new Map();
  for (const issue of issues) {
    const ref = refFromLabels(issue.labels);
    if (!ref) continue;
    byRef.set(ref, [...(byRef.get(ref) || []), issue.key]);
  }
  return [...byRef].filter(([, keys]) => keys.length > 1).map(([ref, keys]) => ({ ref, keys }));
}

const sameStatus = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Close an epic. Refuses while any child story is not already at `statusName`,
// because closing an epic over open work is almost never intended; `force`
// cascades instead (each story closes through its own subtasks first).
async function closeEpic(tracker, key, statusName = 'Done', { force = false } = {}) {
  const children = await tracker.epicChildren(key);
  const open = children.filter((c) => !sameStatus(c.status, statusName));
  if (open.length && !force) {
    return { key, status: statusName, results: [], failed: 0, blocked: open.map((c) => c.key) };
  }

  const results = [];
  for (const child of open) {
    const closed = await tracker.closeIssue(child.key, statusName);
    if (closed.skipped) return { key, status: statusName, results: [], failed: 0, ...closed };
    results.push(...closed.results);
  }
  try {
    const moved = await tracker.setStatus(key, statusName);
    if (moved.skipped) return { key, status: statusName, results: [], failed: 0, ...moved };
    results.push({ ...moved, ok: true });
  } catch (err) {
    if (!(err instanceof TrackerError)) throw err;
    results.push({ key, ok: false, reason: err.message });
  }
  return { key, status: statusName, results, failed: results.filter((r) => !r.ok).length, blocked: [] };
}

module.exports = {
  parseRef,
  formatEpicRef,
  formatStoryRef,
  labelFor,
  refFromLabels,
  resolveKey,
  assignEpicRef,
  assignStoryRef,
  assignStepRef,
  findDuplicateRefs,
  closeEpic,
};
