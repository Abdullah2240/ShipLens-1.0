import { clearSessionCookie, logout, readSessionToken } from '@/modules/auth';
import { getEnv } from '@/platform/config/env';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'session' }, async (c) => {
  const secure = getEnv().APP_ORIGIN.startsWith('https://');
  const token = readSessionToken(c.req.headers.get('cookie'), secure);
  if (token) await logout(c.command, token);
  return { status: 204, headers: { 'Set-Cookie': clearSessionCookie({ secure }) } };
});
