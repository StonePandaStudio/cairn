'use strict';

// Jira Server (on-prem) REST v2 client.
//
// Merged from the four hand-copied `ai/scripts/jira.js` files. The only real
// differences between those copies were the project key, the issue-type name
// (`Task` on the PROOF board, `Story` on GLO), and whether close-story existed —
// all three are configuration, so this is one implementation with three knobs.
//
// Auth is Basic (username/password): the deployment at jira.stonepandastudio.com
// runs Jira Server 8.5.1, which predates personal access tokens.
//
// Unlike the scripts it replaces, nothing here calls process.exit — failures
// throw TrackerError and the CLI layer decides the exit code. That is what makes
// the client usable from a workflow runner and not only from a shell.

class TrackerError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'TrackerError';
    this.status = status;
    this.body = body;
  }
}

// Thrown when a transition to the requested status does not exist. Separate type
// because re-running a workflow step is expected to hit this and it is a no-op,
// not a failure — the old scripts exited 1 here and every caller had to special-case it.
class NoTransitionError extends TrackerError {
  constructor(message, { from = null, available = [] } = {}) {
    super(message);
    this.name = 'NoTransitionError';
    this.from = from;
    this.available = available;
  }
}

const REQUIRED_ENV = ['JIRA_BASE_URL', 'JIRA_USER', 'JIRA_PASSWORD'];

