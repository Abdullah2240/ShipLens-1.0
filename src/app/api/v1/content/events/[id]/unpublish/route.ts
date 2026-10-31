import { revalidatePublicPages, unpublishEvent } from '@/modules/content';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'content.unpublish' }, async (c) => {
  const data = await unpublishEvent(c.command, c.params.id ?? '');
  // only after the unpublish has committed
  revalidatePublicPages();
  return { data: { data } };
});
