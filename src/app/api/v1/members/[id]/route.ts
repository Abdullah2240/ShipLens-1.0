import { getMember, memberPatchSchema, updateMember } from '@/modules/members';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'member.read' }, async (c) => ({
  data: { data: await getMember(c.command.pool, c.actor!, c.params.id ?? '') },
}));
export const PATCH = route(
  { auth: 'session', action: 'member.update', body: memberPatchSchema },
  async (c) => ({ data: { data: await updateMember(c.command, c.params.id ?? '', c.body) } }),
);
