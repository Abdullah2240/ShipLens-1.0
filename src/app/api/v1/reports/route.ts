import { ensureCurrentWeekDrafts, listReports, parseReportQuery } from '@/modules/reports';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'report.read' }, async (c) => {
  await ensureCurrentWeekDrafts(c.command);
  const query = parseReportQuery(Object.fromEntries(new URL(c.req.url).searchParams));
  return { data: { data: await listReports(c.command.pool, c.actor!, query) } };
});
