import { listMembers, parseMemberQuery } from '@/modules/members';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'member.read' }, async (c) => ({
  data: {
    data: await listMembers(
      c.command.pool,
      c.actor!,
      parseMemberQuery(Object.fromEntries(new URL(c.req.url).searchParams)),
    ),
  },
}));