function createJiraServer(config = {}, env = process.env) {
  const pfx = config.envPrefix || '';
  const baseUrl = (config.baseUrl || env[pfx + 'JIRA_BASE_URL'] || '').replace(/\/+$/, '');
  const user = config.user || env[pfx + 'JIRA_USER'];
  const password = config.password || env[pfx + 'JIRA_PASSWORD'];
  const projectKey = config.projectKey;
  const issueTypes = { story: 'Story', subtask: 'Sub-task', ...(config.issueTypes || {}) };

  function assertConfig() {
    const missing = REQUIRED_ENV.filter((k, i) => ![baseUrl, user, password][i]).map((k) => pfx + k);
    if (missing.length) {
      throw new TrackerError(
        `Missing Jira credentials: ${missing.join(', ')}. Set them in the repo's .env or the environment.`,
      );
    }
    if (!projectKey) {
      throw new TrackerError('tracker.projectKey is not set in cairn.config.json');
    }
  }

  async function api(pathname, options = {}) {
    assertConfig();
    const auth = Buffer.from(`${user}:${password}`).toString('base64');
    let res;
    try {
      res = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      throw new TrackerError(`Cannot reach Jira at ${baseUrl}: ${err.message}`);
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
        body && body.errorMessages && body.errorMessages.length
          ? body.errorMessages.join('; ')
          : typeof body === 'string'
            ? body.slice(0, 400)
            : JSON.stringify(body);
      throw new TrackerError(`Jira ${res.status} on ${pathname}: ${detail}`, {
        status: res.status,
        body,
      });
    }
    return body;
  }

  async function listProjects() {
    const projects = await api('/rest/api/2/project');
    return projects.map((p) => ({ key: p.key, name: p.name }));
  }

  async function listStatuses(key = projectKey) {
    const data = await api(`/rest/api/2/project/${key}/statuses`);
    return data.map((it) => ({ type: it.name, statuses: it.statuses.map((s) => s.name) }));
  }

  async function createIssue({ summary, description = '', type } = {}) {
    if (!summary) throw new TrackerError('createIssue requires a summary');
    const body = await api('/rest/api/2/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary,
          description,
          issuetype: { name: type || issueTypes.story },
        },
      }),
    });
    return body.key;
  }

  async function createSubIssue({ parentKey, summary, description = '', type } = {}) {
    if (!parentKey) throw new TrackerError('createSubIssue requires a parentKey');
    if (!summary) throw new TrackerError('createSubIssue requires a summary');
    const body = await api('/rest/api/2/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          parent: { key: parentKey },
          summary,
          description,
          issuetype: { name: type || issueTypes.subtask },
        },
      }),
    });
    return body.key;
  }

  async function get(key) {
    const data = await api(`/rest/api/2/issue/${key}?fields=summary,description,status,assignee,parent,subtasks`);
    return {
      key: data.key,
      summary: data.fields.summary,
      description: data.fields.description,
      status: data.fields.status ? data.fields.status.name : null,
      assignee: data.fields.assignee ? data.fields.assignee.name : null,
      parent: data.fields.parent ? data.fields.parent.key : null,
      subtasks: (data.fields.subtasks || []).map((s) => s.key),
    };
  }

  async function setFields(key, fields = {}) {
    const payload = {};
    if (fields.summary !== undefined) payload.summary = fields.summary;
    if (fields.description !== undefined) payload.description = fields.description;
    if (Object.keys(payload).length === 0) {
      throw new TrackerError('setFields requires at least one of: summary, description');
    }
    await api(`/rest/api/2/issue/${key}`, { method: 'PUT', body: JSON.stringify({ fields: payload }) });
    return key;
  }

  // Append rather than overwrite: the workflow adds one short summary per step to
  // the parent issue, and earlier steps' text has to survive.
  async function appendDescription(key, text) {
    if (!text) throw new TrackerError('appendDescription requires text');
    const current = await api(`/rest/api/2/issue/${key}?fields=description`);
    const existing = current.fields.description || '';
    const updated = existing ? `${existing}\n\n${text}` : text;
    await api(`/rest/api/2/issue/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { description: updated } }),
    });
    return updated;
  }

  // Returns { key, from, to, changed }. Already being in the target status is a
  // success with changed:false, not an error — re-running a step must be safe.
  async function setStatus(key, statusName) {
    if (!statusName) throw new TrackerError('setStatus requires a status name');
    const wanted = statusName.toLowerCase();
    const data = await api(`/rest/api/2/issue/${key}/transitions`);
    const match = data.transitions.find(
      (t) => t.name.toLowerCase() === wanted || (t.to && t.to.name.toLowerCase() === wanted),
    );
    if (!match) {
      const current = await api(`/rest/api/2/issue/${key}?fields=status`);
      const from = current.fields.status ? current.fields.status.name : null;
      if (from && from.toLowerCase() === wanted) {
        return { key, from, to: from, changed: false };
      }
      throw new NoTransitionError(
        `No transition to "${statusName}" from "${from}" for ${key}`,
        { from, available: data.transitions.map((t) => `${t.name} -> ${t.to ? t.to.name : '?'}`) },
      );
    }
    await api(`/rest/api/2/issue/${key}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    return { key, to: match.to ? match.to.name : statusName, changed: true };
  }

  // Move an issue and all of its subtasks. Subtasks go first: most workflows
  // refuse to close a parent while children are open. Subtask failures are
  // collected rather than thrown so one stuck child doesn't strand the rest.
  async function closeIssue(key, statusName = 'Done') {
    const issue = await get(key);
    const results = [];
    for (const subKey of issue.subtasks) {
      try {
        results.push({ ...(await setStatus(subKey, statusName)), ok: true });
      } catch (err) {
        if (!(err instanceof NoTransitionError)) throw err;
        results.push({ key: subKey, ok: false, reason: err.message });
      }
    }
    try {
      results.push({ ...(await setStatus(key, statusName)), ok: true });
    } catch (err) {
      if (!(err instanceof NoTransitionError)) throw err;
      results.push({ key, ok: false, reason: err.message });
    }
    return { key, status: statusName, results, failed: results.filter((r) => !r.ok).length };
  }

  async function setAssignee(key, username) {
    if (!username) throw new TrackerError('setAssignee requires a username');
    await api(`/rest/api/2/issue/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { assignee: { name: username } } }),
    });
    return { key, assignee: username };
  }

  // Markdown -> Jira wiki markup. This used to be a per-repo prose document
  // (`ai/JIRA_MARKUP.md`, three variants) telling agents to convert by hand.
  // Conversion is deterministic, so it belongs in code where it can't drift.
  // The conversion table it implements lives in those repos' `ai/JIRA_MARKUP.md`
  // and `ai/TASK_TRACKER_MARKUP.md` — headings, bold/italic/strikethrough, inline
  // and fenced code, links, blockquotes, nested lists, rules, and pipe tables.
  function toMarkupInline(s) {
    // Jira uses `*` for bold and `_` for italic. One pass handles `**b**` and
    // `*i*`: group 1 captures which marker it was, the \s guards stop a bullet
    // line ("* item") being read as emphasis, and the non-greedy body keeps
    // `**b** and *i*` from matching as a single span.
    s = s.replace(/(\*\*?)(?!\s)([^*\n]+?)(?<!\s)\1/g, (_, m, t) =>
      m === '**' ? `*${t}*` : `_${t}_`,
    );
    s = s.replace(/~~([^~]+)~~/g, '-$1-');
    s = s.replace(/`([^`]+)`/g, '{{$1}}');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');
    return s;
  }

  function toMarkup(markdown) {
    const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let inFence = false;

    const ROW = /^\s*\|(.+)\|\s*$/;
    const isSep = (l) => l !== undefined && l.includes('|') && l.includes('-') && /^[\s|:-]+$/.test(l.trim());
    const cells = (l) => l.match(ROW)[1].split('|').map((c) => toMarkupInline(c.trim()));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        out.push(inFence ? '{code}' : fence[1] ? `{code:${fence[1]}}` : '{code}');
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        out.push(line);
        continue;
      }

      // Pipe table: a row followed by a `|---|---|` separator. Header cells take
      // `||`, body cells `|`, and the separator row is dropped (Jira has none).
      if (ROW.test(line) && isSep(lines[i + 1])) {
        out.push(`||${cells(line).join('||')}||`);
        i++; // consume the separator
        while (ROW.test(lines[i + 1]) && !isSep(lines[i + 1])) {
          out.push(`|${cells(lines[++i]).join('|')}|`);
        }
        continue;
      }

      let s = line;
      s = s.replace(/^(#{1,6})\s+(.*)$/, (_, h, rest) => `h${h.length}. ${rest}`);
      s = s.replace(/^\s*>\s?(.*)$/, 'bq. $1');
      s = s.replace(/^(\s*)[-*]\s+/, (_, indent) => '*'.repeat(Math.floor(indent.length / 2) + 1) + ' ');
      s = s.replace(/^(\s*)\d+\.\s+/, (_, indent) => '#'.repeat(Math.floor(indent.length / 2) + 1) + ' ');
      s = s.replace(/^---+$/, '----');
      if (s !== '----') s = toMarkupInline(s);
      out.push(s);
    }
    return out.join('\n');
  }

  return {
    name: 'jira-server',
    projectKey,
    issueTypes,
    listProjects,
    listStatuses,
    createIssue,
    createSubIssue,
    link: async () => {
      throw new TrackerError('link is not implemented for jira-server yet');
    },
    get,
    setFields,
    appendDescription,
    setStatus,
    closeIssue,
    setAssignee,
    toMarkup,
  };
}

module.exports = { createJiraServer, TrackerError, NoTransitionError, CREDENTIAL_ENV: REQUIRED_ENV };
