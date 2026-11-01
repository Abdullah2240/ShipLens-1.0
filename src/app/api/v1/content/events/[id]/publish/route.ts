import { publishEvent, revalidatePublicPages } from '@/modules/content';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'content.publish' }, async (c) => {
  const data = await publishEvent(c.command, c.params.id ?? '');
  // only after the publish has committed
  revalidatePublicPages();
  return { data: { data } };
});
