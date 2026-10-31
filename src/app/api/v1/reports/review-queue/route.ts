import { listReviewQueue } from '@/modules/reports';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'report.approve' }, async (c) => ({
  data: { data: await listReviewQueue(c.command.pool, c.actor!) },
}));
