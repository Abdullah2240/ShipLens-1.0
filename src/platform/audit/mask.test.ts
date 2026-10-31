import { describe, expect, it } from 'vitest';
import { AUDIT_FIELD_ALLOWLIST } from './allowlist';
import { snapshotChanges } from './mask';

describe('snapshotChanges', () => {
  it('returns only changed allowlisted fields on update', () => {
    const result = snapshotChanges(
      'collection',
      { amount: '100.00', purpose: 'zakat', status: 'draft' },
      { amount: '150.00', purpose: 'zakat', status: 'draft' },
    );
    expect(result).toEqual({ before: { amount: '100.00' }, after: { amount: '150.00' } });
  });

  it('includes every allowlisted field of after on create', () => {
    const result = snapshotChanges('branch', null, {
      code: 'KHI',
      name: 'Karachi',
      city: 'Karachi',
      status: 'active',
      summary: null,
    });
    expect(result.before).toBeNull();
    expect(result.after).toEqual({
      code: 'KHI',
      name: 'Karachi',
      city: 'Karachi',
      status: 'active',
      summary: null,
    });
  });

  it('includes only before on delete-like events', () => {
    const result = snapshotChanges('team', { name: 'Alpha', branch_id: 'b1' }, null);
    expect(result.after).toBeNull();
    expect(result.before).toEqual({ name: 'Alpha', branch_id: 'b1' });
  });

  it('returns nothing for a no-op update', () => {
    const result = snapshotChanges('team', { name: 'Alpha' }, { name: 'Alpha' });
    expect(result).toEqual({ before: {}, after: {} });
  });

  it('never leaks fields that are not on the allowlist', () => {
    const result = snapshotChanges(
      'user',
      { role: 'branch_lead', password_hash: 'h1', token_hash: 't1', email: 'a@b.test' },
      { role: 'hr_lead', password_hash: 'h2', token_hash: 't2', email: 'c@d.test' },
    );
    expect(result).toEqual({ before: { role: 'branch_lead' }, after: { role: 'hr_lead' } });
    expect(JSON.stringify(result)).not.toMatch(/hash|@/);
  });

  it('keeps application contact details and free text out of snapshots', () => {
    const result = snapshotChanges(
      'application',
      { status: 'pending', email: 'x@y.test', phone: '0300', message: 'hello', name: 'N' },
      {
        status: 'approved',
        email: 'x@y.test',
        phone: '0301',
        message: 'bye',
        name: 'M',
        decision_note: 'ok',
      },
    );
    expect(result.after).toEqual({ status: 'approved', decision_note: 'ok' });
    expect(result.before).toEqual({ status: 'pending', decision_note: null });
  });

  it('gives sessions an empty snapshot even if fields are supplied', () => {
    expect(AUDIT_FIELD_ALLOWLIST.session).toEqual([]);
    const result = snapshotChanges('session', null, { token_hash: 'abc', user_id: 'u1' });
    expect(result).toEqual({ before: null, after: {} });
  });

  it('fails closed on an unknown entity type', () => {
    expect(() => snapshotChanges('mystery', null, { a: 1 })).toThrow(/unknown audit entity/i);
    expect(() => snapshotChanges('mystery', null, null)).toThrow(/unknown audit entity/i);
  });

  it('does not treat inherited object keys as entity types', () => {
    expect(() => snapshotChanges('constructor', null, null)).toThrow(/unknown audit entity/i);
    expect(() => snapshotChanges('__proto__', null, null)).toThrow(/unknown audit entity/i);
  });

  it('serialises Date and bigint values to strings', () => {
    const at = new Date('2026-10-28T10:00:00.000Z');
    const result = snapshotChanges('event', null, { starts_at: at, slug: 's', status: 'draft' });
    expect(result.after).toEqual({
      starts_at: '2026-10-28T10:00:00.000Z',
      slug: 's',
      status: 'draft',
    });

    const big = snapshotChanges('report', { version: 1n }, { version: 2n });
    expect(big).toEqual({ before: { version: '1' }, after: { version: '2' } });
  });

  it('treats equal Date values as unchanged', () => {
    const result = snapshotChanges(
      'event',
      { starts_at: new Date('2026-10-28T10:00:00Z') },
      { starts_at: new Date('2026-10-28T10:00:00Z') },
    );
    expect(result).toEqual({ before: {}, after: {} });
  });

  it('rejects nested objects and arrays in allowlisted fields', () => {
    expect(() => snapshotChanges('branch', null, { summary: { nested: true } })).toThrow(/scalar/i);
    expect(() => snapshotChanges('branch', null, { name: ['a'] })).toThrow(/scalar/i);
  });

  it('ignores non-scalar values in fields that are not allowlisted', () => {
    const result = snapshotChanges('branch', null, { name: 'N', extra: { deep: 1 } });
    expect(result.after).toEqual({ name: 'N' });
  });

  it('skips allowlisted fields absent from a partial update', () => {
    const result = snapshotChanges('branch', { name: 'Old', city: 'X' }, { name: 'New' });
    expect(result).toEqual({ before: { name: 'Old' }, after: { name: 'New' } });
  });
});

describe('AUDIT_FIELD_ALLOWLIST', () => {
  it('never allowlists secrets or application contact details', () => {
    const banned = [
      'password',
      'password_hash',
      'token',
      'token_hash',
      'email',
      'phone',
      'message',
      'body',
    ];
    for (const [entity, fields] of Object.entries(AUDIT_FIELD_ALLOWLIST)) {
      for (const f of fields) {
        expect(banned, `${entity}.${f}`).not.toContain(f);
      }
    }
    expect(AUDIT_FIELD_ALLOWLIST.application).not.toContain('name');
  });
});
