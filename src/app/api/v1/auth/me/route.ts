import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: 'session' }, async (c) => ({ data: { user: c.user } }));
