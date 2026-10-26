'use strict';

const fs = require('fs');

const { trackerForRepo, TrackerError, NoTransitionError, UnknownStatusError } = require('./index');
const { ConfigError } = require('../config');
const epics = require('./epics');

// Command-line surface for the tracker.
//
// Every command name from the four replaced `ai/scripts/jira.js` copies is kept,
// including the ones that only existed in one repo (`create-story` in glossr,
// `create-task` in snap, `close-story` in glossr-frontend). They are aliases onto
// one implementation now, but the names stay because agent docs, command stubs
// and WORKFLOW.md across five repos reference them by string. Renaming them is a
// v2 concern, done in the same pass that regenerates those files.
//
// Output shapes are also preserved verbatim — `create-*` prints the bare key,
// `get` prints JSON, `set-status` prints `KEY -> Status` — because the agents
// read this output. Changing it would silently break prompts.

const ALIASES = {
  'create-task': 'create-issue',
  'create-story': 'create-issue',
  'create-subtask': 'create-subissue',
  'create-step': 'create-subissue',
  'close-story': 'close',
  'close-task': 'close',
};

const USAGE = `cairn tracker <command> [...args]

  list-projects
  list-statuses [projectKey]
  create-task | create-story <summary> [descriptionOrFile]
  create-task | create-story ... [--epic <epic>]   link the new story to an epic
  create-subtask | create-step <parentKey> <summary> [descriptionOrFile] [--step <n>]
                                with publicRefs on, the new issue becomes <story ref>.<n>
                                (n defaults to the next free number, from 2)
  create-epic <summary> [descriptionOrFile]
  set-epic <key> <epic|none>
  epic-children <epic>
  close-epic <epic> [statusName=Done] [--force]   refuses while stories are open
  check-refs                    report public refs carried by more than one issue
  resolve <ref>                 print the tracker key behind a public ref
  get <key>
  link <key> <dependsOnKey>     key depends on dependsOnKey (youtrack)
  set-fields <key> [--summary ..] [--description ..] [--description-file ..]
  append-description <key> <textOrFile>
  set-status <key> <statusName> [--if-exists]   --if-exists: a stage the board does not have
                                                 is skipped with a message (exit 0), not an error
  check-statuses                check the stages named in tracker.statuses against the board
  close-story <key> [statusName=Done]
  set-assignee <key> <username>

  --markup   convert markdown input to Jira wiki markup before sending
  --json     print machine-readable output where the command supports it

Anywhere a <key> or <epic> is taken, either the tracker key (CI-79) or a public
ref (CI-E1 for an epic, CI-1-4 for story 4 of epic 1, CI-1-4.2 for its step 2) works.
`;

// Positions of the arguments that name an issue, per command — the ones a public
// ref may be typed into.
const KEY_ARGS = {
  get: [0],
  link: [0, 1],
  'set-fields': [0],
  'append-description': [0],
  'set-status': [0],
  close: [0],
  'set-assignee': [0],
  'create-subissue': [0],
  'set-epic': [0, 1],
  'epic-children': [0],
  'close-epic': [0],
  resolve: [0],
};

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

// A value that names an existing file is read as one; otherwise it is the text.
// Inherited behaviour — the workflow passes description files by path.
function readMaybeFile(value) {
  if (value === undefined || value === true) return undefined;
  try {
    if (fs.existsSync(value) && fs.statSync(value).isFile()) return fs.readFileSync(value, 'utf8');
  } catch {
    /* fall through to literal */
  }
  return value;
}

