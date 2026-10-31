// Pure string handling for the session cookie. No framework imports: the route layer
// passes the raw Cookie header in and sets the returned Set-Cookie value on the response.

/** Cookie name over plain http (local development). */
export const SESSION_COOKIE = 'shiplens_session';
const HOST_PREFIXED = `__Host-${SESSION_COOKIE}`;

// 32 random bytes in base64url is exactly 43 characters.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** `__Host-` over https (requires Secure, Path=/, no Domain); the plain name otherwise. */
export function sessionCookieName(secure: boolean): string {
  return secure ? HOST_PREFIXED : SESSION_COOKIE;
}

function attributes(secure: boolean, maxAgeSeconds: number): string {
  const parts = ['Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function serializeSessionCookie(
  token: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  if (!TOKEN_SHAPE.test(token)) throw new Error('Invalid session token for cookie');
  if (!Number.isInteger(opts.maxAgeSeconds) || opts.maxAgeSeconds < 0) {
    throw new Error('maxAgeSeconds must be a non-negative integer');
  }
  return `${sessionCookieName(opts.secure)}=${token}; ${attributes(opts.secure, opts.maxAgeSeconds)}`;
}

export function clearSessionCookie(opts: { secure: boolean }): string {
  return `${sessionCookieName(opts.secure)}=; ${attributes(opts.secure, 0)}`;
}

/** The session token from a Cookie header, or null if absent or not token-shaped. */
export function readSessionToken(
  cookieHeader: string | null | undefined,
  secure: boolean,
): string | null {
  if (!cookieHeader) return null;
  const name = sessionCookieName(secure);
  for (const piece of cookieHeader.split(';')) {
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    if (piece.slice(0, eq).trim() !== name) continue;
    const value = piece.slice(eq + 1).trim();
    return TOKEN_SHAPE.test(value) ? value : null;
  }
  return null;
}
