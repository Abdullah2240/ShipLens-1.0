import { listLeadCandidates } from '@/modules/branches';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'user.read' }, async (c) => ({
  data: { data: await listLeadCandidates(c.command.pool, c.actor!) },
}));
