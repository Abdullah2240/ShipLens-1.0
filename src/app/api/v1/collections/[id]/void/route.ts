import { voidCollection, voidInputSchema } from '@/modules/collections';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const POST = route(
  { auth: 'session', action: 'collection.void', body: voidInputSchema },
  async (c) => ({ data: { data: await voidCollection(c.command, c.params.id ?? '', c.body) } }),
);
