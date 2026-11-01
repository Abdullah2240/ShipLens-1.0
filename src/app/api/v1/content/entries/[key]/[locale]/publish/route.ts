import { publishEntry, revalidatePublicPages } from '@/modules/content';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'content.publish' }, async (c) => {
  const data = await publishEntry(c.command, c.params.key ?? '', c.params.locale ?? '');
  // only after the publish has committed
  revalidatePublicPages();
  return { data: { data } };
});
