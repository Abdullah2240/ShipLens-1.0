import { getReportVerification } from '@/modules/verification';
import { route } from '@/platform/http/route';

// Code, locale-free public path and seal of an approved report in the caller's scope.
// Not approved, another branch or missing: the same 404.
export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'report.read' }, async (c) => ({
  data: { data: await getReportVerification(c.command.pool, c.actor!, c.params.id ?? '') },
}));
