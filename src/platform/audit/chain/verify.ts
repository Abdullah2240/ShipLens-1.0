// Independent verifier for the audit hash chain. Every hash is recomputed here in Node from
// the row read back as text; the database's own hash functions are never trusted or called.
import type { Queryable } from '@/platform/db';
import { systemClock, type Clock } from '@/platform/time';
import { CHAIN_ROW_SELECT, canonicalV1, hashCanonical } from './canonical';
import { GENESIS_HASH, type ChainBreakReason, type ChainRowText, type ChainStatus } from './types';

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_AGE_MS = 60_000;

// Keyset paging. CHAIN_ROW_SELECT aliases chain_seq as text, so both the filter and the
// ORDER BY name the qualified column: the alias would sort '10' before '2'.
const PAGE_SQL = `SELECT ${CHAIN_ROW_SELECT} FROM audit_events WHERE audit_events.chain_seq > $1 ORDER BY audit_events.chain_seq LIMIT $2`;

function toSeq(raw: string): number {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) {
    throw new Error(`audit chain_seq is not a safe integer: ${raw}`);
  }
  return n;
}

/**
 * Walks the whole chain in chain_seq order and reports the first failure, checked per row
 * in this order:
 *   sequence_gap   chain_seq is not the previous one plus 1 (the first must be 1);
 *   hash_mismatch  the stored hash is not SHA-256 of the row's canonical form v1, so a stored
 *                  column was edited (prev_hash is part of the canonical form);
 *   link_mismatch  the row is self-consistent but prev_hash is not the previous row's hash
 *                  (genesis for the first), so an earlier row was forged and re-hashed.
 * The content check runs before the link check so that editing any single stored column,
 * prev_hash included, is reported as hash_mismatch at the edited row.
 * `checkedEvents` counts the rows that passed every check, so for a broken chain it is the
 * number of intact rows before the break.
 */
export async function verifyAuditChain(
  db: Queryable,
  opts: { batchSize?: number; clock?: Clock } = {},
): Promise<ChainStatus> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError(`batchSize must be a positive integer: ${batchSize}`);
  }
  const clock = opts.clock ?? systemClock;

  let lastSeq = 0;
  let prevHash = GENESIS_HASH;
  let checked = 0;

  for (;;) {
    const { rows } = await db.query<ChainRowText>(PAGE_SQL, [lastSeq, batchSize]);
    for (const row of rows) {
      const seq = toSeq(row.chain_seq);
      const { hash, ...content } = row;
      let reason: ChainBreakReason | null = null;
      if (seq !== lastSeq + 1) reason = 'sequence_gap';
      else if (hashCanonical(canonicalV1(content)) !== hash) reason = 'hash_mismatch';
      else if (row.prev_hash !== prevHash) reason = 'link_mismatch';
      if (reason) {
        return {
          status: 'broken',
          checkedEvents: checked,
          brokenAt: { chainSeq: seq, eventId: row.id, reason },
          checkedAt: clock.now().toISOString(),
        };
      }
      lastSeq = seq;
      prevHash = row.hash;
      checked += 1;
    }
    if (rows.length < batchSize) break;
  }

  const checkedAt = clock.now().toISOString();
  if (checked === 0) return { status: 'empty', checkedEvents: 0, checkedAt };
  return {
    status: 'intact',
    checkedEvents: checked,
    head: { chainSeq: lastSeq, hash: prevHash },
    checkedAt,
  };
}

// Process-wide cache: one chain per deployment, so it is not keyed by db.
interface CacheState {
  value: ChainStatus | null;
  at: number;
  inflight: Promise<ChainStatus> | null;
  /** Incremented per verification started; only the newest may write the cache. */
  generation: number;
}

const cache: CacheState = { value: null, at: 0, inflight: null, generation: 0 };

/**
 * Cached chain status for pages and the API. A result younger than maxAgeMs (default 60 s)
 * is returned as is; concurrent callers share one verification (single flight). `fresh`
 * always starts a new verification, never joining one that began before the call. A failed
 * verification is not cached and its error reaches every caller of that flight.
 */
export async function getChainStatus(
  db: Queryable,
  opts: { fresh?: boolean; maxAgeMs?: number; clock?: Clock } = {},
): Promise<ChainStatus> {
  const clock = opts.clock ?? systemClock;
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  if (!opts.fresh) {
    if (cache.value && clock.now().getTime() - cache.at < maxAgeMs) return cache.value;
    if (cache.inflight) return cache.inflight;
  }

  const generation = ++cache.generation;
  const flight = verifyAuditChain(db, { clock }).then(
    (value) => {
      if (generation === cache.generation) {
        cache.value = value;
        cache.at = clock.now().getTime();
        cache.inflight = null;
      }
      return value;
    },
    (err: unknown) => {
      if (generation === cache.generation) cache.inflight = null;
      throw err;
    },
  );
  cache.inflight = flight;
  return flight;
}

/** Forgets the cached status and any running flight (tests, and after a known change). */
export function resetChainStatusCache(): void {
  cache.value = null;
  cache.at = 0;
  cache.inflight = null;
  cache.generation += 1;
}
