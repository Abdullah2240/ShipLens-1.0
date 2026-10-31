// Browser client for the routing endpoints (POST and DELETE /api/v1/collections/{id}/routed).
// The browser adds the Origin header the API checks; no request body is sent.

export type RoutingErrorCode =
  'already_routed' | 'not_routed' | 'not_approved' | 'forbidden' | 'not_found' | 'network';

export type RoutingResult = { ok: true } | { ok: false; code: RoutingErrorCode };

const KNOWN: ReadonlySet<string> = new Set<RoutingErrorCode>([
  'already_routed',
  'not_routed',
  'not_approved',
  'forbidden',
  'not_found',
]);

function routedPath(collectionId: string): string {
  return `/api/v1/collections/${encodeURIComponent(collectionId)}/routed`;
}

function fromStatus(status: number, method: 'POST' | 'DELETE'): RoutingErrorCode {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return method === 'POST' ? 'already_routed' : 'not_routed';
  return 'network';
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

async function send(method: 'POST' | 'DELETE', collectionId: string): Promise<RoutingResult> {
  let response: Response;
  try {
    response = await fetch(routedPath(collectionId), {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { ok: false, code: 'network' };
  }
  if (response.ok) return { ok: true };
  const code = await errorCode(response);
  if (code && KNOWN.has(code)) return { ok: false, code: code as RoutingErrorCode };
  return { ok: false, code: fromStatus(response.status, method) };
}

/** Marks an approved collection as sent to the main account. */
export function markRouted(collectionId: string): Promise<RoutingResult> {
  return send('POST', collectionId);
}

/** Undoes the routing mark of a collection. */
export function unmarkRouted(collectionId: string): Promise<RoutingResult> {
  return send('DELETE', collectionId);
}
