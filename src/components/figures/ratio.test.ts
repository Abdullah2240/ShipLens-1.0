import { describe, expect, it } from 'vitest';
import { basisPoints, bpToPercent, compactMinor, niceCeiling, ticks } from './ratio';

describe('basisPoints', () => {
  it('floors the ratio in basis points', () => {
    expect(basisPoints('250.50', '1750.50')).toBe(1431);
  });

  it('is 0 for a zero total, never NaN', () => {
    expect(basisPoints('0.00', '0.00')).toBe(0);
    expect(basisPoints('12.00', '0.00')).toBe(0);
    expect(Number.isNaN(basisPoints('0', '0'))).toBe(false);
  });

  it('is 10000 for the whole', () => {
    expect(basisPoints('1750.50', '1750.50')).toBe(10000);
  });

  it('keeps precision on a 12-digit total', () => {
    // 1 minor unit out of 999,999,999,999.99 is far below one basis point
    expect(basisPoints('0.01', '999999999999.99')).toBe(0);
    expect(basisPoints('999999999999.98', '999999999999.99')).toBe(9999);
    expect(basisPoints('500000000000.00', '999999999999.99')).toBe(5000);
    expect(basisPoints('123456789012.34', '123456789012.34')).toBe(10000);
  });

  it('matches the identity bar shares', () => {
    expect(basisPoints('1750.50', '2100.75')).toBe(8332);
    expect(basisPoints('300.00', '2100.75')).toBe(1428);
    expect(basisPoints('50.25', '2100.75')).toBe(239);
  });

  it('clamps to the 0..10000 range', () => {
    expect(basisPoints('-5.00', '10.00')).toBe(0);
    expect(basisPoints('20.00', '10.00')).toBe(10000);
    expect(basisPoints('5.00', '-10.00')).toBe(0);
  });

  it('rejects a non-decimal string', () => {
    expect(() => basisPoints('1e3', '10.00')).toThrow();
  });
});

describe('bpToPercent', () => {
  it('formats basis points as a two-decimal percentage', () => {
    expect(bpToPercent(8332)).toBe('83.32%');
    expect(bpToPercent(239)).toBe('2.39%');
    expect(bpToPercent(5)).toBe('0.05%');
    expect(bpToPercent(0)).toBe('0.00%');
    expect(bpToPercent(10000)).toBe('100.00%');
  });
});

describe('niceCeiling', () => {
  it('rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceCeiling(123456n)).toBe(200000n);
    expect(niceCeiling(200000n)).toBe(200000n);
    expect(niceCeiling(200001n)).toBe(250000n);
    expect(niceCeiling(250001n)).toBe(500000n);
    expect(niceCeiling(500001n)).toBe(1000000n);
    expect(niceCeiling(100000n)).toBe(100000n);
  });

  it('has a minimal visible scale', () => {
    expect(niceCeiling(0n)).toBe(100n);
    expect(niceCeiling(-50n)).toBe(100n);
    expect(niceCeiling(7n)).toBe(100n);
  });

  it('handles very large totals exactly', () => {
    expect(niceCeiling(99999999999999n)).toBe(100000000000000n);
  });
});

describe('ticks', () => {
  it('returns count + 1 evenly spaced values from 0 to the ceiling', () => {
    expect(ticks(123456n, 4)).toEqual([0n, 50000n, 100000n, 150000n, 200000n]);
  });

  it('picks a tick count that keeps labels round by default', () => {
    expect(ticks(240000n)).toEqual([0n, 50000n, 100000n, 150000n, 200000n, 250000n]);
    expect(ticks(410000n)).toEqual([0n, 100000n, 200000n, 300000n, 400000n, 500000n]);
    expect(ticks(150000n)).toEqual([0n, 50000n, 100000n, 150000n, 200000n]);
    expect(ticks(0n)).toEqual([0n, 25n, 50n, 75n, 100n]);
  });
});

describe('compactMinor', () => {
  it('shortens whole rupees with Latin digits', () => {
    expect(compactMinor(0n)).toBe('0');
    expect(compactMinor(50n)).toBe('0.50');
    expect(compactMinor(25000n)).toBe('250');
    expect(compactMinor(5000000n)).toBe('50k');
    expect(compactMinor(12500000n)).toBe('125k');
    expect(compactMinor(150000000n)).toBe('1.5M');
    expect(compactMinor(250000000n)).toBe('2.5M');
    expect(compactMinor(1000000000n)).toBe('10M');
    expect(compactMinor(62500000n)).toBe('625k');
    expect(compactMinor(125000n)).toBe('1.25k');
  });
});
