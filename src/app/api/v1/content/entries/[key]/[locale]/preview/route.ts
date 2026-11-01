import { previewEntry } from '@/modules/content';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'content.preview' }, async (c) => ({
  data: {
    data: await previewEntry(c.command.pool, c.actor!, c.params.key ?? '', c.params.locale ?? ''),
  },
}));
