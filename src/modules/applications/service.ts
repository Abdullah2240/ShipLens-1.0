import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { Conflict, ValidationFailed } from '@/platform/errors';
import { findBranchStatus, insertApplication } from './repo';
import type { ApplicationInput } from './schema';

export async function submitApplication(
  ctx: CommandContext,
  input: ApplicationInput,
): Promise<void> {
  try {
    await command(ctx, 'application.submit', async (tx, audit) => {
      if ((await findBranchStatus(tx, input.branchId)) !== 'active') {
        throw new ValidationFailed([
          { path: 'branchId', code: 'invalid_branch', message: 'invalid_branch' },
        ]);
      }
      const row = await insertApplication(tx, input);
      audit({
        action: 'application.submit',
        entityType: 'application',
        entityId: row.id,
        branchId: row.branch_id,
        after: { status: 'pending', branch_id: row.branch_id },
      });
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'applications_pending_email_branch_key'
    ) {
      throw new Conflict('duplicate_application');
    }
    throw error;
  }
}
