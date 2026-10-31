import { acceptApplication } from '@/modules/applications';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'application.decide' }, async (c) => {
  const { memberId, memberCode } = await acceptApplication(c.command, c.params.id ?? '');
  return { data: { data: { memberId, memberCode } } };
});
