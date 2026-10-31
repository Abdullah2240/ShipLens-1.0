// Public verification of approved weekly reports against the tamper-evident audit chain,
// and the authorised lookup of a report's code for sharing. No framework imports.
import { getChainStatus } from '@/platform/audit/chain/verify';
import type { ChainStatus } from '@/platform/audit/chain/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { compareMoney } from '@/platform/money';
import { addDays, pktDate, type Clock } from '@/platform/time';
import { formatCode, normaliseCode } from './code';
import { SEAL_LENGTH, SEAL_PATTERN } from './config';
import {
  selectApprovalAnchor,
  selectCodeForReport,
  selectPublicByCode,
  selectTotalsEvidence,
  type ApprovalAnchorRow,
  type PublicReportRow,
  type TotalsEvidenceRow,
} from './repo';
import type {
  PublicReportVerification,
  ReportVerificationLink,
  SealCheck,
  VerificationIntegrity,
} from './types';

const sealOf = (anchor: ApprovalAnchorRow): string => anchor.hash.slice(0, SEAL_LENGTH);

function checkSeal(provided: string | undefined, anchor: ApprovalAnchorRow | null): SealCheck {
  if (provided === undefined || provided === '') return 'not_provided';
  // Anything that is not 16 lowercase hex characters can never match; it is not an error.
  if (!anchor || !SEAL_PATTERN.test(provided)) return 'mismatch';
  return provided === sealOf(anchor) ? 'match' : 'mismatch';
}

/** Equal money strings; a missing or malformed value is never equal and never throws. */
function sameMoney(recorded: string | null, current: string | null): boolean {
  if (recorded === null || current === null) return false;
  try {
    return compareMoney(recorded, current) === 0;
  } catch {
    return false;
  }
}

function sameCount(recorded: string | null, current: number | null): boolean {
  if (recorded === null || current === null || !/^\d+$/.test(recorded)) return false;
  return Number(recorded) === current;
}

function integrityOf(
  chain: ChainStatus,
  report: PublicReportRow,
  anchor: ApprovalAnchorRow | null,
  evidence: TotalsEvidenceRow | null,
): VerificationIntegrity {
  if (chain.status === 'broken') return 'chain_broken';
  if (!anchor || !evidence || evidence.submit_events === 0) return 'unanchored';
  if (
    anchor.status !== 'approved' ||
    !sameMoney(evidence.total_amount, report.total_amount) ||
    !sameCount(evidence.collection_count, report.collection_count)
  ) {
    return 'mismatch';
  }
  return 'verified';
}

function publicChain(chain: ChainStatus): PublicReportVerification['chain'] {
  return {
    status: chain.status,
    checkedEvents: chain.checkedEvents,
    brokenAtSeq: chain.status === 'broken' ? chain.brokenAt.chainSeq : null,
    checkedAt: chain.checkedAt,
  };
}

/**
 * Public lookup by code: no session, no scope. Unknown, malformed and non-approved codes
 * all return null, so callers answer them identically. The answer is the public projection
 * only (see PublicReportVerification).
 */
export async function lookupVerification(
  db: Queryable,
  rawCode: string,
  opts: { seal?: string; clock?: Clock } = {},
): Promise<PublicReportVerification | null> {
  const code = normaliseCode(rawCode);
  if (code === null) return null;

  const report = await selectPublicByCode(db, code);
  if (!report) return null;

  const [chain, anchor] = await Promise.all([
    getChainStatus(db, opts.clock ? { clock: opts.clock } : {}),
    selectApprovalAnchor(db, report.report_id),
  ]);
  const evidence = anchor
    ? await selectTotalsEvidence(db, report.report_id, anchor.chain_seq)
    : null;

  return {
    code: formatCode(report.code),
    branch: { name: report.branch_name, city: report.branch_city },
    weekStart: report.week_start,
    weekEnd: addDays(report.week_start, 6),
    // An approved report always has frozen totals; a missing one is reported as a mismatch.
    approvedTotal: report.total_amount ?? '0.00',
    collectionCount: report.collection_count,
    approvedOn: report.reviewed_at ? pktDate(report.reviewed_at) : null,
    integrity: integrityOf(chain, report, anchor, evidence),
    anchor: anchor ? { chainSeq: Number(anchor.chain_seq), seal: sealOf(anchor) } : null,
    sealCheck: checkSeal(opts.seal, anchor),
    chain: publicChain(chain),
  };
}

/**
 * The code, locale-free public path and seal of an approved report the actor may read.
 * Another branch, a report that is not approved, an unknown and a malformed id are the same
 * NotFound; a role without report.read is Forbidden.
 */
export async function getReportVerification(
  db: Queryable,
  actor: Actor,
  reportId: string,
): Promise<ReportVerificationLink> {
  const scope = authorize(actor, 'report.read');
  const stored = await selectCodeForReport(db, scope, reportId);
  const anchor = await selectApprovalAnchor(db, reportId);
  const code = formatCode(stored);
  const seal = anchor ? sealOf(anchor) : null;
  return { code, path: `/verify/${code}${seal ? `?s=${seal}` : ''}`, seal };
}
