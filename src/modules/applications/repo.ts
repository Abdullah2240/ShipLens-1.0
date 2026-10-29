import type { PoolClient } from 'pg';
import type { ApplicationInput } from './schema';

export async function findBranchStatus(tx: PoolClient, branchId: string): Promise<string | null> {
  const { rows } = await tx.query<{ status: string }>('SELECT status FROM branches WHERE id = $1', [
    branchId,
  ]);
  return rows[0]?.status ?? null;
}

export async function insertApplication(
  tx: PoolClient,
  input: ApplicationInput,
): Promise<{ id: string; branch_id: string }> {
  const { rows } = await tx.query<{ id: string; branch_id: string }>(
    `INSERT INTO applications (full_name, email, phone, message, branch_id, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id, branch_id`,
    [input.fullName, input.email, input.phone, input.message, input.branchId],
  );
  return rows[0]!;
}
