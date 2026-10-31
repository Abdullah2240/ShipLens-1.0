import { amendCollection, collectionPatchSchema, getCollection } from '@/modules/collections';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'collection.read' }, async (c) => ({
  data: {
    data: await getCollection(c.command.pool, c.actor!, c.command.clock, c.params.id ?? ''),
  },
}));
export const PATCH = route(
  { auth: 'session', action: 'collection.amend', body: collectionPatchSchema },
  async (c) => ({ data: { data: await amendCollection(c.command, c.params.id ?? '', c.body) } }),
);
