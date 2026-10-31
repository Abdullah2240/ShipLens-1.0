import { eventPatchSchema, getEvent, updateEvent } from '@/modules/content';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'content.read' }, async (c) => ({
  data: { data: await getEvent(c.command.pool, c.actor!, c.params.id ?? '') },
}));
// Editing changes the draft copy only, so public pages are not revalidated here.
export const PATCH = route(
  { auth: 'session', action: 'content.edit', body: eventPatchSchema },
  async (c) => ({ data: { data: await updateEvent(c.command, c.params.id ?? '', c.body) } }),
);
