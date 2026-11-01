import { createEvent, eventInputSchema, listEvents } from '@/modules/content';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'content.read' }, async (c) => ({
  data: { data: await listEvents(c.command.pool, c.actor!) },
}));
// A new event is always a draft, so public pages are not revalidated here.
export const POST = route(
  { auth: 'session', action: 'content.edit', body: eventInputSchema },
  async (c) => ({ status: 201, data: { data: await createEvent(c.command, c.body) } }),
);
