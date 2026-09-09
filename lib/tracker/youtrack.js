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

const { TrackerError, NoTransitionError } = require('./jira-server');

const REQUIRED_ENV = ['YOUTRACK_URL', 'YOUTRACK_TOKEN'];
const STAGE_FIELD = 'Stage';
const ASSIGNEE_FIELD = 'Assignee';

function createYouTrack(config = {}, env = process.env) {
  const baseUrl = (config.baseUrl || env.YOUTRACK_URL || '').replace(/\/+$/, '');
  const token = config.token || env.YOUTRACK_TOKEN;
  const projectKey = config.projectKey || env.YOUTRACK_PROJECT;

  function assertConfig() {
    const missing = REQUIRED_ENV.filter((k, i) => ![baseUrl, token][i]);
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

  async function issueLinks(key) {
    return api(`/api/issues/${key}/links?fields=direction,linkType(name),issues(idReadable)`);
  }

  async function childKeys(key) {
    const links = await issueLinks(key);
    const sub = (links || []).find(
      (l) => l.linkType && l.linkType.name === 'Subtask' && l.direction === 'OUTWARD',
    );
    return sub ? sub.issues.map((i) => i.idReadable) : [];
  }

  async function parentKeyOf(key) {
    const links = await issueLinks(key);
    const sub = (links || []).find(
      (l) => l.linkType && l.linkType.name === 'Subtask' && l.direction === 'INWARD',
    );
    return sub && sub.issues.length ? sub.issues[0].idReadable : null;
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
  async function createIssue({ summary, description = '' } = {}) {
    if (!summary) throw new TrackerError('createIssue requires a summary');
    const projectId = await resolveProjectId();
    const body = await api('/api/issues?fields=idReadable', {
      method: 'POST',
      body: JSON.stringify({ project: { id: projectId }, summary, description }),
    });
    return body.idReadable;
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
      `/api/issues/${key}?fields=idReadable,summary,description,customFields(name,value(name,login))`,
    );
    const fields = data.customFields || [];
    const stage = fields.find((f) => f.name === STAGE_FIELD);
    const assignee = fields.find((f) => f.name === ASSIGNEE_FIELD);
    const [parent, subtasks] = await Promise.all([parentKeyOf(key), childKeys(key)]);
    return {
      key: data.idReadable,
      summary: data.summary,
      description: data.description,
      status: (stage && stage.value && stage.value.name) || null,
      assignee: (assignee && assignee.value && assignee.value.login) || null,
      parent,
      subtasks,
    };
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
      throw new TrackerError(
        `Could not set ${key} ${STAGE_FIELD} to "${statusName}"` +
          (names.length ? ` — valid: ${names.join(', ')}` : `: ${err.message}`),
      );
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
    get,
    setFields,
    appendDescription,
    setStatus,
    closeIssue,
    setAssignee,
    toMarkup,
  };
}

module.exports = { createYouTrack, TrackerError, NoTransitionError };
