import { describe, expect, it } from 'vitest';
import { pktLocalToUtcIso, utcIsoToPktLocal } from './event-time';

describe('pktLocalToUtcIso', () => {
  it('subtracts five hours from a Pakistan wall-clock time', () => {
    expect(pktLocalToUtcIso('2026-11-15T14:30')).toBe('2026-11-15T09:30:00.000Z');
  });

  it('crosses midnight back into the previous UTC day', () => {
    expect(pktLocalToUtcIso('2026-11-15T03:00')).toBe('2026-11-14T22:00:00.000Z');
  });

  it('crosses month and year boundaries', () => {
    expect(pktLocalToUtcIso('2026-03-01T00:00')).toBe('2026-02-28T19:00:00.000Z');
    expect(pktLocalToUtcIso('2027-01-01T04:59')).toBe('2026-12-31T23:59:00.000Z');
    expect(pktLocalToUtcIso('2028-03-01T02:15')).toBe('2028-02-29T21:15:00.000Z');
  });

  it('accepts a value with seconds from a browser that sends them', () => {
    expect(pktLocalToUtcIso('2026-11-15T14:30:45')).toBe('2026-11-15T09:30:45.000Z');
  });

  it.each([
    '',
    'not a date',
    '2026-13-45T10:00',
    '2026-02-30T10:00',
    '2027-02-29T10:00',
    '2026-11-15T24:00',
    '2026-11-15T10:60',
    '2026-11-15',
    '2026-11-15T10:00Z',
    '2026-11-15T10:00:00.000Z',
    ' 2026-11-15T10:00',
  ])('returns null for %j', (value) => {
    expect(pktLocalToUtcIso(value)).toBeNull();
  });
});

describe('utcIsoToPktLocal', () => {
  it('adds five hours and returns a datetime-local value', () => {
    expect(utcIsoToPktLocal('2026-11-15T09:30:00.000Z')).toBe('2026-11-15T14:30');
    expect(utcIsoToPktLocal('2026-11-14T22:00:00.000Z')).toBe('2026-11-15T03:00');
    expect(utcIsoToPktLocal('2026-12-31T19:00:00Z')).toBe('2027-01-01T00:00');
  });

  it('returns an empty string for null, empty or unreadable values', () => {
    expect(utcIsoToPktLocal(null)).toBe('');
    expect(utcIsoToPktLocal('')).toBe('');
    expect(utcIsoToPktLocal('not a date')).toBe('');
  });

  it.each([
    '2026-11-15T09:30:00.000Z',
    '2026-11-14T22:00:00.000Z',
    '2026-01-31T21:00:00.000Z',
    '2026-02-28T19:00:00.000Z',
    '2028-02-28T19:30:00.000Z',
    '2026-12-31T18:59:00.000Z',
    '2026-12-31T19:00:00.000Z',
    '2026-12-31T23:59:00.000Z',
    '1999-12-31T19:00:00.000Z',
    '2026-06-30T19:05:00.000Z',
  ])('round-trips %s through the editor value', (iso) => {
    const local = utcIsoToPktLocal(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(pktLocalToUtcIso(local)).toBe(iso);
  });

  it('round-trips every hour of a day across a year boundary', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const day of ['2026-12-31', '2027-01-01']) {
        const local = `${day}T${String(hour).padStart(2, '0')}:45`;
        expect(utcIsoToPktLocal(pktLocalToUtcIso(local))).toBe(local);
      }
    }
  });
});
