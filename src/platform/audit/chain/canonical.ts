import { createHash } from 'node:crypto';
import type { ChainRowText } from './types';

/**
 * Select list that reads an audit_events row as ChainRowText. Every value is the text
 * Postgres itself produces (jsonb included), so the hash is recomputed from the same bytes
 * the audit_events_chain trigger hashed; JSON is never re-serialised here.
 */
export const CHAIN_ROW_SELECT = `chain_seq::text AS chain_seq, prev_hash, id::text AS id, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at_utc, request_id, actor_id::text AS actor_id, actor_role, action, entity_type, entity_id, branch_id::text AS branch_id, report_id::text AS report_id, before::text AS before_text, after::text AS after_text, hash`;

const VERSION_TAG = 'shiplens-audit-v1';

// Must match audit_chain_field() in SQL: the byte-length prefix makes the encoding unambiguous.
function field(v: string | null): string {
  return v === null ? '|-' : `|${Buffer.byteLength(v, 'utf8')}:${v}`;
}

/** Canonical form v1 of an audit row; byte-identical to audit_event_canonical() in SQL. */
export function canonicalV1(row: Omit<ChainRowText, 'hash'>): string {
  return (
    VERSION_TAG +
    field(row.chain_seq) +
    field(row.prev_hash) +
    field(row.id) +
    field(row.occurred_at_utc) +
    field(row.request_id) +
    field(row.actor_id) +
    field(row.actor_role) +
    field(row.action) +
    field(row.entity_type) +
    field(row.entity_id) +
    field(row.branch_id) +
    field(row.report_id) +
    field(row.before_text) +
    field(row.after_text)
  );
}

/** SHA-256 of the UTF-8 bytes of a canonical string, as 64 lowercase hex characters. */
export function hashCanonical(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
