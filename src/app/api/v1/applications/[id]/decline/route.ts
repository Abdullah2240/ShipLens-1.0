import { declineApplication, declineInputSchema } from '@/modules/applications';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const POST = route(
  { auth: 'session', action: 'application.decide', body: declineInputSchema },
  async (c) => {
    await declineApplication(c.command, c.params.id ?? '', c.body);
    return { data: { data: { ok: true } } };
  },
);
