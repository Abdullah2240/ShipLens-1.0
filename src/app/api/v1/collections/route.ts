import {
  collectionInputSchema,
  createCollection,
  listCollections,
  parseCollectionQuery,
} from '@/modules/collections';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'collection.read' }, async (c) => ({
  data: {
    data: await listCollections(
      c.command.pool,
      c.actor!,
      c.command.clock,
      parseCollectionQuery(Object.fromEntries(new URL(c.req.url).searchParams)),
    ),
  },
}));
export const POST = route(
  { auth: 'session', action: 'collection.create', body: collectionInputSchema },
  async (c) => ({ status: 201, data: { data: await createCollection(c.command, c.body) } }),
);
