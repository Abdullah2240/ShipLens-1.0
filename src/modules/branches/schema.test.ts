import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assignLeadSchema,
  branchCreateSchema,
  branchListQuerySchema,
  branchPatchSchema,
  branchTransitionSchema,
} from './schema';

const message = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('branchCreateSchema', () => {
  it('trims and keeps the allowed fields', () => {
    expect(
      branchCreateSchema.parse({ name: '  Lahore North ', city: ' Lahore ', summary: ' Hub ' }),
    ).toEqual({ name: 'Lahore North', city: 'Lahore', summary: 'Hub' });
    expect(branchCreateSchema.parse({ name: 'Quetta' })).toEqual({ name: 'Quetta' });
  });

  it('normalises empty optional text to null', () => {
    expect(branchCreateSchema.parse({ name: 'Quetta', city: '  ', summary: '' })).toEqual({
      name: 'Quetta',
      city: null,
      summary: null,
    });
  });

  it('bounds the name, city and summary', () => {
    expect(message(branchCreateSchema.safeParse({ name: ' a ' }))).toBe('too_short');
    expect(message(branchCreateSchema.safeParse({ name: 'x'.repeat(81) }))).toBe('too_long');
    expect(branchCreateSchema.safeParse({ name: 'x'.repeat(80) }).success).toBe(true);
    expect(message(branchCreateSchema.safeParse({ name: 'Ok', city: 'c'.repeat(61) }))).toBe(
      'too_long',
    );
    expect(message(branchCreateSchema.safeParse({ name: 'Ok', summary: 's'.repeat(501) }))).toBe(
      'too_long',
    );
    expect(message(branchCreateSchema.safeParse({}))).toBe('required');
  });

  it('rejects unknown keys including code and status', () => {
    expect(branchCreateSchema.safeParse({ name: 'Quetta', code: 'BR001' }).success).toBe(false);
    expect(branchCreateSchema.safeParse({ name: 'Quetta', status: 'active' }).success).toBe(false);
    expect(branchCreateSchema.safeParse({ name: 'Quetta', other: 1 }).success).toBe(false);
  });
});

describe('branchPatchSchema', () => {
  it('accepts any subset and normalises empty text to null', () => {
    expect(branchPatchSchema.parse({ name: ' New ' })).toEqual({ name: 'New' });
    expect(branchPatchSchema.parse({ city: '' })).toEqual({ city: null });
    expect(branchPatchSchema.parse({ summary: null })).toEqual({ summary: null });
    expect(branchPatchSchema.parse({ city: 'Multan', summary: 'Text' })).toEqual({
      city: 'Multan',
      summary: 'Text',
    });
  });

  it('requires at least one key', () => {
    expect(message(branchPatchSchema.safeParse({}))).toBe('empty_patch');
  });

  it('rejects unknown keys and a null name', () => {
    expect(branchPatchSchema.safeParse({ code: 'BR009' }).success).toBe(false);
    expect(branchPatchSchema.safeParse({ status: 'closed' }).success).toBe(false);
    expect(branchPatchSchema.safeParse({ name: null }).success).toBe(false);
    expect(message(branchPatchSchema.safeParse({ name: 'x' }))).toBe('too_short');
  });
});

describe('branchTransitionSchema and assignLeadSchema', () => {
  it('accepts only the four statuses', () => {
    for (const to of ['forming', 'active', 'paused', 'closed'])
      expect(branchTransitionSchema.parse({ to })).toEqual({ to });
    expect(branchTransitionSchema.safeParse({ to: 'archived' }).success).toBe(false);
    expect(branchTransitionSchema.safeParse({}).success).toBe(false);
    expect(branchTransitionSchema.safeParse({ to: 'active', extra: true }).success).toBe(false);
  });

  it('requires a UUID user id', () => {
    const userId = randomUUID();
    expect(assignLeadSchema.parse({ userId })).toEqual({ userId });
    expect(assignLeadSchema.safeParse({ userId: 'nope' }).success).toBe(false);
    expect(assignLeadSchema.safeParse({}).success).toBe(false);
    expect(assignLeadSchema.safeParse({ userId, role: 'hr_lead' }).success).toBe(false);
  });
});

describe('branchListQuerySchema', () => {
  it('keeps a known status and drops anything else', () => {
    expect(branchListQuerySchema.parse({ status: 'forming' })).toEqual({ status: 'forming' });
    expect(branchListQuerySchema.parse({ status: 'archived' })).toEqual({});
    expect(branchListQuerySchema.parse({ other: 'x' })).toEqual({});
    expect(branchListQuerySchema.parse({})).toEqual({});
  });
});
