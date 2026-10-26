'use strict';

// YouTrack REST client.
//
// Ported from the hand-copied `ai/scripts/youtrack.js` in the snap-proof repos,
// which those repos ran behind a `task-tracker.js` dispatcher alongside the Jira
// client. Same shape as jira-server.js: a factory returning the shared Tracker
// interface, nothing calls process.exit, failures throw TrackerError.
//
// YouTrack differs from Jira in three ways this file absorbs:
//   - no Task/Sub-task issue-type split — a sub-issue is a plain issue joined to
//     its parent by a "Subtask" issue link (OUTWARD = "parent for").
//   - the workflow field is a "Stage" state bundle, not a transition graph, so
//     any value in the bundle is reachable directly and NoTransitionError almost
//     never fires. An unknown stage name is a TrackerError, not a no-op.
//   - descriptions are markdown-native, so toMarkup is a passthrough.
//
// Auth is a permanent token via the Bearer header (YOUTRACK_TOKEN). The project
// and stage-bundle lookups hit /api/admin/* — the token needs admin-read scope.

const { TrackerError, NoTransitionError, UnknownStatusError } = require('./jira-server');

const REQUIRED_ENV = ['YOUTRACK_URL', 'YOUTRACK_TOKEN'];
// What `cairn init` tells the user to put in .env — includes the project, which
// the guard treats as optional only because it can also come from cairn.config.json.
const CREDENTIAL_ENV = ['YOUTRACK_URL', 'YOUTRACK_TOKEN', 'YOUTRACK_PROJECT'];
const STAGE_FIELD = 'Stage';
const ASSIGNEE_FIELD = 'Assignee';
const TYPE_FIELD = 'Type';

