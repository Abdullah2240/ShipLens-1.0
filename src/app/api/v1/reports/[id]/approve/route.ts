import { approveReport } from '@/modules/reports';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'report.approve' }, async (c) => ({
  data: { data: await approveReport(c.command, c.params.id ?? '') },
}));
