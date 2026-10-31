/** Advisory lock taken by the audit_events_chain trigger (the migration runner uses 727274). */
export const AUDIT_CHAIN_LOCK_KEY = 727275;

/** prev_hash of the first event in the chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** One audit row with every value as text, exactly as selected by CHAIN_ROW_SELECT. */
export interface ChainRowText {
  chain_seq: string;
  prev_hash: string;
  id: string;
  occurred_at_utc: string;
  request_id: string | null;
  actor_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  report_id: string | null;
  before_text: string | null;
  after_text: string | null;
  hash: string;
}

export type ChainBreakReason = 'sequence_gap' | 'link_mismatch' | 'hash_mismatch';

export type ChainStatus =
  | { status: 'empty'; checkedEvents: 0; checkedAt: string }
  | {
      status: 'intact';
      checkedEvents: number;
      head: { chainSeq: number; hash: string };
      checkedAt: string;
    }
  | {
      status: 'broken';
      checkedEvents: number;
      brokenAt: { chainSeq: number; eventId: string; reason: ChainBreakReason };
      checkedAt: string;
    };
