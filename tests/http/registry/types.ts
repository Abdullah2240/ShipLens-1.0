import type { Action } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';
import type { DateString } from '@/platform/time';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Side = 'A' | 'B';

/** World users: one per role in branch A, plus the two branch roles of branch B. */
export type WorldUserKey = Role | 'branch_lead_b' | 'hr_lead_b';

export interface World {
  branchA: string;
  branchB: string;
  users: Record<WorldUserKey, { id: string; cookie: string }>;
  /** Record ids per branch. Branchless records (event) use the same id on both sides. */
  records: Record<string, { A: string; B: string }>;
  today: DateString;
  weekStart: DateString;
  /** A real login for the public login endpoint (its own user, not one of the role users). */
  login: { email: string; password: string };
}

/**
 * What the endpoint requires:
 * - an Action from the permission table (the route calls route({ action })),
 * - 'session': any signed-in user, no permission action (auth/me, auth/logout),
 * - 'public': no session at all.
 */
export type EndpointAction = Action | 'session' | 'public';

export interface EndpointSpec {
  /** Unique id, e.g. 'collections.void'. */
  id: string;
  method: Method;
  /** Route folder relative to src/app/api/v1, e.g. 'collections/[id]/void'. */
  route: string;
  action: EndpointAction;
  /** Key into world.records for [id] params; enables the cross-branch checks. */
  record?: string;
  /** Route params; defaults to { id: world.records[record][side] } when `record` is set. */
  params?: (w: World, side: Side) => Record<string, string>;
  /** A valid body for an allowed role. Mutations without a body send no content-type. */
  body?: (w: World) => unknown;
  /** List endpoint whose items carry this branch field; enables list isolation checks. */
  listOf?: 'branchId' | 'id';
  /** The list accepts ?branchId=; a branch role naming another branch must not see it. */
  branchFilter?: boolean;
  /** Create endpoint whose branch must come from the session, never from the body. */
  createsIn?: 'session-branch';
  /** Table the create endpoint writes to (for the createsIn check). */
  createsTable?: string;
}
