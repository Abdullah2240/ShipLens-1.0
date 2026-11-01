import { randomUUID } from 'node:crypto';
import * as applicationAcceptRoute from '@/app/api/v1/applications/[id]/accept/route';
import * as branchStatusRoute from '@/app/api/v1/branches/[id]/status/route';
import * as collectionRoute from '@/app/api/v1/collections/[id]/route';
import * as collectionVoidRoute from '@/app/api/v1/collections/[id]/void/route';
import * as collectionsRoute from '@/app/api/v1/collections/route';
import * as reportApproveRoute from '@/app/api/v1/reports/[id]/approve/route';
import * as reportReturnRoute from '@/app/api/v1/reports/[id]/return/route';
import * as reportRoute from '@/app/api/v1/reports/[id]/route';
import * as reportSubmitRoute from '@/app/api/v1/reports/[id]/submit/route';
import * as reportsRoute from '@/app/api/v1/reports/route';
import type { CommandContext } from '@/platform/audit/types';
import type { Role } from '@/platform/authz/roles';
import { getEnv } from '@/platform/config/env';
import { addDays, pktDate, pktWeekStart, type Clock, type DateString } from '@/platform/time';
import { resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

export const db = testPool();

export interface User {
  id: string;
  cookie: string;
  role: Role;
  branchId: string | null;
}

export interface World {
  branchA: string;
  branchB: string;
  leadA: User;
  leadB: User;
  finance1: User;
  finance2: User;
  admin: User;
  hrA: User;
  hrA2: User;
}

async function user(role: Role, branchId: string | null = null): Promise<User> {
  const row = await seedUser(db, { role, branchId });
  return {
    id: row.id,
    cookie: await createSessionCookie(db, row.id),
    role,
    branchId: row.branch_id,
  };
}

/** Empty database, two active branches and one signed-in user per role the suite needs. */
export async function lifecycleWorld(): Promise<World> {
  await resetDb(db);
  const a = await seedBranch(db, { name: 'Alpha Branch', status: 'active' });
  const b = await seedBranch(db, { name: 'Bravo Branch', status: 'active' });
  return {
    branchA: a.id,
    branchB: b.id,
    leadA: await user('branch_lead', a.id),
    leadB: await user('branch_lead', b.id),
    finance1: await user('finance_reviewer'),
    finance2: await user('finance_reviewer'),
    admin: await user('super_admin'),
    hrA: await user('hr_lead', a.id),
    hrA2: await user('hr_lead', a.id),
  };
}

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Method = 'GET' | 'POST' | 'PATCH';

// The real route modules, keyed by their path under /api/v1.
const ROUTES: Record<string, Partial<Record<Method, Handler>>> = {
  collections: collectionsRoute,
  'collections/[id]': collectionRoute,
  'collections/[id]/void': collectionVoidRoute,
  reports: reportsRoute,
  'reports/[id]': reportRoute,
  'reports/[id]/submit': reportSubmitRoute,
  'reports/[id]/return': reportReturnRoute,
  'reports/[id]/approve': reportApproveRoute,
  'branches/[id]/status': branchStatusRoute,
  'applications/[id]/accept': applicationAcceptRoute,
};

export type RouteModule =
  | 'collections'
  | 'collections/[id]'
  | 'collections/[id]/void'
  | 'reports'
  | 'reports/[id]'
  | 'reports/[id]/submit'
  | 'reports/[id]/return'
  | 'reports/[id]/approve'
  | 'branches/[id]/status'
  | 'applications/[id]/accept';

/** A response body read loosely: every value reached through it is checked by an assertion. */
export interface Json {
  readonly [key: string]: Json | undefined;
  readonly data: Json;
  readonly error: Json;
  readonly details: Json;
  readonly items: Json;
}

export interface CallOptions {
  cookie?: string;
  body?: unknown;
  params?: Record<string, string>;
  /** Send the APP_ORIGIN Origin header on a mutating call. Defaults to true. */
  origin?: boolean;
  requestId?: string;
}

/** Calls a route handler the way Next.js would, with the test APP_ORIGIN as Origin. */
export async function call(
  mod: RouteModule,
  method: Method,
  path: string,
  opts: CallOptions = {},
): Promise<{ status: number; json: Json; requestId: string | null }> {
  const handler = ROUTES[mod]?.[method];
  if (!handler) throw new Error(`no ${method} handler in ${mod}`);
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== 'GET' && opts.origin !== false) headers.origin = getEnv().APP_ORIGIN;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.requestId) headers['x-request-id'] = opts.requestId;
  const res = await handler(
    new Request(`http://localhost:3000/api/v1${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : {}) as Json,
    requestId: res.headers.get('x-request-id'),
  };
}

/** One fresh context per call: concurrent calls never share one. */
export function ctxFor(
  userId: string,
  role: Role,
  branchId: string | null,
  clock: Clock,
): CommandContext {
  return { actor: { userId, role, branchId }, requestId: randomUUID(), clock, pool: db };
}

export function ctxOf(u: User, clock: Clock): CommandContext {
  return ctxFor(u.id, u.role, u.branchId, clock);
}

export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: string }>(sql, params);
  return Number(rows[0]!.n);
}

/** Today on the PKT calendar; HTTP routes run on the system clock. */
export const today = (): DateString => pktDate(new Date());
export const currentWeek = (): DateString => pktWeekStart(today());
export const pastWeek = (weeks: number): DateString => addDays(currentWeek(), -7 * weeks);

export async function seedApplication(branchId: string, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO applications (branch_id, full_name, email, phone, message)
     VALUES ($1, $2, $3, '+923001234567', 'Hello') RETURNING id`,
    [branchId, name, `${name.toLowerCase().replace(/ /g, '.')}@example.test`],
  );
  return rows[0]!.id;
}
