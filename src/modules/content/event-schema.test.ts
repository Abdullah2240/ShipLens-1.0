import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eventInputSchema, eventPatchSchema } from './event-schema';

const issues = (schema: typeof eventInputSchema | typeof eventPatchSchema, value: unknown) =>
  schema.safeParse(value).error?.issues.map((issue) => [issue.path.join('.'), issue.message]);

describe('eventInputSchema', () => {
  it('accepts a minimal event and trims strings', () => {
    expect(eventInputSchema.parse({ titleEn: 'Health camp' })).toEqual({ titleEn: 'Health camp' });
    expect(
      eventInputSchema.parse({
        titleEn: '  Health camp  ',
        titleUr: '  طبی کیمپ ',
        summaryEn: ' Free checkups ',
        location: ' Community hall ',
      }),
    ).toEqual({
      titleEn: 'Health camp',
      titleUr: 'طبی کیمپ',
      summaryEn: 'Free checkups',
      location: 'Community hall',
    });
  });

  it('turns empty optional strings into null', () => {
    expect(
      eventInputSchema.parse({
        titleEn: 'Health camp',
        titleUr: '  ',
        summaryEn: '',
        summaryUr: '',
        location: ' ',
        startsAt: '',
        endsAt: '',
        branchId: '',
      }),
    ).toEqual({
      titleEn: 'Health camp',
      titleUr: null,
      summaryEn: null,
      summaryUr: null,
      location: null,
      startsAt: null,
      endsAt: null,
      branchId: null,
    });
    expect(
      eventInputSchema.parse({ titleEn: 'x', titleUr: null, startsAt: null, branchId: null }),
    ).toEqual({ titleEn: 'x', titleUr: null, startsAt: null, branchId: null });
  });

  it('requires an English title', () => {
    expect(issues(eventInputSchema, {})).toEqual([['titleEn', 'required']]);
    expect(issues(eventInputSchema, { titleEn: '' })).toEqual([['titleEn', 'required']]);
    expect(issues(eventInputSchema, { titleEn: '   ' })).toEqual([['titleEn', 'required']]);
    expect(issues(eventInputSchema, { titleEn: null })).toEqual([['titleEn', 'required']]);
  });

  it('bounds title, summary and location length', () => {
    expect(eventInputSchema.safeParse({ titleEn: 'x'.repeat(200) }).success).toBe(true);
    expect(issues(eventInputSchema, { titleEn: 'x'.repeat(201) })).toEqual([
      ['titleEn', 'too_long'],
    ]);
    expect(issues(eventInputSchema, { titleEn: 'x', titleUr: 'x'.repeat(201) })).toEqual([
      ['titleUr', 'too_long'],
    ]);
    expect(eventInputSchema.safeParse({ titleEn: 'x', summaryEn: 'x'.repeat(2000) }).success).toBe(
      true,
    );
    expect(issues(eventInputSchema, { titleEn: 'x', summaryEn: 'x'.repeat(2001) })).toEqual([
      ['summaryEn', 'too_long'],
    ]);
    expect(issues(eventInputSchema, { titleEn: 'x', summaryUr: 'x'.repeat(2001) })).toEqual([
      ['summaryUr', 'too_long'],
    ]);
    expect(issues(eventInputSchema, { titleEn: 'x', location: 'x'.repeat(201) })).toEqual([
      ['location', 'too_long'],
    ]);
  });

  it('accepts UTC instants with or without milliseconds', () => {
    expect(
      eventInputSchema.parse({
        titleEn: 'x',
        startsAt: '2026-11-15T09:00:00Z',
        endsAt: '2026-11-15T11:00:00.000Z',
      }),
    ).toEqual({
      titleEn: 'x',
      startsAt: '2026-11-15T09:00:00Z',
      endsAt: '2026-11-15T11:00:00.000Z',
    });
  });

  it('rejects offsets, bare dates and nonsense as invalid_datetime', () => {
    for (const value of [
      '2026-11-15T09:00:00+05:00',
      '2026-11-15',
      '2026-11-15T09:00:00',
      'tomorrow',
      '2026-13-45T09:00:00Z',
      42,
    ]) {
      expect(issues(eventInputSchema, { titleEn: 'x', startsAt: value })).toEqual([
        ['startsAt', 'invalid_datetime'],
      ]);
      expect(issues(eventInputSchema, { titleEn: 'x', endsAt: value })).toEqual([
        ['endsAt', 'invalid_datetime'],
      ]);
    }
  });

  it('rejects an end before the start on endsAt and allows equal or missing times', () => {
    expect(
      issues(eventInputSchema, {
        titleEn: 'x',
        startsAt: '2026-11-15T09:00:00Z',
        endsAt: '2026-11-15T08:59:59.999Z',
      }),
    ).toEqual([['endsAt', 'ends_before_start']]);
    expect(
      eventInputSchema.safeParse({
        titleEn: 'x',
        startsAt: '2026-11-15T09:00:00Z',
        endsAt: '2026-11-15T09:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      eventInputSchema.safeParse({ titleEn: 'x', endsAt: '2026-11-15T09:00:00Z' }).success,
    ).toBe(true);
    expect(
      eventInputSchema.safeParse({ titleEn: 'x', startsAt: '2026-11-15T09:00:00Z' }).success,
    ).toBe(true);
  });

  it('requires branchId to be a UUID or null', () => {
    const id = randomUUID();
    expect(eventInputSchema.parse({ titleEn: 'x', branchId: id })).toEqual({
      titleEn: 'x',
      branchId: id,
    });
    expect(issues(eventInputSchema, { titleEn: 'x', branchId: 'branch-1' })).toEqual([
      ['branchId', 'invalid_branch'],
    ]);
    expect(issues(eventInputSchema, { titleEn: 'x', branchId: 7 })).toEqual([
      ['branchId', 'invalid_branch'],
    ]);
  });

  it('rejects unknown keys and wrong types', () => {
    expect(eventInputSchema.safeParse({ titleEn: 'x', status: 'published' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ titleEn: 'x', slug: 'evt-1' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ titleEn: 5 }).success).toBe(false);
    expect(eventInputSchema.safeParse({ titleEn: 'x', location: ['hall'] }).success).toBe(false);
  });
});

describe('eventPatchSchema', () => {
  it('rejects an empty patch', () => {
    expect(issues(eventPatchSchema, {})).toEqual([['', 'empty_patch']]);
  });

  it('accepts any single field, including an explicit null', () => {
    expect(eventPatchSchema.parse({ location: 'Hall' })).toEqual({ location: 'Hall' });
    expect(eventPatchSchema.parse({ endsAt: null })).toEqual({ endsAt: null });
    expect(eventPatchSchema.parse({ startsAt: '2026-11-15T12:00:00.000Z' })).toEqual({
      startsAt: '2026-11-15T12:00:00.000Z',
    });
    expect(eventPatchSchema.parse({ summaryUr: '' })).toEqual({ summaryUr: null });
  });

  it('keeps the English title required when it is sent', () => {
    expect(issues(eventPatchSchema, { titleEn: '' })).toEqual([['titleEn', 'required']]);
    expect(issues(eventPatchSchema, { titleEn: null })).toEqual([['titleEn', 'required']]);
  });

  it('applies the date pair rule when both dates are in the patch', () => {
    expect(
      issues(eventPatchSchema, {
        startsAt: '2026-11-15T12:00:00Z',
        endsAt: '2026-11-15T11:00:00Z',
      }),
    ).toEqual([['endsAt', 'ends_before_start']]);
    expect(
      eventPatchSchema.safeParse({
        startsAt: '2026-11-15T10:00:00Z',
        endsAt: '2026-11-15T11:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown keys and bad values', () => {
    expect(eventPatchSchema.safeParse({ status: 'draft' }).success).toBe(false);
    expect(issues(eventPatchSchema, { startsAt: '2026-11-15' })).toEqual([
      ['startsAt', 'invalid_datetime'],
    ]);
    expect(issues(eventPatchSchema, { branchId: 'nope' })).toEqual([
      ['branchId', 'invalid_branch'],
    ]);
  });
});
