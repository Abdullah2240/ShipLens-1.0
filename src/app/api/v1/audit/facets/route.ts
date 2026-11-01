import { getAuditFacets } from '@/modules/audit-log';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'audit.read_finance' }, async (c) => ({
  data: { data: await getAuditFacets(c.command.pool, c.actor!) },
}));
