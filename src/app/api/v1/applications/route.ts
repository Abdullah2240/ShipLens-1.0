import { listApplications, parseApplicationListQuery } from '@/modules/applications';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'application.read' }, async (c) => ({
  data: {
    data: await listApplications(
      c.command.pool,
      c.actor!,
      parseApplicationListQuery(Object.fromEntries(new URL(c.req.url).searchParams)),
    ),
  },
}));
