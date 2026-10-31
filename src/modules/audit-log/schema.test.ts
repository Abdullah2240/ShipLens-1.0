import { describe, expect, it } from 'vitest';
import { AUDIT_LIMITS, parseAuditQuery } from './schema';

const ACTOR = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f';
const BRANCH = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';

describe('parseAuditQuery', () => {
  it('defaults to limit 50 and no filters', () => {
    expect(parseAuditQuery(new URLSearchParams())).toEqual({ limit: 50 });
    expect(parseAuditQuery({})).toEqual({ limit: 50 });
  });

  it('keeps every valid value', () => {
    const q = parseAuditQuery(
      new URLSearchParams({
        from: '2026-10-01',
        to: '2026-10-31',
        actor: ACTOR,
        action: 'collection.mark_routed',
        entity: 'collection',
        entityId: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
        branch: BRANCH,
        before: '12345',
        limit: '25',
      }),
    );
    expect(q).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      actor: ACTOR,
      action: 'collection.mark_routed',
      entity: 'collection',
      entityId: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
      branch: BRANCH.toLowerCase(),
      before: '12345',
      limit: 25,
    });
  });

  it('drops impossible and malformed dates', () => {
    expect(parseAuditQuery({ from: '2026-02-30', to: '2026-13-01' })).toEqual({ limit: 50 });
    expect(parseAuditQuery({ from: 'abc', to: '2026-1-1' })).toEqual({ limit: 50 });
    expect(parseAuditQuery({ from: '2028-02-29' })).toEqual({ from: '2028-02-29', limit: 50 });
  });

  it('swaps from and to when from is later', () => {
    expect(parseAuditQuery({ from: '2026-10-31', to: '2026-10-01' })).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('drops SQL-looking and malformed identifiers', () => {
    const q = parseAuditQuery({
      actor: "' OR 1=1 --",
      branch: 'not-a-uuid',
      action: "collection.create'; DROP TABLE audit_events; --",
      entity: 'Collection',
      entityId: 'abc; DELETE',
      before: '1 OR 1=1',
    });
    expect(q).toEqual({ limit: 50 });
  });

  it('drops an action without a dot and an over-long entity id', () => {
    expect(parseAuditQuery({ action: 'collection', entityId: 'a'.repeat(65) })).toEqual({
      limit: 50,
    });
    expect(parseAuditQuery({ entityId: 'a'.repeat(64) }).entityId).toBe('a'.repeat(64));
  });

  it('drops a before cursor longer than a bigint', () => {
    expect(parseAuditQuery({ before: '1'.repeat(19) }).before).toBeUndefined();
    expect(parseAuditQuery({ before: '9'.repeat(18) }).before).toBe('9'.repeat(18));
  });

  it('drops arrays and repeated keys', () => {
    expect(parseAuditQuery({ actor: [ACTOR, ACTOR], entity: ['collection'] })).toEqual({
      limit: 50,
    });
    const params = new URLSearchParams();
    params.append('entity', 'collection');
    params.append('entity', 'report');
    expect(parseAuditQuery(params)).toEqual({ limit: 50 });
  });

  it('clamps the limit to 1..200 and ignores non-numbers', () => {
    expect(parseAuditQuery({ limit: '9999' }).limit).toBe(AUDIT_LIMITS.maxLimit);
    expect(parseAuditQuery({ limit: '99999999999999999999' }).limit).toBe(200);
    expect(parseAuditQuery({ limit: '0' }).limit).toBe(1);
    expect(parseAuditQuery({ limit: '-5' }).limit).toBe(50);
    expect(parseAuditQuery({ limit: '10.5' }).limit).toBe(50);
    expect(parseAuditQuery({ limit: 'ten' }).limit).toBe(50);
  });

  it('never throws on arbitrary input (200 generated strings)', () => {
    let seed = 0x5eed;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = 'abcXYZ019-_.:;\'"%\\/ <>=()[]{}\u0000‮ب😀';
    const keys = [
      'from',
      'to',
      'actor',
      'action',
      'entity',
      'entityId',
      'branch',
      'before',
      'limit',
    ];
    for (let i = 0; i < 200; i += 1) {
      const length = next() % 80;
      let value = '';
      for (let j = 0; j < length; j += 1) value += alphabet[next() % alphabet.length];
      const params: Record<string, string> = {};
      for (const key of keys) params[key] = value;
      expect(() => parseAuditQuery(params)).not.toThrow();
      expect(() => parseAuditQuery(new URLSearchParams(params))).not.toThrow();
      const q = parseAuditQuery(params);
      expect(q.limit).toBeGreaterThanOrEqual(1);
      expect(q.limit).toBeLessThanOrEqual(200);
    }
  });
});
