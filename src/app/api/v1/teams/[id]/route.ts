import { z } from 'zod';
import { renameTeam } from '@/modules/members';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
const renameInputSchema = z.strictObject({
  name: z
    .string({ error: 'required' })
    .trim()
    .min(2, { error: 'too_short' })
    .max(60, { error: 'too_long' }),
});
export const PATCH = route(
  { auth: 'session', action: 'team.manage', body: renameInputSchema },
  async (c) => ({ data: { data: await renameTeam(c.command, c.params.id ?? '', c.body) } }),
);
