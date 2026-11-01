import { revalidatePublicPages, unpublishEntry } from '@/modules/content';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'content.unpublish' }, async (c) => {
  const data = await unpublishEntry(c.command, c.params.key ?? '', c.params.locale ?? '');
  // only after the unpublish has committed
  revalidatePublicPages();
  return { data: { data } };
});
