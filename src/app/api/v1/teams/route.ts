import { createTeam, listTeams, teamInputSchema } from '@/modules/members';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'team.read' }, async (c) => ({
  data: {
    data: await listTeams(c.command.pool, c.actor!, {
      branchId: new URL(c.req.url).searchParams.get('branchId') ?? undefined,
    }),
  },
}));
export const POST = route(
  { auth: 'session', action: 'team.manage', body: teamInputSchema },
  async (c) => ({ status: 201, data: { data: await createTeam(c.command, c.body) } }),
);
