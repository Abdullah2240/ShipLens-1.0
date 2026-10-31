// Branch lifecycle rules. Pure data plus two small functions; safe to import anywhere.
import { ID_FORMATS, type BranchStatus } from '@/platform/config/constants';

export const BRANCH_TRANSITIONS: Readonly<Record<BranchStatus, readonly BranchStatus[]>> = {
  forming: ['active', 'closed'],
  active: ['paused', 'closed'],
  paused: ['active', 'closed'],
  closed: [],
};

export function canTransitionBranch(from: BranchStatus, to: BranchStatus): boolean {
  if (!Object.hasOwn(BRANCH_TRANSITIONS, from)) return false;
  return BRANCH_TRANSITIONS[from].includes(to);
}

/** Statuses in which new collections may be logged (enforced by the collections module). */
export const BRANCH_ACCEPTS_COLLECTIONS: readonly BranchStatus[] = ['forming', 'active'];

/** Statuses in which every branch, collection and report write is refused. */
export const BRANCH_READ_ONLY: readonly BranchStatus[] = ['closed'];

/** Builds the display code from a branch_code_seq value: 1 -> BR001, 1234 -> BR1234. */
export function formatBranchCode(n: string | number | bigint): string {
  const digits = String(n);
  if (!/^\d+$/.test(digits))
    throw new RangeError('branch code sequence value must be a non-negative integer');
  return ID_FORMATS.branchCode.prefix + digits.padStart(ID_FORMATS.branchCode.digits, '0');
}
