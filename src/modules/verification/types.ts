import type { MoneyString } from '@/platform/money';
import type { DateString } from '@/platform/time';

/**
 * Integrity of an approved report against the audit chain, in precedence order:
 * chain_broken (the global chain is broken), unanchored (no approval event or no submit
 * event), mismatch (approval event not 'approved', or frozen totals differ from the
 * report row), verified.
 */
export type VerificationIntegrity = 'verified' | 'mismatch' | 'unanchored' | 'chain_broken';

export type SealCheck = 'match' | 'mismatch' | 'not_provided';

/** The whole public answer for a code. Holds no person, user id, note or line item. */
export interface PublicReportVerification {
  /** Display form, 'XXXXX-XXXXX'. */
  code: string;
  branch: { name: string; city: string | null };
  weekStart: DateString;
  weekEnd: DateString;
  approvedTotal: MoneyString;
  collectionCount: number | null;
  /** PKT calendar date of the approval. */
  approvedOn: DateString | null;
  integrity: VerificationIntegrity;
  /** The approval audit event; seal = its hash's first 16 hex characters. */
  anchor: { chainSeq: number; seal: string } | null;
  sealCheck: SealCheck;
  chain: {
    status: 'empty' | 'intact' | 'broken';
    checkedEvents: number;
    brokenAtSeq: number | null;
    checkedAt: string;
  };
}

/** What an authorised user needs to share the public check of an approved report. */
export interface ReportVerificationLink {
  /** Display form, 'XXXXX-XXXXX'. */
  code: string;
  /** Locale-free: `/verify/<code>` plus `?s=<seal>` when the report has an anchor. */
  path: string;
  seal: string | null;
}
