import { assignLead, assignLeadSchema } from '@/modules/branches';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const POST = route(
  { auth: 'session', action: 'branch.assign_leads', body: assignLeadSchema },
  async (c) => ({ data: { data: await assignLead(c.command, c.params.id ?? '', c.body) } }),
);
