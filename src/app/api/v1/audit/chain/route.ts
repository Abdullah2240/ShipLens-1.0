import { getChainStatus } from '@/platform/audit/chain/verify';
import { route } from '@/platform/http/route';

// Head office only (audit.read_finance: Super Admin and Finance Reviewer). The body is the
// ChainStatus summary and never any row content. ?fresh=1 bypasses the 60 s cache.
export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'audit.read_finance' }, async (c) => ({
  data: {
    data: await getChainStatus(c.command.pool, {
      fresh: new URL(c.req.url).searchParams.get('fresh') === '1',
    }),
  },
}));
