import {
  branchCreateSchema,
  branchListQuerySchema,
  createBranch,
  listBranches,
} from '@/modules/branches';
import { route } from '@/platform/http/interim-route';

export const dynamic = 'force-dynamic';
export const GET = route(
  { auth: 'session', action: 'branch.read', query: branchListQuerySchema },
  async (c) => ({ data: { data: await listBranches(c.command.pool, c.actor!, c.query) } }),
);
export const POST = route(
  { auth: 'session', action: 'branch.create', body: branchCreateSchema },
  async (c) => ({ status: 201, data: { data: await createBranch(c.command, c.body) } }),
);
