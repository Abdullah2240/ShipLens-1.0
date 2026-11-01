// Checks that a demo dataset obeys the rules the app and the database guards enforce.
// validateDemoData(data) returns a list of problem strings; empty means valid.
import { DATA_AS_OF, DEMO_WEEKS } from './generate.mjs';

const DAY_MS = 86400000;
const PKT_OFFSET_MS = 5 * 3600000;
const LOCK_DAYS = 7;

const MONEY_RE = /^\d+\.\d{2}$/;
const PHONE_RE = /^0300000\d{4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_SUFFIX = '@shiplens.test';

const DEMO_USER_KEYS = ['admin', 'editor', 'finance', 'hr', 'lead'];
const ROLES = ['super_admin', 'finance_reviewer', 'content_editor', 'branch_lead', 'hr_lead'];
const BRANCH_ROLES = ['branch_lead', 'hr_lead'];
const BRANCH_STATUSES = ['forming', 'active', 'paused', 'closed'];
const REPORT_STATUSES = ['draft', 'submitted', 'returned', 'approved'];
const APPLICATION_STATUSES = ['pending', 'accepted', 'declined'];
const MEMBER_STATUSES = ['active', 'inactive', 'left'];
const MEMBER_ROLES = ['volunteer', 'team_lead', 'coordinator', 'mentor'];

const TRANSITIONS = [
  { from: 'draft', event: 'submitted', to: 'submitted' },
  { from: 'returned', event: 'resubmitted', to: 'submitted' },
  { from: 'submitted', event: 'returned', to: 'returned' },
  { from: 'submitted', event: 'approved', to: 'approved' },
];

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function pktDate(iso) {
  return new Date(Date.parse(iso) + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

function minorOf(amount) {
  return BigInt(amount.replace('.', ''));
}

export function validateDemoData(data) {
  const problems = [];
  const problem = (message) => problems.push(message);
  const asOfEndMs = Date.parse(`${addDays(DATA_AS_OF, 1)}T00:00:00.000Z`) - PKT_OFFSET_MS;
  const afterAsOf = (iso) => Date.parse(iso) >= asOfEndMs;

  const ids = new Set();
  const uniqueId = (kind, id) => {
    if (typeof id !== 'string' || !UUID_RE.test(id)) problem(`${kind} ${id}: id is not a v4 uuid`);
    if (ids.has(id)) problem(`${kind} ${id}: duplicate id`);
    ids.add(id);
  };
  const checkEmail = (kind, id, email) => {
    if (
      typeof email !== 'string' ||
      !email.endsWith(EMAIL_SUFFIX) ||
      email !== email.toLowerCase()
    ) {
      problem(`${kind} ${id}: email ${email} must be lower case and end with ${EMAIL_SUFFIX}`);
    }
  };
  const checkPhone = (kind, id, phone) => {
    if (phone !== null && !PHONE_RE.test(phone))
      problem(`${kind} ${id}: phone ${phone} is not 0300000 + 4 digits`);
  };

  // Branches
  const branchByKey = new Map();
  for (const b of data.branches) {
    if (branchByKey.has(b.key)) problem(`branch ${b.key}: duplicate key`);
    branchByKey.set(b.key, b);
    if (typeof b.name !== 'string' || !b.name.endsWith('(Demo)'))
      problem(`branch ${b.key}: name must end with (Demo)`);
    if (!BRANCH_STATUSES.includes(b.status)) problem(`branch ${b.key}: unknown status ${b.status}`);
  }
  const names = data.branches.map((b) => b.name.toLowerCase());
  if (new Set(names).size !== names.length) problem('branches: names are not unique');

  // Users
  const userByKey = new Map();
  for (const u of data.users) {
    if (userByKey.has(u.key)) problem(`user ${u.key}: duplicate key`);
    userByKey.set(u.key, u);
    checkEmail('user', u.key, u.email);
    if (!ROLES.includes(u.role)) problem(`user ${u.key}: unknown role ${u.role}`);
    if (BRANCH_ROLES.includes(u.role) && !branchByKey.has(u.branchKey)) {
      problem(`user ${u.key}: branch role without a known branch`);
    }
    if (!BRANCH_ROLES.includes(u.role) && u.branchKey !== null) {
      problem(`user ${u.key}: head-office role must not have a branch`);
    }
  }
  const emails = data.users.map((u) => u.email.toLowerCase());
  if (new Set(emails).size !== emails.length) problem('users: emails are not unique');
  const existingKeys = data.users
    .filter((u) => u.existing === true)
    .map((u) => u.key)
    .sort();
  if (existingKeys.join(',') !== DEMO_USER_KEYS.join(',')) {
    problem(
      `users: existing users must be exactly ${DEMO_USER_KEYS.join(', ')} (got ${existingKeys.join(', ')})`,
    );
  }
  const isLeadOf = (key, branchKey) => {
    const u = userByKey.get(key);
    return Boolean(u) && u.role === 'branch_lead' && u.branchKey === branchKey;
  };
  const isFinance = (key) => userByKey.get(key)?.role === 'finance_reviewer';

  // Reports
  const reportById = new Map();
  const reportWeeks = new Set();
  for (const r of data.reports) {
    uniqueId('report', r.id);
    reportById.set(r.id, r);
    const branch = branchByKey.get(r.branchKey);
    if (!branch) problem(`report ${r.id}: unknown branch ${r.branchKey}`);
    if (
      !DEMO_WEEKS.includes(r.weekStart) ||
      new Date(`${r.weekStart}T00:00:00.000Z`).getUTCDay() !== 1
    ) {
      problem(`report ${r.id}: weekStart ${r.weekStart} is not a Monday in DEMO_WEEKS`);
    }
    const weekKey = `${r.branchKey}|${r.weekStart}`;
    if (reportWeeks.has(weekKey)) problem(`report ${r.id}: more than one report for ${weekKey}`);
    reportWeeks.add(weekKey);
    if (!REPORT_STATUSES.includes(r.status)) problem(`report ${r.id}: unknown status ${r.status}`);
    if (branch?.status === 'forming')
      problem(`report ${r.id}: forming branch ${r.branchKey} has a report`);
    if (branch?.status === 'closed' && r.status !== 'approved') {
      problem(`report ${r.id}: closed branch ${r.branchKey} has a ${r.status} report`);
    }
    if (branch?.status === 'paused' && (r.status === 'draft' || r.status === 'returned')) {
      problem(`report ${r.id}: paused branch ${r.branchKey} has a ${r.status} report`);
    }
    if (typeof r.confirmNil !== 'boolean') problem(`report ${r.id}: confirmNil must be a boolean`);
  }

  const collectionsByReport = new Map();
  for (const c of data.collections) {
    if (!collectionsByReport.has(c.reportId)) collectionsByReport.set(c.reportId, []);
    collectionsByReport.get(c.reportId).push(c);
  }

  // History replay and per-report timing rules
  const approvedAtByReport = new Map();
  const openWindowsByReport = new Map();
  for (const r of data.reports) {
    const collections = collectionsByReport.get(r.id) ?? [];
    let status = 'draft';
    let prevMs = -Infinity;
    const windows = [];
    let openFrom = -Infinity;
    for (const [index, h] of (r.history ?? []).entries()) {
      const label = `report ${r.id}: history[${index}] ${h.event}`;
      const transition = TRANSITIONS.find((t) => t.from === status && t.event === h.event);
      if (!transition) {
        problem(`${label}: invalid transition from ${status}`);
        break;
      }
      if (!isInstant(h.at)) {
        problem(`${label}: at ${h.at} is not an ISO UTC instant`);
        break;
      }
      const ms = Date.parse(h.at);
      if (!(ms > prevMs)) problem(`${label}: ${h.at} is not strictly after the previous event`);
      if (afterAsOf(h.at)) problem(`${label}: ${h.at} is after DATA_AS_OF`);
      prevMs = ms;
      if (h.event === 'submitted' || h.event === 'resubmitted') {
        if (!isLeadOf(h.actorKey, r.branchKey)) {
          problem(`${label}: actor ${h.actorKey} is not a branch_lead of ${r.branchKey}`);
        }
        windows.push([openFrom, ms]);
        const activeAtSubmit = collections.filter(
          (c) =>
            Date.parse(c.createdAt) < ms &&
            !(c.status === 'voided' && c.voidedAt && Date.parse(c.voidedAt) < ms),
        ).length;
        if (activeAtSubmit === 0 && r.confirmNil !== true) {
          problem(`${label}: submitted with no active collections but confirmNil is not true`);
        }
      } else {
        if (!isFinance(h.actorKey))
          problem(`${label}: actor ${h.actorKey} is not a finance_reviewer`);
        if (h.event === 'returned') {
          const reason = typeof h.reason === 'string' ? h.reason.trim() : '';
          if (reason.length < 3 || reason.length > 500)
            problem(`${label}: return reason must be 3..500 characters`);
          openFrom = ms;
        }
        if (h.event === 'approved') approvedAtByReport.set(r.id, ms);
      }
      status = transition.to;
    }
    if (status !== r.status)
      problem(`report ${r.id}: history ends at ${status} but status is ${r.status}`);
    if (status === 'draft' || status === 'returned') windows.push([openFrom, asOfEndMs]);
    openWindowsByReport.set(r.id, windows);

    const first = r.history?.[0];
    if (first && isInstant(first.at)) {
      for (const c of collections) {
        if (Date.parse(c.createdAt) >= Date.parse(first.at)) {
          problem(`report ${r.id}: history starts before collection ${c.id} was created`);
        }
      }
    }
  }

  // Collections
  for (const c of data.collections) {
    uniqueId('collection', c.id);
    const label = `collection ${c.id}`;
    const report = reportById.get(c.reportId);
    if (!report) {
      problem(`${label}: unknown report ${c.reportId}`);
      continue;
    }
    if (c.branchKey !== report.branchKey)
      problem(`${label}: branch differs from its report branch`);
    if (!isDate(c.collectedOn)) {
      problem(`${label}: collectedOn ${c.collectedOn} is not a date`);
    } else {
      if (c.collectedOn < report.weekStart || c.collectedOn > addDays(report.weekStart, 6)) {
        problem(
          `${label}: collectedOn ${c.collectedOn} is outside its report week ${report.weekStart}`,
        );
      }
      if (c.collectedOn > DATA_AS_OF)
        problem(`${label}: collectedOn ${c.collectedOn} is after DATA_AS_OF`);
    }
    if (typeof c.amount !== 'string' || !MONEY_RE.test(c.amount)) {
      problem(`${label}: amount ${c.amount} is not a 2-decimal string`);
    } else if (minorOf(c.amount) <= 0n) {
      problem(`${label}: amount must be greater than zero`);
    }
    if (typeof c.purpose !== 'string' || c.purpose.trim() === '')
      problem(`${label}: purpose is required`);
    if (!isLeadOf(c.createdByKey, c.branchKey)) {
      problem(`${label}: createdByKey ${c.createdByKey} is not a branch_lead of ${c.branchKey}`);
    }
    if (!isInstant(c.createdAt)) {
      problem(`${label}: createdAt ${c.createdAt} is not an ISO UTC instant`);
    } else {
      const createdOn = pktDate(c.createdAt);
      if (createdOn < c.collectedOn || createdOn > addDays(c.collectedOn, LOCK_DAYS)) {
        problem(`${label}: created on ${createdOn}, outside the lock window of ${c.collectedOn}`);
      }
      if (afterAsOf(c.createdAt)) problem(`${label}: createdAt is after DATA_AS_OF`);
    }

    if (c.status === 'voided') {
      if (!c.voidReason || !c.voidedAt) problem(`${label}: voided without voidReason or voidedAt`);
      if (c.voidedAt) {
        const ms = Date.parse(c.voidedAt);
        if (!(ms > Date.parse(c.createdAt))) problem(`${label}: voidedAt is not after createdAt`);
        if (afterAsOf(c.voidedAt)) problem(`${label}: voidedAt is after DATA_AS_OF`);
        const windows = openWindowsByReport.get(report.id) ?? [];
        if (!windows.some(([from, to]) => ms > from && ms < to)) {
          problem(`${label}: voided while its report was not open`);
        }
      }
    } else if (c.status === 'active') {
      if (c.voidReason !== null || c.voidedAt !== null)
        problem(`${label}: active but has void fields`);
    } else {
      problem(`${label}: unknown status ${c.status}`);
    }

    if (c.routedAt !== null) {
      const approvedAt = approvedAtByReport.get(report.id);
      if (c.status !== 'active' || report.status !== 'approved' || approvedAt === undefined) {
        problem(`${label}: routed but not an active collection of an approved report`);
      } else if (!(Date.parse(c.routedAt) > approvedAt)) {
        problem(`${label}: routed before its report was approved`);
      }
      if (afterAsOf(c.routedAt)) problem(`${label}: routedAt is after DATA_AS_OF`);
      if (!isFinance(c.routedByKey))
        problem(`${label}: routedByKey ${c.routedByKey} is not a finance_reviewer`);
    } else if (c.routedByKey !== null) {
      problem(`${label}: routedByKey set without routedAt`);
    }
  }

  // Teams
  const teamById = new Map();
  const teamNames = new Set();
  for (const t of data.teams) {
    uniqueId('team', t.id);
    teamById.set(t.id, t);
    if (!branchByKey.has(t.branchKey)) problem(`team ${t.id}: unknown branch ${t.branchKey}`);
    const nameKey = `${t.branchKey}|${t.name.toLowerCase()}`;
    if (teamNames.has(nameKey)) problem(`team ${t.id}: duplicate name in ${t.branchKey}`);
    teamNames.add(nameKey);
  }

  // Applications
  const applicationById = new Map();
  for (const a of data.applications) {
    uniqueId('application', a.id);
    applicationById.set(a.id, a);
    const label = `application ${a.id}`;
    if (!branchByKey.has(a.branchKey)) problem(`${label}: unknown branch ${a.branchKey}`);
    checkEmail('application', a.id, a.email);
    checkPhone('application', a.id, a.phone);
    if (!APPLICATION_STATUSES.includes(a.status)) problem(`${label}: unknown status ${a.status}`);
    if (afterAsOf(a.createdAt)) problem(`${label}: createdAt is after DATA_AS_OF`);
    if (a.status === 'pending') {
      if (a.decidedByKey !== null || a.decidedAt !== null)
        problem(`${label}: pending but has a decision`);
    } else {
      const decider = userByKey.get(a.decidedByKey);
      const allowed =
        decider &&
        (decider.role === 'super_admin' ||
          (decider.role === 'hr_lead' && decider.branchKey === a.branchKey));
      if (!allowed)
        problem(`${label}: decidedByKey ${a.decidedByKey} may not decide for ${a.branchKey}`);
      if (
        !a.decidedAt ||
        !(Date.parse(a.decidedAt) > Date.parse(a.createdAt)) ||
        afterAsOf(a.decidedAt)
      ) {
        problem(`${label}: decidedAt must fall after createdAt and by DATA_AS_OF`);
      }
    }
  }

  // Members
  const membersPerApplication = new Map();
  for (const m of data.members) {
    uniqueId('member', m.id);
    const label = `member ${m.id}`;
    if (!branchByKey.has(m.branchKey)) problem(`${label}: unknown branch ${m.branchKey}`);
    if (m.email !== null) checkEmail('member', m.id, m.email);
    checkPhone('member', m.id, m.phone);
    if (!MEMBER_ROLES.includes(m.memberRole)) problem(`${label}: unknown role ${m.memberRole}`);
    if (!MEMBER_STATUSES.includes(m.status)) problem(`${label}: unknown status ${m.status}`);
    if (m.joinedOn !== null && (!isDate(m.joinedOn) || m.joinedOn > DATA_AS_OF)) {
      problem(`${label}: joinedOn ${m.joinedOn} is not a date by DATA_AS_OF`);
    }
    if (m.teamId !== null) {
      const team = teamById.get(m.teamId);
      if (!team) problem(`${label}: unknown team ${m.teamId}`);
      else if (team.branchKey !== m.branchKey)
        problem(`${label}: team ${m.teamId} belongs to another branch`);
    }
    if (m.applicationId !== null) {
      const app = applicationById.get(m.applicationId);
      if (!app || app.status !== 'accepted' || app.branchKey !== m.branchKey) {
        problem(`${label}: must link to an accepted application of the same branch`);
      }
      membersPerApplication.set(
        m.applicationId,
        (membersPerApplication.get(m.applicationId) ?? 0) + 1,
      );
    }
  }
  for (const a of data.applications) {
    if (a.status === 'accepted' && membersPerApplication.get(a.id) !== 1) {
      problem(`application ${a.id}: accepted applications need exactly one member`);
    }
  }

  return problems;
}
