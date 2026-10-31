import { draftInputSchema, getEntry, saveDraft } from '@/modules/content';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'content.read' }, async (c) => ({
  data: {
    data: await getEntry(c.command.pool, c.actor!, c.params.key ?? '', c.params.locale ?? ''),
  },
}));
// Saving a draft never changes the public copy, so public pages are not revalidated here.
export const PUT = route(
  { auth: 'session', action: 'content.edit', body: draftInputSchema },
  async (c) => ({
    data: {
      data: await saveDraft(c.command, c.params.key ?? '', c.params.locale ?? '', c.body),
    },
  }),
);
