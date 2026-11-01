// TEMPORARY. Stand-in for src/platform/http/route.ts from plan 01-11, which is not built yet.
// Every Saniya-track route imports route from this file only. When 01-11 lands, change
// that one import line in each route and delete this file. Do not create route.ts here.
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
import { Forbidden, Unauthenticated, ValidationFailed, mapError } from '@/platform/errors';
import { logger } from '@/platform/log/logger';
import { systemClock, type Clock } from '@/platform/time';

export interface RouteOptions<B, Q> {
  auth: 'public' | 'session';
  action?: Action;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
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

type RouteResult = Response | { status?: number; data?: unknown; headers?: HeadersInit };
type RouteHandler<B, Q> = (c: RouteContext<B, Q>) => Promise<RouteResult>;
type NextContext = { params: Promise<Record<string, string>> };
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024;

function standardHeaders(response: Response, requestId: string): Response {
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

function fieldError(code: string): ValidationFailed {
  return new ValidationFailed([{ path: 'body', code, message: code }]);
}

async function parseBody<B>(req: Request, schema: z.ZodType<B>): Promise<B> {
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
    throw fieldError('payload_too_large');
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers.get('content-type') ?? '')) {
    throw fieldError('invalid_content_type');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw fieldError('invalid_json');
  }
  return schema.parse(value);
}

export function createRoute(deps: Partial<RouteDeps> = {}) {
  const env = deps.env ?? (() => getEnv());
  const pool = deps.pool ?? (() => getPool());
  const clock = deps.clock ?? systemClock;
  const resolveActor =
    deps.resolveActor ??
    (async (token: string | null) => {
      const { getActorFromToken } = await import('@/modules/auth');
      return getActorFromToken({ pool: pool(), clock }, token);
    });
  const authorizeFn = deps.authorizeFn ?? authorize;

  return function route<B = undefined, Q = undefined>(
    opts: RouteOptions<B, Q>,
    handler: RouteHandler<B, Q>,
  ): (req: Request, ctx: NextContext) => Promise<Response> {
    return async (req, ctx) => {
      const suppliedId = req.headers.get('x-request-id');
      const requestId = suppliedId && REQUEST_ID.test(suppliedId) ? suppliedId : randomUUID();
      let role: Actor['role'] | undefined;
      try {
        const mutating = opts.mutating ?? !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        if (mutating && req.headers.get('origin') !== env().APP_ORIGIN) throw new Forbidden();

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
        // The first forwarded address is supplied by the platform proxy.
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
        const response =
          result instanceof Response
            ? result
            : result.status === 204 || result.status === 205 || result.status === 304
              ? new Response(null, { status: result.status, headers: result.headers })
              : Response.json(result.data, {
                  status: result.status ?? 200,
                  headers: result.headers,
                });
        return standardHeaders(response, requestId);
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
