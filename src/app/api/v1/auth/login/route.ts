import { z } from 'zod';
import { login, serializeSessionCookie } from '@/modules/auth';
import { getEnv } from '@/platform/config/env';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';

// .strict(): extra keys such as `role` are refused (422), never silently trusted.
const loginSchema = z
  .object({
    email: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

export const POST = route({ auth: 'public', body: loginSchema }, async (c) => {
  // c.command has no actor on this public route; login() builds the user's actor after
  // the password check, so the audit row carries the real user and role.
  const result = await login(c.command, {
    email: c.body.email,
    password: c.body.password,
    ip: c.ip,
    userAgent: c.req.headers.get('user-agent') ?? undefined,
  });
  const secure = getEnv().APP_ORIGIN.startsWith('https://');
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((result.expiresAt.getTime() - c.command.clock.now().getTime()) / 1000),
  );
  return {
    data: { user: result.user },
    headers: { 'Set-Cookie': serializeSessionCookie(result.token, { secure, maxAgeSeconds }) },
  };
});
