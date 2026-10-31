import { markCollectionRouted, unmarkCollectionRouted } from '@/modules/collections';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const POST = route({ auth: 'session', action: 'collection.mark_routed' }, async (c) => ({
  data: { data: await markCollectionRouted(c.command, c.params.id ?? '') },
}));
export const DELETE = route({ auth: 'session', action: 'collection.unmark_routed' }, async (c) => ({
  data: { data: await unmarkCollectionRouted(c.command, c.params.id ?? '') },
}));
