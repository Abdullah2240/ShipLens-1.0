import { describe, expect, it } from 'vitest';
import { createRng, mulberry32 } from './prng.mjs';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function take(next, n) {
  return Array.from({ length: n }, () => next());
}

describe('mulberry32', () => {
  it('yields the same sequence for the same seed', () => {
    expect(take(mulberry32(42), 50)).toEqual(take(mulberry32(42), 50));
  });

  it('yields different sequences for different seeds', () => {
    expect(take(mulberry32(42), 10)).not.toEqual(take(mulberry32(43), 10));
  });

  it('returns unsigned 32-bit integers', () => {
    for (const value of take(mulberry32(7), 1000)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('createRng', () => {
  it('keeps int(a, b) inside the bounds over 10,000 draws and reaches both ends', () => {
    const rng = createRng(1);
    const seen = new Set();
    for (let i = 0; i < 10000; i += 1) {
      const value = rng.int(3, 9);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('returns the bound when min equals max', () => {
    expect(createRng(5).int(4, 4)).toBe(4);
  });

  it('rejects an empty or inverted range', () => {
    expect(() => createRng(5).int(4, 3)).toThrow();
  });

  it('builds v4-shaped uuids that are unique over 1,000 draws', () => {
    const rng = createRng(99);
    const ids = take(() => rng.uuid(), 1000);
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(1000);
  });

  it('is deterministic for uuid, pick, chance and shuffle', () => {
    const run = () => {
      const rng = createRng(2026);
      return {
        ids: take(() => rng.uuid(), 5),
        picks: take(() => rng.pick(['a', 'b', 'c']), 20),
        chances: take(() => rng.chance(1, 3), 20),
        shuffled: rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8]),
      };
    };
    expect(run()).toEqual(run());
  });

  it('chance(n, d) is always false for 0 and always true for d', () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i += 1) {
      expect(rng.chance(0, 4)).toBe(false);
      expect(rng.chance(4, 4)).toBe(true);
    }
  });

  it('shuffle returns a permutation and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const copy = [...input];
    const out = createRng(11).shuffle(input);
    expect(input).toEqual(copy);
    expect([...out].sort((a, b) => a - b)).toEqual(copy);
  });

  it('pick rejects an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});
