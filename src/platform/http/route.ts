// The single wrapper for every /api/v1 route handler. Web-standard Request/Response only,
// no framework imports, so the whole pipeline is unit-testable.
//
// Pipeline, in this order:
//   request id -> Origin check (mutations) -> query parse -> session resolve -> 401 if
//   required -> authorize(actor, action) -> body parse -> CommandContext -> handler ->
//   serialise -> error mapping (mapError)
//
// The actor always comes from the session row. Nothing the client sends (body, query or
// headers such as x-role or x-branch-id) is consulted for role or branch.
//
// IMPORT-TIME RULE: getEnv() and getPool() run only inside a request. `next build` imports
// route modules with no environment, so the default deps below are lazy.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { z } from 'zod';
import { readSessionToken } from '@/modules/auth/cookie';
import type { SessionUser } from '@/modules/auth/types';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor, type Scope } from '@/platform/authz';
import type { Action } from '@/platform/authz/permissions';
import { getEnv } from '@/platform/config/env';
import { getPool } from '@/platform/db';
import { AppError, Unauthenticated, ValidationFailed, mapError } from '@/platform/errors';
import { logger } from '@/platform/log/logger';
import { systemClock, type Clock } from '@/platform/time';
import { isAllowedOrigin, isMutatingMethod } from './origin';

export interface RouteOptions<B, Q> {
  auth: 'public' | 'session';
  /** When set, authorize(actor, action) runs before the handler (403 when denied). */
  action?: Action;
  /** JSON body schema (422 on failure). */
  body?: z.ZodType<B>;
  /** Query string schema, applied to the flat search params (422 on failure). */
  query?: z.ZodType<Q>;
  /** Default: any method other than GET, HEAD or OPTIONS. */
  mutating?: boolean;
}

export interface RouteContext<B, Q> {
  req: Request;
  requestId: string;
  params: Record<string, string>;
  actor: Actor | null;
  user: SessionUser | null;
  scope: Scope | null;
  body: B;
  query: Q;
  command: CommandContext;
  ip: string | undefined;
}

export interface RouteDeps {
  env(): { APP_ORIGIN: string };
  pool(): Pool;
  clock: Clock;
  resolveActor(token: string | null): Promise<{ actor: Actor; user: SessionUser } | null>;
  authorizeFn: typeof authorize;
}

export type RouteResult = Response | { status?: number; data?: unknown; headers?: HeadersInit };
export type RouteHandler<B, Q> = (c: RouteContext<B, Q>) => Promise<RouteResult>;
export type NextRouteContext = { params: Promise<Record<string, string>> };

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|\s*$)/i;
const EMPTY_BODY_STATUSES = new Set([204, 205, 304]);

class CrossOriginRefused extends AppError {
  constructor() {
    super(403, 'forbidden', 'Cross-origin request refused');
  }
}

function standardHeaders(response: Response, requestId: string): Response {
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

function bodyError(code: string): ValidationFailed {
  return new ValidationFailed([{ path: 'body', code, message: code }]);
}

/** Reads the body as text, refusing (413 semantics, reported as 422) past the limit. */
async function readCappedText(req: Request): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw bodyError('payload_too_large');
  }
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw bodyError('payload_too_large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function parseBody<B>(req: Request, schema: z.ZodType<B>): Promise<B> {
  const text = await readCappedText(req);
  if (!JSON_CONTENT_TYPE.test(req.headers.get('content-type') ?? '')) {
    throw bodyError('invalid_content_type');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw bodyError('invalid_json');
  }
  return schema.parse(value);
}

function serialise(result: RouteResult): Response {
  if (result instanceof Response) return result;
  const status = result.status ?? 200;
  if (EMPTY_BODY_STATUSES.has(status)) {
    return new Response(null, { status, headers: result.headers });
  }
  return Response.json(result.data, { status, headers: result.headers });
}

/**
 * Builds a route() bound to the given collaborators. Tests pass stubs; production uses
 * `route`, whose defaults resolve env, pool and session lazily per request.
 */
export function createRoute(deps: Partial<RouteDeps> = {}) {
  const env = deps.env ?? (() => getEnv());
  const pool = deps.pool ?? (() => getPool());
  const clock = deps.clock ?? systemClock;
  const resolveActor =
    deps.resolveActor ??
    (async (token: string | null) => {
      // Loaded on first use so importing a route module never loads the auth service.
      const { getActorFromToken } = await import('@/modules/auth');
      return getActorFromToken({ pool: pool(), clock }, token);
    });
  const authorizeFn = deps.authorizeFn ?? authorize;

  return function route<B = undefined, Q = undefined>(
    opts: RouteOptions<B, Q>,
    handler: RouteHandler<B, Q>,
  ): (req: Request, ctx: NextRouteContext) => Promise<Response> {
    return async (req, ctx) => {
      const supplied = req.headers.get('x-request-id');
      const requestId = supplied && REQUEST_ID.test(supplied) ? supplied : randomUUID();
      let role: Actor['role'] | undefined;
      try {
        const mutating = opts.mutating ?? isMutatingMethod(req.method);
        if (!isAllowedOrigin(req, env().APP_ORIGIN, mutating)) throw new CrossOriginRefused();

        const query = opts.query
          ? opts.query.parse(Object.fromEntries(new URL(req.url).searchParams))
          : (undefined as Q);

        let actor: Actor | null = null;
        let user: SessionUser | null = null;
        let scope: Scope | null = null;
        if (opts.auth === 'session') {
          const secure = env().APP_ORIGIN.startsWith('https://');
          const resolved = await resolveActor(readSessionToken(req.headers.get('cookie'), secure));
          if (!resolved) throw new Unauthenticated();
          actor = resolved.actor;
          user = resolved.user;
          role = actor.role;
        }
        if (opts.action) {
          if (!actor) throw new Unauthenticated();
          scope = authorizeFn(actor, opts.action);
        }

        const body = opts.body ? await parseBody(req, opts.body) : (undefined as B);
        const command: CommandContext = { actor, requestId, clock, pool: pool() };
        // Only the first x-forwarded-for entry is used: it is the address the platform
        // proxy (Render) saw. Later hops are client-controlled and never trusted.
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;

        const result = await handler({
          req,
          requestId,
          params: await ctx.params,
          actor,
          user,
          scope,
          body,
          query,
          command,
          ip,
        });
        return standardHeaders(serialise(result), requestId);
      } catch (err) {
        const mapped = mapError(err, requestId);
        if (mapped.status === 401 || mapped.status === 403) {
          logger.warn('http.denied', {
            requestId,
            action: opts.action,
            role,
            path: new URL(req.url).pathname,
          });
        } else if (mapped.status === 500) {
          logger.error('http.error', { requestId, error: err });
        }
        return standardHeaders(
          Response.json(mapped.body, { status: mapped.status, headers: mapped.headers }),
          requestId,
        );
      }
    };
  };
}

export const route = createRoute();
