import { afterAll, describe, expect, it } from 'vitest';
import { addDays, pktWeekStart } from '@/platform/time';
import { closeTestPool, testPool } from '../support/db';

afterAll(async () => {
  await closeTestPool();
});

describe('SQL and TS week start parity', () => {
  it('pkt_week_start(d) equals pktWeekStart(d) for 400 consecutive dates', async () => {
    const dates = Array.from({ length: 400 }, (_, i) => addDays('2025-12-01', i));
    const { rows } = await testPool().query<{ d: string; w: string }>(
      'SELECT d, pkt_week_start(d::date) AS w FROM unnest($1::text[]) AS t(d)',
      [dates],
    );
    expect(rows).toHaveLength(400);
    const mismatches = rows.filter((r) => r.w !== pktWeekStart(r.d));
    expect(mismatches).toEqual([]);
  });
});
