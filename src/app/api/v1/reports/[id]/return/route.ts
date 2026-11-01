import { returnInputSchema, returnReport } from '@/modules/reports';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const POST = route(
  { auth: 'session', action: 'report.return', body: returnInputSchema },
  async (c) => ({ data: { data: await returnReport(c.command, c.params.id ?? '', c.body) } }),
);
