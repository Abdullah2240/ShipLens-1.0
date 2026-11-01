import { submitInputSchema, submitReport } from '@/modules/reports';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
// The body is required: clients send `{}` at minimum, `{ "confirmNil": true }` for a nil report.
export const POST = route(
  { auth: 'session', action: 'report.submit', body: submitInputSchema },
  async (c) => ({ data: { data: await submitReport(c.command, c.params.id ?? '', c.body) } }),
);
