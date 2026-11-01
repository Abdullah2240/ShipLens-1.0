import { listAuditEvents, parseAuditQuery } from '@/modules/audit-log';
import { route } from '@/platform/http/interim-route';

// audit.read_finance admits exactly the roles with any audit viewer access (Super Admin and
// Finance Reviewer); the service then decides between full and finance-only access.
export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'audit.read_finance' }, async (c) => ({
  data: {
    data: await listAuditEvents(
      c.command.pool,
      c.actor!,
      parseAuditQuery(new URL(c.req.url).searchParams),
    ),
  },
}));