async function run(argv, { cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  const [rawCommand, ...args] = argv;
  if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
    out(USAGE);
    return 0;
  }

  const command = ALIASES[rawCommand] || rawCommand;
  const { flags, rest } = parseFlags(args);

  let tracker;
  let publicRefs = false;
  let trackerConfig = {};
  try {
    const repo = trackerForRepo(cwd);
    tracker = repo.tracker;
    trackerConfig = repo.config.tracker;
    publicRefs = !!repo.config.tracker.publicRefs;
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return 2;
    }
    throw e;
  }

  const markup = (text) => (flags.markup && text !== undefined ? tracker.toMarkup(text) : text);

  async function announceStepRef(stepKey, parentKey, step) {
    try {
      const n = typeof step === 'string' ? Number(step) : undefined;
      const ref = await epics.assignStepRef(tracker, stepKey, parentKey, n);
      if (ref) err(`public ref: ${ref}`);
    } catch (e) {
      if (!(e instanceof TrackerError)) throw e;
      err(`${stepKey}: no public ref assigned: ${e.message}`);
    }
  }

  // The issue is already created/moved by the time this runs, so a failure here is
  // a warning, never a non-zero exit — the caller has the key and must not retry.
  async function announceStoryRef(storyKey, epicKey) {
    try {
      const ref = await epics.assignStoryRef(tracker, storyKey, epicKey);
      if (ref) err(`public ref: ${ref}`);
      else err(`${storyKey}: epic ${epicKey} has no public ref, so no story ref assigned`);
    } catch (e) {
      if (!(e instanceof TrackerError)) throw e;
      err(`${storyKey}: no public ref assigned: ${e.message}`);
    }
  }

  try {
    // Public refs are turned into tracker keys here, once, so no provider ever
    // sees one. Internal keys pass through without a request.
    if (tracker.name !== 'none') {
      for (const i of KEY_ARGS[command] || []) {
        if (rest[i] !== undefined) rest[i] = await epics.resolveKey(tracker, rest[i]);
      }
      if (typeof flags.epic === 'string') flags.epic = await epics.resolveKey(tracker, flags.epic);
    }

    switch (command) {
      case 'list-projects': {
        const projects = await tracker.listProjects();
        if (flags.json) out(JSON.stringify(projects, null, 2));
        else for (const p of projects) out(`${p.key} - ${p.name}`);
        return 0;
      }

      case 'list-statuses': {
        const groups = await tracker.listStatuses(rest[0]);
        if (flags.json) out(JSON.stringify(groups, null, 2));
        else for (const g of groups) out(`${g.type}: ${g.statuses.join(', ')}`);
        return 0;
      }

      case 'create-issue': {
        const key = await tracker.createIssue({
          summary: rest[0],
          description: markup(readMaybeFile(rest[1])) || '',
          type: flags.type,
          epicKey: typeof flags.epic === 'string' ? flags.epic : undefined,
        });
        if (key === null) {
          err('tracker.provider is "none" — no issue created');
          return 0;
        }
        out(key);
        if (publicRefs && typeof flags.epic === 'string') await announceStoryRef(key, flags.epic);
        return 0;
      }

      case 'create-epic': {
        const key = await tracker.createEpic({
          summary: rest[0],
          description: markup(readMaybeFile(rest[1])) || '',
        });
        if (key === null) {
          err('tracker.provider is "none" — no epic created');
          return 0;
        }
        out(key);
        if (publicRefs) {
          try {
            err(`public ref: ${await epics.assignEpicRef(tracker, key)}`);
          } catch (e) {
            if (!(e instanceof TrackerError)) throw e;
            err(`${key} created, but no public ref assigned: ${e.message}`);
          }
        }
        return 0;
      }

      case 'set-epic': {
        const epicKey = rest[1] === 'none' ? null : rest[1];
        if (rest[1] === undefined) throw new TrackerError('set-epic requires an epic key, or "none" to detach');
        const result = await tracker.setEpic(rest[0], epicKey);
        if (result.skipped) {
          err(`${rest[0]}: ${result.reason} — epic not changed`);
          return 0;
        }
        out(epicKey ? `${rest[0]} -> epic ${epicKey}` : `${rest[0]} detached from its epic`);
        if (publicRefs && epicKey) await announceStoryRef(rest[0], epicKey);
        return 0;
      }

      case 'epic-children': {
        const children = await tracker.epicChildren(rest[0]);
        if (flags.json) {
          out(JSON.stringify(children.map((c) => ({ key: c.key, ref: epics.refFromLabels(c.labels), status: c.status })), null, 2));
        } else {
          for (const c of children) out([c.key, epics.refFromLabels(c.labels) || '-', c.status || '-'].join('\t'));
        }
        return 0;
      }

      case 'close-epic': {
        const status = rest[1] || 'Done';
        const result = await epics.closeEpic(tracker, rest[0], status, { force: !!flags.force });
        if (result.skipped) {
          err(`${result.key}: ${result.reason} — nothing closed`);
          return 0;
        }
        if (result.blocked && result.blocked.length) {
          err(`${result.key} not closed: ${result.blocked.length} story(ies) not "${status}": ${result.blocked.join(', ')}`);
          err('  close them first, or pass --force to close them with the epic.');
          return 1;
        }
        for (const r of result.results) {
          if (r.ok) out(`${r.key} -> ${r.to}`);
          else err(`${r.key}: ${r.reason}`);
        }
        if (result.failed) {
          err(`${result.failed} issue(s) could not be moved to "${status}".`);
          return 1;
        }
        out(`${result.key} is now "${status}".`);
        return 0;
      }

      case 'check-refs': {
        const all = await tracker.listEpics();
        for (const epic of [...all]) {
          for (const story of await tracker.epicChildren(epic.key)) {
            all.push(story, ...(await tracker.subtaskList(story.key)));
          }
        }
        const dupes = epics.findDuplicateRefs(all);
        if (!dupes.length) {
          out('no duplicate public refs');
          return 0;
        }
        for (const d of dupes) err(`${d.ref} is on ${d.keys.join(', ')}`);
        return 1;
      }

      case 'resolve': {
        out(rest[0]);
        return 0;
      }

      case 'create-subissue': {
        const key = await tracker.createSubIssue({
          parentKey: rest[0],
          summary: rest[1],
          description: markup(readMaybeFile(rest[2])) || '',
          type: flags.type,
        });
        if (key === null) {
          err('tracker.provider is "none" — no sub-issue created');
          return 0;
        }
        out(key);
        if (publicRefs) await announceStepRef(key, rest[0], flags.step);
        return 0;
      }

      case 'get': {
        const issue = await tracker.get(rest[0]);
        // The epic/ref fields appear only when there is something to show, so a
        // repo that doesn't use epics reads exactly the JSON it always did.
        if (issue) {
          const { labels, epic, ...shown } = issue;
          const ref = epics.refFromLabels(labels);
          if (epic) shown.epic = epic;
          if (ref) shown.ref = ref;
          out(JSON.stringify(shown, null, 2));
        } else {
          out(JSON.stringify(issue, null, 2));
        }
        return 0;
      }

      case 'link': {
        const result = await tracker.link({ key: rest[0], dependsOn: rest[1] });
        if (result.skipped) {
          err(`${result.reason} — nothing linked`);
          return 0;
        }
        out(`${result.key} depends on ${result.dependsOn}`);
        return 0;
      }

      case 'set-fields': {
        const descArg = flags['description-file'] !== undefined ? flags['description-file'] : flags.description;
        const fields = {};
        if (flags.summary !== undefined && flags.summary !== true) fields.summary = flags.summary;
        if (descArg !== undefined) fields.description = markup(readMaybeFile(descArg));
        await tracker.setFields(rest[0], fields);
        out(`${rest[0]} updated`);
        return 0;
      }

      case 'append-description': {
        await tracker.appendDescription(rest[0], markup(readMaybeFile(rest[1])));
        out(`${rest[0]} description appended`);
        return 0;
      }

      case 'check-statuses': {
        const groups = await tracker.listStatuses();
        if (tracker.name === 'none') {
          out('tracker.provider is "none" — no stages to check');
          return 0;
        }
        const valid = groups.flatMap((g) => g.statuses);
        const exists = (name) => valid.some((v) => v.toLowerCase() === String(name).toLowerCase());
        const set = trackerConfig.statusesSet || [];
        let missing = 0;
        for (const key of ['todo', 'inProgress', 'review', 'done']) {
          const name = (trackerConfig.statuses || {})[key];
          const label = key.padEnd(10);
          if (!name) out(`${label} not configured (no workflow step moves an issue there)`);
          else if (exists(name)) out(`${label} "${name}"  ok`);
          else if (set.includes(key)) {
            missing++;
            out(`${label} "${name}"  MISSING from the board`);
          } else out(`${label} "${name}"  not on the board (cairn's default; unused until you set tracker.statuses.${key})`);
        }
        out(`board stages: ${valid.join(', ')}`);
        if (missing) {
          err(`${missing} configured stage(s) do not exist. Steps that move to them are skipped with --if-exists; fix tracker.statuses in cairn.config.json.`);
          return 1;
        }
        return 0;
      }

      case 'set-status': {
        let result;
        try {
          result = await tracker.setStatus(rest[0], rest[1]);
        } catch (e) {
          // A workflow step moving an issue to a stage this board never defined must
          // not fail the run. Say so plainly (the agent relays it) and carry on.
          if (flags['if-exists'] && e instanceof UnknownStatusError) {
            err(`skipped: stage "${rest[1]}" does not exist on this board, so ${rest[0]} was not moved. Valid stages: ${e.available.join(', ')}. Fix: set the right name in tracker.statuses in cairn.config.json.`);
            return 0;
          }
          throw e;
        }
        // Never print `KEY -> Status` for something that did not happen — the
        // agents read this line as confirmation the board was actually moved.
        if (result.skipped) err(`${result.key}: ${result.reason} — status not changed`);
        else if (result.changed === false) out(`${result.key} already ${result.to}`);
        else out(`${result.key} -> ${result.to}`);
        return 0;
      }

      case 'close': {
        const status = rest[1] || 'Done';
        const result = await tracker.closeIssue(rest[0], status);
        if (result.skipped) {
          err(`${result.key}: ${result.reason} — nothing closed`);
          return 0;
        }
        for (const r of result.results) {
          if (r.ok) out(`${r.key} -> ${r.to}`);
          else err(`${r.key}: ${r.reason}`);
        }
        if (result.failed) {
          err(`${result.failed} issue(s) could not be moved to "${status}".`);
          return 1;
        }
        out(`${result.key} and all subtasks are now "${status}".`);
        return 0;
      }

      case 'set-assignee': {
        const result = await tracker.setAssignee(rest[0], rest[1]);
        out(`${result.key} assigned to ${result.assignee}`);
        return 0;
      }

      default:
        err(`Unknown command: ${rawCommand}`);
        err(USAGE);
        return 2;
    }
  } catch (e) {
    // A missing transition means the issue is already at or past the target
    // status on a re-run. Report it, but don't fail the workflow step.
    if (e instanceof NoTransitionError) {
      err(e.message);
      if (e.available.length) err(`  available: ${e.available.join(', ')}`);
      return 0;
    }
    if (e instanceof TrackerError || e instanceof ConfigError) {
      err(e.message);
      return 1;
    }
    throw e;
  }
}

// Entry point used by the vendored shim: `require('@stonepandastudio/cairn/tracker/cli')(args)`.
function main(argv = process.argv.slice(2)) {
  run(argv)
    .then((code) => {
      if (code) process.exitCode = code;
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}

module.exports = main;
module.exports.run = run;
module.exports.parseFlags = parseFlags;
module.exports.USAGE = USAGE;
