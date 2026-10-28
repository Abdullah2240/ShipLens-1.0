// Test-only reference repository. It shows the pattern every Phase 2 repository follows:
// the Scope is a required argument, and a missing record and an out-of-scope record
// are the same NotFound.
import type { Scope } from '@/platform/authz';
import { scopeWhere } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';

export type ProbeBranch = { id: string; code: string; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getBranchById(db: Queryable, scope: Scope, id: string): Promise<ProbeBranch> {
  // A malformed id cannot exist, so it gets the same answer as any other missing record.
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'id', 2);
  const { rows } = await db.query<ProbeBranch>(
    `SELECT id, code, name FROM branches WHERE id = $1 AND ${where.sql}`,
    [id, ...where.params],
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return row;
}
