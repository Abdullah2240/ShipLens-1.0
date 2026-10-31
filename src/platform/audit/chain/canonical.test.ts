import { describe, expect, it } from 'vitest';
import { CHAIN_ROW_SELECT, canonicalV1, hashCanonical } from './canonical';
import { GENESIS_HASH, type ChainRowText } from './types';

type CanonicalRow = Omit<ChainRowText, 'hash'>;

const ZEROS = '0000000000000000000000000000000000000000000000000000000000000000';

function baseRow(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    chain_seq: '1',
    prev_hash: GENESIS_HASH,
    id: '7',
    occurred_at_utc: '2026-10-28T10:00:00.123456Z',
    request_id: 'req-1',
    actor_id: null,
    actor_role: 'system',
    action: 'branch.create',
    entity_type: 'branch',
    entity_id: 'b-1',
    branch_id: null,
    report_id: null,
    before_text: null,
    after_text: '{"name": "A"}',
    ...overrides,
  };
}

describe('canonicalV1', () => {
  it('encodes a fixed row exactly', () => {
    expect(canonicalV1(baseRow())).toBe(
      'shiplens-audit-v1|1:1|64:' +
        ZEROS +
        '|1:7|27:2026-10-28T10:00:00.123456Z|5:req-1|-|6:system|13:branch.create|6:branch|3:b-1|-|-|-|13:{"name": "A"}',
    );
  });

  it('starts with the version tag followed by the first field', () => {
    expect(canonicalV1(baseRow()).startsWith('shiplens-audit-v1|')).toBe(true);
  });

  it('encodes null as a dash and the empty string as a zero length value', () => {
    const withNull = canonicalV1(baseRow({ request_id: null }));
    const withEmpty = canonicalV1(baseRow({ request_id: '' }));
    expect(withNull).toContain('|27:2026-10-28T10:00:00.123456Z|-|-|6:system');
    expect(withEmpty).toContain('|27:2026-10-28T10:00:00.123456Z|0:|-|6:system');
    expect(withNull).not.toBe(withEmpty);
  });

  it('prefixes values with their UTF-8 byte length, not their character count', () => {
    expect(canonicalV1(baseRow({ entity_id: 'رپورٹ' }))).toContain('|10:رپورٹ|');
    expect(canonicalV1(baseRow({ entity_id: 'a رپورٹ b' }))).toContain('|14:a رپورٹ b|');
  });

  it('does not let separators inside a value collide with a different field split', () => {
    const a = canonicalV1(baseRow({ action: 'x|3:abc', entity_type: 'y' }));
    const b = canonicalV1(baseRow({ action: 'x', entity_type: '3:abc|y' }));
    const c = canonicalV1(baseRow({ action: 'x|3', entity_type: ':abc|y' }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('follows the interface field order', () => {
    const names: (keyof CanonicalRow)[] = [
      'chain_seq',
      'prev_hash',
      'id',
      'occurred_at_utc',
      'request_id',
      'actor_id',
      'actor_role',
      'action',
      'entity_type',
      'entity_id',
      'branch_id',
      'report_id',
      'before_text',
      'after_text',
    ];
    const row = Object.fromEntries(names.map((n) => [n, n])) as unknown as CanonicalRow;
    expect(canonicalV1(row)).toBe(
      'shiplens-audit-v1' + names.map((n) => `|${Buffer.byteLength(n, 'utf8')}:${n}`).join(''),
    );
  });
});

describe('hashCanonical', () => {
  it('matches the SHA-256 test vector for abc', () => {
    expect(hashCanonical('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('returns 64 lowercase hex characters and hashes the UTF-8 bytes', () => {
    const h = hashCanonical(canonicalV1(baseRow({ after_text: '{"title": "رپورٹ"}' })));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCanonical('رپورٹ')).not.toBe(hashCanonical('latin1'));
  });
});

describe('chain constants', () => {
  it('genesis is 64 zeros and the select list names every text column', () => {
    expect(GENESIS_HASH).toBe(ZEROS);
    for (const col of [
      'chain_seq',
      'prev_hash',
      'AS id',
      'occurred_at_utc',
      'request_id',
      'actor_id',
      'actor_role',
      'action',
      'entity_type',
      'entity_id',
      'branch_id',
      'report_id',
      'before_text',
      'after_text',
      'hash',
    ]) {
      expect(CHAIN_ROW_SELECT).toContain(col);
    }
  });
});
