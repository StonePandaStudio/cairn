'use strict';

const fs = require('fs');

const { trackerForRepo, TrackerError, NoTransitionError } = require('./index');
const { ConfigError } = require('../config');

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
  'close-story': 'close',
  'close-task': 'close',
};

const USAGE = `cairn tracker <command> [...args]

  list-projects
  list-statuses [projectKey]
  create-task | create-story <summary> [descriptionOrFile]
  create-subtask <parentKey> <summary> [descriptionOrFile]
  get <key>
  link <key> <dependsOnKey>     key depends on dependsOnKey (youtrack)
  set-fields <key> [--summary ..] [--description ..] [--description-file ..]
  append-description <key> <textOrFile>
  set-status <key> <statusName>
  close-story <key> [statusName=Done]
  set-assignee <key> <username>

  --markup   convert markdown input to Jira wiki markup before sending
  --json     print machine-readable output where the command supports it
`;

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
  try {
    ({ tracker } = trackerForRepo(cwd));
  } catch (e) {
    if (e instanceof ConfigError) {
      err(e.message);
      return 2;
    }
    throw e;
  }

  const markup = (text) => (flags.markup && text !== undefined ? tracker.toMarkup(text) : text);

  try {
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
        });
        if (key === null) {
          err('tracker.provider is "none" — no issue created');
          return 0;
        }
        out(key);
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
        return 0;
      }

      case 'get': {
        const issue = await tracker.get(rest[0]);
        out(JSON.stringify(issue, null, 2));
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

      case 'set-status': {
        const result = await tracker.setStatus(rest[0], rest[1]);
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
