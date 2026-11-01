import { shareInputSchema, shareReport } from '@/modules/reporting';
import { getEnv } from '@/platform/config/env';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
// The link origin is the configured APP_ORIGIN, never the request's Host header.
export const POST = route(
  { auth: 'session', action: 'report.share', body: shareInputSchema },
  async (c) => ({
    data: {
      data: await shareReport(c.command, c.params.id ?? '', {
        appOrigin: getEnv().APP_ORIGIN,
        locale: c.body.locale ?? 'en',
      }),
    },
  }),
);
