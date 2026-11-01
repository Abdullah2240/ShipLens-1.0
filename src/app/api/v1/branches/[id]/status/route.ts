import { branchTransitionSchema, transitionBranch } from '@/modules/branches';
import { route } from '@/platform/http/route';

export const dynamic = 'force-dynamic';
export const POST = route(
  { auth: 'session', action: 'branch.transition', body: branchTransitionSchema },
  async (c) => ({ data: { data: await transitionBranch(c.command, c.params.id ?? '', c.body) } }),
);
