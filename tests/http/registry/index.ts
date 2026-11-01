/// <reference types="vite/client" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PERMISSIONS, type ScopeGrant } from '@/platform/authz/permissions';
import { BRANCH_SCOPED_ROLES, ROLES, type Role } from '@/platform/authz/roles';
import type { EndpointAction, EndpointSpec, Side, World } from './types';

export type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export const API_ROOT = path.resolve(import.meta.dirname, '../../../src/app/api/v1');

// Every *.registry.ts in this folder. Later phases add their own file; nothing here changes.
const registryModules = import.meta.glob<{ default: EndpointSpec[] }>('./*.registry.ts', {
  eager: true,
});

// Lazy loaders for every route module, keyed by the path below src/app/api/v1.
const routeModules = Object.fromEntries(
  Object.entries(
    import.meta.glob<Record<string, unknown>>('../../../src/app/api/v1/**/route.ts'),
  ).map(([file, load]) => [file.replace(/^.*\/src\/app\/api\/v1\//, ''), load]),
);

export function loadRegistry(): EndpointSpec[] {
  const files = Object.keys(registryModules).sort();
  const specs = files.flatMap((file) => registryModules[file]!.default);
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) throw new Error(`duplicate endpoint registry id: ${spec.id}`);
    seen.add(spec.id);
  }
  return specs;
}

export function registryFiles(): string[] {
  return Object.keys(registryModules).sort();
}

export function routeFilePath(spec: Pick<EndpointSpec, 'route'>): string {
  return path.join(API_ROOT, spec.route, 'route.ts');
}

export function routeFileExists(spec: Pick<EndpointSpec, 'route'>): boolean {
  return existsSync(routeFilePath(spec));
}

export async function loadHandler(spec: EndpointSpec): Promise<Handler> {
  const load = routeModules[`${spec.route}/route.ts`];
  if (!load) throw new Error(`no route module for ${spec.route}`);
  const mod = await load();
  const handler = mod[spec.method];
  if (typeof handler !== 'function') {
    throw new Error(`${spec.route}/route.ts does not export ${spec.method}`);
  }
  return handler as Handler;
}

/**
 * The grant the permission table gives this role for the endpoint. Public and
 * session-only endpoints admit every signed-in role with no branch narrowing.
 */
export function grantFor(action: EndpointAction, role: Role): ScopeGrant | undefined {
  if (action === 'public' || action === 'session') return 'all';
  const row = PERMISSIONS[action] as Partial<Record<Role, ScopeGrant>>;
  return Object.hasOwn(row, role) ? row[role] : undefined;
}

/** Branch roles holding the action with an own_branch grant, read from PERMISSIONS. */
export function ownBranchRoles(
  action: EndpointAction,
): Array<(typeof BRANCH_SCOPED_ROLES)[number]> {
  return BRANCH_SCOPED_ROLES.filter((role) => grantFor(action, role) === 'own_branch');
}

/** The first role holding the action across all branches, if any. */
export function allScopeRole(action: EndpointAction): Role | undefined {
  if (action === 'public' || action === 'session') return undefined;
  return ROLES.find((role) => grantFor(action, role) === 'all');
}

export function isMutation(spec: Pick<EndpointSpec, 'method'>): boolean {
  return spec.method !== 'GET';
}

export function paramsFor(spec: EndpointSpec, w: World, side: Side): Record<string, string> {
  if (spec.params) return spec.params(w, side);
  if (spec.record) {
    const record = w.records[spec.record];
    if (!record) throw new Error(`world has no record '${spec.record}' (${spec.id})`);
    return { id: record[side] };
  }
  return {};
}

/** URL path for the route with its [param] segments filled in. */
export function pathFor(spec: Pick<EndpointSpec, 'route'>, params: Record<string, string>): string {
  return spec.route.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing route param '${name}' for ${spec.route}`);
    return encodeURIComponent(value);
  });
}
