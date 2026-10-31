// Locale routing plus the per-request Content Security Policy for every page.
//
// Why a nonce: the root layout reads cookies() for the theme, so every page is rendered
// per request anyway, and a nonce with 'strict-dynamic' lets script-src drop
// 'unsafe-inline' (docs/adr/0012-nonce-based-csp.md).
//
// How the nonce reaches Next: the policy and `x-nonce` are set on a copy of the request,
// which the next-intl middleware forwards to the render (it passes request.headers into
// NextResponse.next/rewrite). Next reads the nonce from the request's
// Content-Security-Policy header and stamps it on its own scripts. The same policy is
// then set on the response the browser receives.
//
// API routes are excluded by the matcher; next.config.ts gives them
// `default-src 'none'; frame-ancestors 'none'` and the other security headers.
import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { buildCsp, createNonce } from '@/platform/http/csp';

const intlMiddleware = createMiddleware(routing);

/** True when the browser reached us over https (directly or through Render's proxy). */
function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return request.nextUrl.protocol === 'https:';
}

export default function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https: isHttps(request),
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);

  const response = intlMiddleware(new NextRequest(request, { headers }));
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
