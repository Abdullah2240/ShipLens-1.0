import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { getEnv } from '@/platform/config/env';
import { addDays, pktDate, pktWeekStart } from '@/platform/time';
import { hashPassword } from '../../../scripts/lib/password.mjs';
import { resetDb, seedBranch, seedUser, testPool } from '../../support/db';
import { seedReport } from '../../support/finance-fixtures';
import { createSessionCookie } from '../../support/session';
import { isMutation, paramsFor, pathFor, type Handler } from '../registry';
import type { EndpointSpec, Side, World, WorldUserKey } from '../registry/types';

const LOGIN_PASSWORD = 'matrix-login-password-2026';
let loginHash: Promise<string> | undefined;

async function insertId(pool: Pool, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, params);
  return rows[0]!.id;
}

async function audit(
  pool: Pool,
  row: {
    actorId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    branchId: string;
    reportId: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)`,
    [
      row.actorId,
      row.actorRole,
      row.action,
      row.entityType,
      row.entityId,
      row.branchId,
      row.reportId,
    ],
  );
}

/**
 * Resets the database and builds two active branches (A and B), one user per role in A,
 * a Branch Lead and an HR Lead in B, a session per user, and in both branches: a draft
 * report for the current PKT week holding one active collection dated today, a submitted
 * report for the previous week, an approved report two weeks back holding one unrouted and
 * one routed active collection (reviewed by the Finance Reviewer), a pending application, a
 * team, a member, and audit rows for the report and collection timelines. Branchless: one published event and one
 * published content entry (about/en).
 */
export async function buildWorld(pool: Pool = testPool()): Promise<World> {
  await resetDb(pool);
  const branchA = (await seedBranch(pool, { name: 'Matrix Alpha', status: 'active' })).id;
  const branchB = (await seedBranch(pool, { name: 'Matrix Bravo', status: 'active' })).id;

  const plan: Array<[WorldUserKey, string, string | null]> = [
    ['super_admin', 'super_admin', null],
    ['finance_reviewer', 'finance_reviewer', null],
    ['content_editor', 'content_editor', null],
    ['branch_lead', 'branch_lead', branchA],
    ['hr_lead', 'hr_lead', branchA],
    ['branch_lead_b', 'branch_lead', branchB],
    ['hr_lead_b', 'hr_lead', branchB],
  ];
  const users = {} as World['users'];
  for (const [key, role, branchId] of plan) {
    const user = await seedUser(pool, { role, branchId, email: `${key}@matrix.test` });
    users[key] = { id: user.id, cookie: await createSessionCookie(pool, user.id) };
  }

  loginHash ??= hashPassword(LOGIN_PASSWORD);
  const loginEmail = 'login.user@matrix.test';
  await pool.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Matrix Login', $2, 'content_editor')`,
    [loginEmail, await loginHash],
  );

  const today = pktDate(new Date());
  const weekStart = pktWeekStart(today);
  const previousWeek = addDays(weekStart, -7);

  const records: World['records'] = {
    branch: { A: branchA, B: branchB },
    report_draft: { A: '', B: '' },
    report_submitted: { A: '', B: '' },
    collection: { A: '', B: '' },
    application: { A: '', B: '' },
    team: { A: '', B: '' },
    member: { A: '', B: '' },
    collection_approved: { A: '', B: '' },
    collection_routed: { A: '', B: '' },
  };

  for (const side of ['A', 'B'] as const) {
    const branchId = side === 'A' ? branchA : branchB;
    const lead = side === 'A' ? users.branch_lead : users.branch_lead_b;

    const draft = await seedReport(pool, {
      branchId,
      weekStart,
      collections: [
        { amount: '250.00', collectedOn: today, purpose: `Matrix ${side}`, createdBy: lead.id },
      ],
    });
    const submitted = await seedReport(pool, {
      branchId,
      weekStart: previousWeek,
      status: 'submitted',
      submittedBy: lead.id,
      collections: [{ amount: '400.00', purpose: `Matrix ${side} last week`, createdBy: lead.id }],
    });
    records.report_draft![side] = draft.reportId;
    records.report_submitted![side] = submitted.reportId;
    records.collection![side] = draft.collectionIds[0]!;

    // Routing targets: only an active collection of an approved report can be marked routed.
    const approved = await seedReport(pool, {
      branchId,
      weekStart: addDays(weekStart, -14),
      status: 'approved',
      submittedBy: lead.id,
      reviewedBy: users.finance_reviewer.id,
      collections: [
        { amount: '300.00', purpose: `Matrix ${side} approved`, createdBy: lead.id },
        {
          amount: '150.00',
          purpose: `Matrix ${side} routed`,
          createdBy: lead.id,
          routedAt: new Date().toISOString(),
        },
      ],
    });
    records.collection_approved![side] = approved.collectionIds[0]!;
    records.collection_routed![side] = approved.collectionIds[1]!;

    const base = { actorId: lead.id, actorRole: 'branch_lead', branchId };
    await audit(pool, {
      ...base,
      action: 'report.create_draft',
      entityType: 'report',
      entityId: draft.reportId,
      reportId: draft.reportId,
    });
    await audit(pool, {
      ...base,
      action: 'collection.create',
      entityType: 'collection',
      entityId: draft.collectionIds[0]!,
      reportId: draft.reportId,
    });
    await audit(pool, {
      ...base,
      action: 'report.submit',
      entityType: 'report',
      entityId: submitted.reportId,
      reportId: submitted.reportId,
    });

    records.team![side] = await insertId(
      pool,
      'INSERT INTO teams (branch_id, name) VALUES ($1, $2) RETURNING id',
      [branchId, `Matrix Team ${side}`],
    );
    records.member![side] = await insertId(
      pool,
      `INSERT INTO members (branch_id, member_code, full_name, team_id, status, joined_on)
       VALUES ($1, $2, $3, $4, 'active', $5) RETURNING id`,
      [branchId, `MX-${side}-0001`, `Matrix Member ${side}`, records.team![side], today],
    );
    records.application![side] = await insertId(
      pool,
      `INSERT INTO applications (branch_id, full_name, email, status)
       VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [branchId, `Matrix Applicant ${side}`, `applicant.${side.toLowerCase()}@matrix.test`],
    );
  }

  const eventId = await insertId(
    pool,
    `INSERT INTO events (slug, title_en, starts_at, status, published_at,
                         published_title_en, published_starts_at)
     VALUES ('matrix-event', 'Matrix Event', now() + interval '7 days', 'published', now(),
             'Matrix Event', now() + interval '7 days')
     RETURNING id`,
    [],
  );
  records.event = { A: eventId, B: eventId };
  await pool.query(
    `INSERT INTO content_entries (key, locale, title, body, status, published_at, published_title, published_body)
     VALUES ('about', 'en', 'About draft', 'About draft body', 'published', now(), 'About', 'About body')`,
  );

  return {
    branchA,
    branchB,
    users,
    records,
    today,
    weekStart,
    login: { email: loginEmail, password: LOGIN_PASSWORD },
  };
}

// Tables compared before and after a refused call. sessions and login_attempts are left
// out: reading a session may touch last_seen_at.
const FINGERPRINT_TABLES = [
  'users',
  'branches',
  'weekly_reports',
  'collections',
  'report_events',
  'applications',
  'teams',
  'members',
  'content_entries',
  'events',
  'audit_events',
];

/** Row count and content hash of every domain table: equal fingerprints mean nothing was written. */
export async function dbFingerprint(pool: Pool = testPool()): Promise<Record<string, string>> {
  const sql = FINGERPRINT_TABLES.map(
    (t) =>
      `SELECT '${t}' AS t, count(*)::int AS n,
              md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x`,
  ).join(' UNION ALL ');
  const { rows } = await pool.query<{ t: string; n: number; h: string }>(sql);
  return Object.fromEntries(rows.map((r) => [r.t, `${r.n}:${r.h}`]));
}

export const API_BASE = 'http://localhost:3000/api/v1';
export const NO_BODY = Symbol('no body');
let callSeq = 0;

export interface CallOptions {
  /** Session cookie; omitted means no session. */
  cookie?: string;
  /** Which branch's record the route params point at (default A). */
  side?: Side;
  params?: Record<string, string>;
  /** Overrides spec.body; NO_BODY sends none. */
  body?: unknown;
  /** Origin header for mutations; default APP_ORIGIN, null sends none. */
  origin?: string | null;
  query?: Record<string, string>;
}

/**
 * Calls the real route handler. Every request also carries headers a client might use to
 * claim a role or branch; the route must ignore them (role and branch come only from the
 * session row).
 */
export function callEndpoint(
  handler: Handler,
  spec: EndpointSpec,
  w: World,
  opts: CallOptions = {},
): Promise<Response> {
  const params = opts.params ?? paramsFor(spec, w, opts.side ?? 'A');
  const body = opts.body !== undefined ? opts.body : spec.body ? spec.body(w) : NO_BODY;
  const origin = opts.origin === undefined ? getEnv().APP_ORIGIN : opts.origin;
  const url = new URL(`${API_BASE}/${pathFor(spec, params)}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  callSeq += 1;
  const headers: Record<string, string> = {
    'x-forwarded-for': `2001:db8::${callSeq.toString(16)}`,
    'x-role': 'super_admin',
    'x-user-role': 'super_admin',
    'x-branch-id': w.branchB,
    'x-user-id': w.users.super_admin.id,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (isMutation(spec) && origin) headers.origin = origin;
  if (body !== NO_BODY) headers['content-type'] = 'application/json';
  return handler(
    new Request(url, {
      method: spec.method,
      headers,
      ...(body !== NO_BODY ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve(params) },
  );
}

/** An error body with its requestId removed, for comparing two 404s. */
export function withoutRequestId(body: unknown): unknown {
  const copy = structuredClone(body) as { error?: Record<string, unknown> };
  if (copy.error) delete copy.error.requestId;
  return copy;
}

/** The record id in params swapped for another value (a random UUID by default). */
export function swapRecordId(
  params: Record<string, string>,
  recordId: string,
  replacement: string = randomUUID(),
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, v === recordId ? replacement : v]),
  );
}

/** Items of a list body: the data array itself or data.items. */
export function listItems(body: unknown): Array<Record<string, unknown>> {
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  const items = (data as { items?: unknown } | undefined)?.items;
  if (Array.isArray(items)) return items as Array<Record<string, unknown>>;
  throw new Error('response body is not a list');
}
