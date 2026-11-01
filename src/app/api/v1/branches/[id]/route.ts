import { branchPatchSchema, getBranch, updateBranch } from '@/modules/branches';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'session', action: 'branch.read' }, async (c) => ({
  data: { data: await getBranch(c.command.pool, c.actor!, c.params.id ?? '') },
}));
export const PATCH = route(
  { auth: 'session', action: 'branch.update', body: branchPatchSchema },
  async (c) => ({ data: { data: await updateBranch(c.command, c.params.id ?? '', c.body) } }),
);
