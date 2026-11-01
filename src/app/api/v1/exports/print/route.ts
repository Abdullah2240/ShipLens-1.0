import { printBodySchema, recordPrint } from '@/modules/reporting';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';

// Audit only: the browser prints the page; nothing printed is sent or stored here.
export const POST = route(
  { auth: 'session', action: 'export.create', body: printBodySchema },
  async (c) => {
    await recordPrint(c.command, c.body);
    return { data: { data: { ok: true } } };
  },
);
