// CSRF defence for state-changing requests. Web-standard Request only, no framework imports.
//
// A mutation must carry an Origin header equal to APP_ORIGIN (scheme, host and port,
// compared as an exact string). A missing Origin is refused even when
// `Sec-Fetch-Site: same-origin` is present: every browser that can send our session
// cookie also sends Origin on POST/PUT/PATCH/DELETE, so absence means a non-browser or a
// stripped header, and we do not need to accept either.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * True when the request may proceed. `mutating` defaults to the method rule; read
 * methods are never checked.
 */
export function isAllowedOrigin(
  req: Request,
  appOrigin: string,
  mutating: boolean = isMutatingMethod(req.method),
): boolean {
  if (!mutating) return true;
  const origin = req.headers.get('origin');
  return origin !== null && origin === appOrigin;
}