function createYouTrack(config = {}, env = process.env) {
  const pfx = config.envPrefix || '';
  const baseUrl = (config.baseUrl || env[pfx + 'YOUTRACK_URL'] || '').replace(/\/+$/, '');
  const token = config.token || env[pfx + 'YOUTRACK_TOKEN'];
  const projectKey = config.projectKey || env[pfx + 'YOUTRACK_PROJECT'];
  const epicType = (config.issueTypes && config.issueTypes.epic) || 'Epic';

  function assertConfig() {
    const missing = REQUIRED_ENV.filter((k, i) => ![baseUrl, token][i]).map((k) => pfx + k);
    if (missing.length) {
      throw new TrackerError(
        `Missing YouTrack credentials: ${missing.join(', ')}. Set them in the repo's .env or the environment.`,
      );
    }
    if (!projectKey) {
      throw new TrackerError(
        'YouTrack project is not set — pass tracker.projectKey in cairn.config.json or YOUTRACK_PROJECT in .env',
      );
    }
  }

  async function api(pathname, options = {}) {
    assertConfig();
    let res;
    try {
      res = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      throw new TrackerError(`Cannot reach YouTrack at ${baseUrl}: ${err.message}`);
    }
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const detail =
        body && (body.error_description || body.error)
          ? body.error_description || body.error
          : typeof body === 'string'
            ? body.slice(0, 400)
            : JSON.stringify(body);
      throw new TrackerError(`YouTrack ${res.status} on ${pathname}: ${detail}`, {
        status: res.status,
        body,
      });
    }
    return body;
  }

  // --- internal lookups (admin scope) --------------------------------------

  async function resolveProjectId() {
    const projects = await api('/api/admin/projects?fields=id,shortName');
    const p = (projects || []).find((pr) => pr.shortName === projectKey);
    if (!p) throw new TrackerError(`YouTrack project "${projectKey}" not found`);
    return p.id;
  }

  async function resolveStageBundleId(shortName = projectKey) {
    const fields = await api(
      `/api/admin/projects/${shortName}/customFields?fields=field(name),bundle(id)`,
    );
    const stage = (fields || []).find((f) => f.field && f.field.name === STAGE_FIELD);
    if (!stage || !stage.bundle) {
      throw new TrackerError(`No "${STAGE_FIELD}" field on YouTrack project ${shortName}`);
    }
    return stage.bundle.id;
  }

  async function stageNames() {
    const bundleId = await resolveStageBundleId();
    const bundle = await api(
      `/api/admin/customFieldSettings/bundles/state/${bundleId}?fields=values(name,isResolved)`,
    );
    return (bundle.values || []).map((v) => ({ name: v.name, resolved: !!v.isResolved }));
  }

  // Linked issues carry their Type so `get` can tell an epic parent from a plain
  // parent without a second request.
  async function issueLinks(key) {
    return api(
      `/api/issues/${key}/links?fields=direction,linkType(name),issues(idReadable,customFields(name,value(name)))`,
    );
  }

  async function command(id, query) {
    await api('/api/commands', { method: 'POST', body: JSON.stringify({ issues: [{ id }], query }) });
  }

  const typeOf = (issue) => {
    const f = (issue.customFields || []).find((x) => x.name === TYPE_FIELD);
    return (f && f.value && f.value.name) || null;
  };

  // Issue keys on one side of one link type. OUTWARD is the source-to-target
  // wording ("parent for", "is required for"), INWARD the reverse ("subtask of",
  // "depends on").
  function linkedKeys(links, typeName, direction) {
    const match = (links || []).find(
      (l) => l.linkType && l.linkType.name === typeName && l.direction === direction,
    );
    return match ? match.issues.map((i) => i.idReadable) : [];
  }

  async function childKeys(key) {
    return linkedKeys(await issueLinks(key), 'Subtask', 'OUTWARD');
  }

  // --- interface ---------------------------------------------------------

  async function listProjects() {
    const projects = await api('/api/admin/projects?fields=shortName,name');
    return (projects || []).map((p) => ({ key: p.shortName, name: p.name }));
  }

  // One "Stage" bundle rather than a per-type status list, so a single group.
  async function listStatuses() {
    const values = await stageNames();
    return [{ type: STAGE_FIELD, statuses: values.map((v) => v.name) }];
  }

  // `type` is accepted for interface parity and ignored — YouTrack has no split.
  async function createIssue({ summary, description = '', epicKey } = {}) {
    if (!summary) throw new TrackerError('createIssue requires a summary');
    const projectId = await resolveProjectId();
    const body = await api('/api/issues?fields=id,idReadable', {
      method: 'POST',
      body: JSON.stringify({ project: { id: projectId }, summary, description }),
    });
    if (epicKey) await command(body.id, `subtask of ${epicKey}`);
    return body.idReadable;
  }

  // An epic is a plain issue with Type = Epic. Stories hang under it with the same
  // "Subtask" link a story uses for its own subtasks, so the hierarchy is
  // epic -> story -> subtask with no extra link type to configure.
  async function createEpic({ summary, description = '' } = {}) {
    if (!summary) throw new TrackerError('createEpic requires a summary');
    const projectId = await resolveProjectId();
    const created = await api('/api/issues?fields=id,idReadable', {
      method: 'POST',
      body: JSON.stringify({ project: { id: projectId }, summary, description }),
    });
    try {
      await command(created.id, `${TYPE_FIELD} ${epicType}`);
    } catch (err) {
      throw new TrackerError(
        `Created ${created.idReadable} but could not set ${TYPE_FIELD} to "${epicType}": ${err.message}. ` +
          `Add that value to the project's ${TYPE_FIELD} field, or set tracker.issueTypes.epic.`,
      );
    }
    return created.idReadable;
  }

  // Attach an issue to an epic (epicKey = null detaches). Leaves any previous epic
  // first, so moving a story does not leave it under two.
  async function setEpic(key, epicKey) {
    const { id } = await api(`/api/issues/${key}?fields=id`);
    const previous = (await get(key)).epic;
    if (previous && previous !== epicKey) await command(id, `remove subtask of ${previous}`);
    if (epicKey && previous !== epicKey) await command(id, `subtask of ${epicKey}`);
    return { key, epic: epicKey || null };
  }

  const tagNames = (issue) => (issue.tags || []).map((t) => t.name);

  const toListed = (i) => {
    const stage = (i.customFields || []).find((f) => f.name === STAGE_FIELD);
    return {
      key: i.idReadable,
      labels: tagNames(i),
      status: (stage && stage.value && stage.value.name) || null,
    };
  };

  async function query(q) {
    const fields = encodeURIComponent('idReadable,tags(name),customFields(name,value(name))');
    const found = await api(`/api/issues?query=${encodeURIComponent(q)}&fields=${fields}&$top=1000`);
    return (found || []).map(toListed);
  }

  const epicChildren = (epicKey) => query(`subtask of: ${epicKey}`);
  const subtaskList = (parentKey) => query(`subtask of: ${parentKey}`);
  const listEpics = () => query(`project: ${projectKey} ${TYPE_FIELD}: ${epicType}`);

  async function findByLabel(label) {
    const found = await query(`project: ${projectKey} tag: {${label}}`);
    return found.length ? found[0].key : null;
  }

  // The command API creates the tag on first use.
  async function addLabel(key, label) {
    const { id } = await api(`/api/issues/${key}?fields=id`);
    await command(id, `tag {${label}}`);
    return { key, label };
  }

  async function createSubIssue({ parentKey, summary, description = '' } = {}) {
    if (!parentKey) throw new TrackerError('createSubIssue requires a parentKey');
    if (!summary) throw new TrackerError('createSubIssue requires a summary');
    const projectId = await resolveProjectId();
    const created = await api('/api/issues?fields=id,idReadable', {
      method: 'POST',
      body: JSON.stringify({ project: { id: projectId }, summary, description }),
    });
    // Join to the parent with a Subtask link via the command API.
    await api('/api/commands', {
      method: 'POST',
      body: JSON.stringify({ issues: [{ id: created.id }], query: `subtask of ${parentKey}` }),
    });
    return created.idReadable;
  }

  async function get(key) {
    const data = await api(
      `/api/issues/${key}?fields=idReadable,summary,description,customFields(name,value(name,login)),tags(name)`,
    );
    const fields = data.customFields || [];
    const stage = fields.find((f) => f.name === STAGE_FIELD);
    const assignee = fields.find((f) => f.name === ASSIGNEE_FIELD);
    const links = await issueLinks(key);
    const parentLink = (links || []).find(
      (l) => l.linkType && l.linkType.name === 'Subtask' && l.direction === 'INWARD',
    );
    const epicParent = parentLink && parentLink.issues.find((i) => typeOf(i) === epicType);
    return {
      key: data.idReadable,
      summary: data.summary,
      description: data.description,
      status: (stage && stage.value && stage.value.name) || null,
      assignee: (assignee && assignee.value && assignee.value.login) || null,
      parent: linkedKeys(links, 'Subtask', 'INWARD')[0] || null,
      subtasks: linkedKeys(links, 'Subtask', 'OUTWARD'),
      epic: epicParent ? epicParent.idReadable : null,
      labels: tagNames(data),
      // The "Depend" link type: `key depends on X` / `key is required for Y`.
      dependsOn: linkedKeys(links, 'Depend', 'INWARD'),
      requiredFor: linkedKeys(links, 'Depend', 'OUTWARD'),
    };
  }

  // `key` depends on `dependsOn` — `dependsOn` is required for `key`. Uses the
  // built-in "Depend" link type through the command API, same as createSubIssue.
  async function link({ key, dependsOn } = {}) {
    if (!key) throw new TrackerError('link requires a key');
    if (!dependsOn) throw new TrackerError('link requires dependsOn');
    if (key === dependsOn) throw new TrackerError('an issue cannot depend on itself');
    try {
      const { id } = await api(`/api/issues/${key}?fields=id`);
      await api('/api/commands', {
        method: 'POST',
        body: JSON.stringify({ issues: [{ id }], query: `depends on ${dependsOn}` }),
      });
    } catch (err) {
      throw new TrackerError(`Could not link ${key} -> depends on ${dependsOn}: ${err.message}`);
    }
    return { key, dependsOn };
  }

  async function setFields(key, fields = {}) {
    const payload = {};
    if (fields.summary !== undefined) payload.summary = fields.summary;
    if (fields.description !== undefined) payload.description = fields.description;
    if (Object.keys(payload).length === 0) {
      throw new TrackerError('setFields requires at least one of: summary, description');
    }
    await api(`/api/issues/${key}?fields=idReadable`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return key;
  }

  async function appendDescription(key, text) {
    if (!text) throw new TrackerError('appendDescription requires text');
    const current = await api(`/api/issues/${key}?fields=description`);
    const existing = (current && current.description) || '';
    const updated = existing ? `${existing}\n\n${text}` : text;
    await api(`/api/issues/${key}?fields=idReadable`, {
      method: 'POST',
      body: JSON.stringify({ description: updated }),
    });
    return updated;
  }

  async function currentStage(key) {
    const data = await api(`/api/issues/${key}?fields=customFields(name,value(name))`);
    const f = (data.customFields || []).find((x) => x.name === STAGE_FIELD);
    return (f && f.value && f.value.name) || null;
  }

  // Returns { key, from, to, changed }. Already at the target stage is a success
  // with changed:false — re-running a workflow step must be safe. An unknown
  // stage name throws TrackerError (with the valid names), not NoTransitionError:
  // YouTrack has no transition graph, so this is a bad argument, not a dead end.
  async function setStatus(key, statusName) {
    if (!statusName) throw new TrackerError('setStatus requires a status name');
    const from = await currentStage(key);
    if (from && from.toLowerCase() === statusName.toLowerCase()) {
      return { key, from, to: from, changed: false };
    }
    try {
      await api(`/api/issues/${key}?fields=idReadable`, {
        method: 'POST',
        body: JSON.stringify({
          customFields: [
            { name: STAGE_FIELD, $type: 'StateIssueCustomField', value: { name: statusName } },
          ],
        }),
      });
    } catch (err) {
      let names = [];
      try {
        names = (await stageNames()).map((v) => v.name);
      } catch {
        /* keep the original error if the bundle lookup also fails */
      }
      const message =
        `Could not set ${key} ${STAGE_FIELD} to "${statusName}"` +
        (names.length ? ` — valid: ${names.join(', ')}` : `: ${err.message}`);
      // The name is not one of the project's stages: a config error a workflow step
      // can choose to skip. Any other failure (network, permissions) stays a TrackerError.
      if (names.length && !names.some((n) => n.toLowerCase() === statusName.toLowerCase())) {
        throw new UnknownStatusError(message, { available: names });
      }
      throw new TrackerError(message);
    }
    return { key, from, to: statusName, changed: true };
  }

  // Move an issue and its subtasks. Subtasks first. A subtask that can't be
  // moved is collected, not thrown, so one stuck child doesn't strand the rest.
  async function closeIssue(key, statusName = 'Done') {
    const issue = await get(key);
    const results = [];
    for (const subKey of issue.subtasks) {
      try {
        results.push({ ...(await setStatus(subKey, statusName)), ok: true });
      } catch (err) {
        if (!(err instanceof TrackerError)) throw err;
        results.push({ key: subKey, ok: false, reason: err.message });
      }
    }
    try {
      results.push({ ...(await setStatus(key, statusName)), ok: true });
    } catch (err) {
      if (!(err instanceof TrackerError)) throw err;
      results.push({ key, ok: false, reason: err.message });
    }
    return { key, status: statusName, results, failed: results.filter((r) => !r.ok).length };
  }

  async function setAssignee(key, username) {
    if (!username) throw new TrackerError('setAssignee requires a username');
    await api(`/api/issues/${key}?fields=idReadable`, {
      method: 'POST',
      body: JSON.stringify({
        customFields: [
          { name: ASSIGNEE_FIELD, $type: 'SingleUserIssueCustomField', value: { login: username } },
        ],
      }),
    });
    return { key, assignee: username };
  }

  // YouTrack renders markdown natively — nothing to convert.
  function toMarkup(markdown) {
    return markdown;
  }

  return {
    name: 'youtrack',
    projectKey,
    issueTypes: {},
    listProjects,
    listStatuses,
    createIssue,
    createSubIssue,
    createEpic,
    setEpic,
    epicChildren,
    subtaskList,
    listEpics,
    findByLabel,
    addLabel,
    get,
    link,
    setFields,
    appendDescription,
    setStatus,
    closeIssue,
    setAssignee,
    toMarkup,
  };
}

module.exports = { createYouTrack, TrackerError, NoTransitionError, CREDENTIAL_ENV };
