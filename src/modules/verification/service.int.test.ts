// Public verification against the database: every integrity state, the seal check, the
// identical "not found" for unknown, malformed and non-approved codes, the scope rules of the
// authorised lookup, and the guarantee that no personal data reaches the public answer.
import type { PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import { approveReport, returnReport, submitReport } from '@/modules/reports';
import { command } from '@/platform/audit/command';
import { resetChainStatusCache } from '@/platform/audit/chain/verify';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound, mapError } from '@/platform/errors';
import { addDays, fixedClock, pktDate } from '@/platform/time';
import {
  formatCode,
  getReportVerification,
  lookupVerification,
  type PublicReportVerification,
} from './index';

const pool = testPool();
const WEEK = '2026-10-19';
const PERSON = { name: 'Ayesha Siddiqui', email: 'ayesha.lead@example.test' };
const NOTE = 'Envelope handed over at the gate by Bilal';
const PURPOSE = 'Flood relief envelopes, Saddar mosque';
const RETURN_REASON = 'Receipt for the Friday envelope is missing';

let branchA: string;
let branchB: string;
let actors: Record<
  'lead' | 'leadB' | 'finance' | 'superAdmin' | 'hr' | 'editor',
  Actor & { email: string; name: string }
>;
let n = 0;

afterAll(async () => {
  await resetDb(pool);
  await closeTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
  resetChainStatusCache();
  branchA = (await seedBranch(pool, { name: 'Karachi Central', city: 'Karachi' })).id;
  branchB = (await seedBranch(pool, { name: 'Lahore North', city: 'Lahore' })).id;
  const make = async (role: Actor['role'], branchId: string | null, extra = {}) => {
    const user = await seedUser(pool, { role, branchId, ...extra });
    return {
      userId: user.id,
      role,
      branchId: user.branch_id,
      email: user.email,
      name: user.name,
    };
  };
  actors = {
    lead: await make('branch_lead', branchA, PERSON),
    leadB: await make('branch_lead', branchB),
    finance: await make('finance_reviewer', null, { name: 'Imran Qureshi' }),
    superAdmin: await make('super_admin', null),
    hr: await make('hr_lead', branchA),
    editor: await make('content_editor', null),
  };
});

function ctx(actor: Actor): CommandContext {
  return {
    actor,
    requestId: `req-verify-${++n}`,
    clock: fixedClock('2026-10-28T10:00:00Z'),
    pool,
  };
}

/** One report audit event written through command(), as the Phase 2 services do. */
async function reportEvent(
  actor: Actor,
  action: string,
  reportId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  await command(ctx(actor), action, async (_tx, audit) => {
    audit({
      action,
      entityType: 'report',
      entityId: reportId,
      branchId: branchA,
      reportId,
      before,
      after,
    });
  });
}

/** Runs SQL as a database owner would, with a guard trigger off, all in one transaction. */
async function asOwner(
  table: string,
  trigger: string,
  edit: (client: PoolClient) => Promise<unknown>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    await edit(client);
    await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const editReport = (sql: string, params: unknown[]) =>
  asOwner('weekly_reports', 'weekly_reports_guard_update', (c) => c.query(sql, params));

/** A draft with collections (one carrying a note), taken to submitted and approved by SQL. */
async function approvedBySql(
  amounts = ['500.00', '500.50', '500.00'],
  weekStart = WEEK,
  branchId = branchA,
): Promise<string> {
  const lead = branchId === branchA ? actors.lead : actors.leadB;
  const seeded = await seedReport(pool, {
    branchId,
    weekStart,
    collections: amounts.map((amount) => ({ amount, purpose: PURPOSE, createdBy: lead.userId })),
  });
  await pool.query('UPDATE collections SET note = $2 WHERE id = $1', [
    seeded.collectionIds[0],
    NOTE,
  ]);
  await pool.query(
    `UPDATE weekly_reports
        SET status = 'submitted', submitted_at = now(), submitted_by = $2,
            total_amount = $3, collection_count = $4, version = version + 1
      WHERE id = $1`,
    [seeded.reportId, lead.userId, seeded.total, seeded.count],
  );
  await pool.query(
    `UPDATE weekly_reports
        SET status = 'approved', reviewed_at = now(), reviewed_by = $2, version = version + 1
      WHERE id = $1`,
    [seeded.reportId, actors.finance.userId],
  );
  return seeded.reportId;
}

const submitted = (total: string, count: number, version = 1) => ({
  status: 'submitted',
  total_amount: total,
  collection_count: count,
  version,
});

async function submitEvent(reportId: string, total = '1500.50', count = 3): Promise<void> {
  await reportEvent(
    actors.lead,
    'report.submit',
    reportId,
    { status: 'draft', total_amount: null, collection_count: null, version: 0 },
    submitted(total, count),
  );
}

async function approveEvent(reportId: string, status = 'approved'): Promise<void> {
  await reportEvent(
    actors.finance,
    'report.approve',
    reportId,
    { status: 'submitted', version: 1 },
    { status, version: 2 },
  );
}

/** The plan's fixture: approved by SQL, plus a submit and an approval audit event. */
async function anchoredReport(): Promise<{ reportId: string; code: string }> {
  const reportId = await approvedBySql();
  await submitEvent(reportId);
  await approveEvent(reportId);
  return { reportId, code: await codeOf(reportId) };
}

async function codeOf(reportId: string): Promise<string> {
  const { rows } = await pool.query<{ code: string }>(
    'SELECT code FROM report_verifications WHERE report_id = $1',
    [reportId],
  );
  if (!rows[0]) throw new Error(`no verification code for ${reportId}`);
  return rows[0].code;
}

async function anchorOf(reportId: string): Promise<{ chainSeq: number; hash: string }> {
  const { rows } = await pool.query<{ chain_seq: string; hash: string }>(
    `SELECT chain_seq::text, hash FROM audit_events
      WHERE entity_type = 'report' AND entity_id = $1 AND action = 'report.approve'
      ORDER BY chain_seq DESC LIMIT 1`,
    [reportId],
  );
  return { chainSeq: Number(rows[0]!.chain_seq), hash: rows[0]!.hash };
}

async function lookup(code: string, seal?: string): Promise<PublicReportVerification> {
  const result = await lookupVerification(pool, code, seal === undefined ? {} : { seal });
  expect(result).not.toBeNull();
  return result!;
}

describe('lookupVerification: a verified report', () => {
  it('returns the public projection with integrity verified', async () => {
    const { reportId, code } = await anchoredReport();
    const anchor = await anchorOf(reportId);
    const { rows } = await pool.query<{ reviewed_at: Date; events: string }>(
      `SELECT reviewed_at, (SELECT count(*) FROM audit_events)::text AS events
         FROM weekly_reports WHERE id = $1`,
      [reportId],
    );

    const result = await lookup(formatCode(code));
    expect(result).toEqual({
      code: formatCode(code),
      branch: { name: 'Karachi Central', city: 'Karachi' },
      weekStart: WEEK,
      weekEnd: addDays(WEEK, 6),
      approvedTotal: '1500.50',
      collectionCount: 3,
      approvedOn: pktDate(rows[0]!.reviewed_at),
      integrity: 'verified',
      anchor: { chainSeq: anchor.chainSeq, seal: anchor.hash.slice(0, 16) },
      sealCheck: 'not_provided',
      chain: {
        status: 'intact',
        checkedEvents: Number(rows[0]!.events),
        brokenAtSeq: null,
        checkedAt: expect.any(String),
      },
    });
    expect(result.weekEnd).toBe('2026-10-25');
  });

  it('accepts the code formatted, lowercased, with spaces or as stored', async () => {
    const { code } = await anchoredReport();
    const spaced = `  ${code.slice(0, 3)} ${code.slice(3, 7)} ${code.slice(7)} `;
    for (const raw of [code, formatCode(code), code.toLowerCase(), spaced]) {
      const result = await lookup(raw);
      expect(result.code, raw).toBe(formatCode(code));
      expect(result.integrity, raw).toBe('verified');
    }
  });

  it('has exactly the public keys and no personal data, ids, notes or purposes', async () => {
    const { reportId, code } = await anchoredReport();
    const result = await lookup(code, 'f'.repeat(16));
    expect(Object.keys(result).sort()).toEqual(
      [
        'anchor',
        'approvedOn',
        'approvedTotal',
        'branch',
        'chain',
        'code',
        'collectionCount',
        'integrity',
        'sealCheck',
        'weekEnd',
        'weekStart',
      ].sort(),
    );
    expect(Object.keys(result.branch).sort()).toEqual(['city', 'name']);
    expect(Object.keys(result.anchor!).sort()).toEqual(['chainSeq', 'seal']);
    expect(Object.keys(result.chain).sort()).toEqual(
      ['brokenAtSeq', 'checkedAt', 'checkedEvents', 'status'].sort(),
    );

    const json = JSON.stringify(result);
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id::text FROM collections WHERE report_id = $1',
      [reportId],
    );
    const forbidden = [
      PERSON.name,
      PERSON.email,
      actors.finance.name,
      actors.finance.email,
      actors.lead.userId,
      actors.finance.userId,
      branchA,
      reportId,
      NOTE,
      PURPOSE,
      ...rows.map((r) => r.id),
    ];
    for (const value of forbidden) expect(json).not.toContain(value);
  });
});

describe('lookupVerification: seal check', () => {
  it('matches the anchor seal and refuses any other value without throwing', async () => {
    const { reportId, code } = await anchoredReport();
    const seal = (await anchorOf(reportId)).hash.slice(0, 16);
    const other = seal.startsWith('0') ? `1${seal.slice(1)}` : `0${seal.slice(1)}`;

    expect((await lookup(code, seal)).sealCheck).toBe('match');
    expect((await lookup(code, other)).sealCheck).toBe('mismatch');
    for (const bad of [
      seal.toUpperCase(),
      `${seal}0`,
      seal.slice(0, 15),
      'not-a-seal',
      ' '.repeat(16),
    ]) {
      if (bad === seal) continue;
      expect((await lookup(code, bad)).sealCheck, bad).toBe('mismatch');
    }
    expect((await lookup(code)).sealCheck).toBe('not_provided');
    expect((await lookup(code, '')).sealCheck).toBe('not_provided');
  });
});

describe('lookupVerification: unanchored', () => {
  it('is unanchored with no anchor when no approval event exists', async () => {
    const reportId = await approvedBySql();
    await submitEvent(reportId);
    const result = await lookup(await codeOf(reportId), 'a'.repeat(16));
    expect(result.integrity).toBe('unanchored');
    expect(result.anchor).toBeNull();
    expect(result.sealCheck).toBe('mismatch');
  });

  it('is unanchored when the approval event has no submit event before it', async () => {
    const reportId = await approvedBySql();
    await approveEvent(reportId);
    const result = await lookup(await codeOf(reportId));
    expect(result.integrity).toBe('unanchored');
    expect(result.anchor).not.toBeNull();
  });

  it('ignores a submit event written after the approval event', async () => {
    const reportId = await approvedBySql();
    await approveEvent(reportId);
    await submitEvent(reportId);
    expect((await lookup(await codeOf(reportId))).integrity).toBe('unanchored');
  });
});

describe('lookupVerification: resubmitted reports', () => {
  it('checks against the resubmit event when the totals changed', async () => {
    const reportId = await approvedBySql();
    await submitEvent(reportId, '1000.00', 2);
    await reportEvent(
      actors.finance,
      'report.return',
      reportId,
      { status: 'submitted', return_reason: null, version: 1 },
      { status: 'returned', return_reason: RETURN_REASON, version: 2 },
    );
    await reportEvent(
      actors.lead,
      'report.resubmit',
      reportId,
      { status: 'returned', total_amount: '1000.00', collection_count: 2, version: 2 },
      submitted('1500.50', 3, 3),
    );
    await approveEvent(reportId);
    const result = await lookup(await codeOf(reportId));
    expect(result.integrity).toBe('verified');
    expect(JSON.stringify(result)).not.toContain(RETURN_REASON);
  });

  it('reads each total from the latest event recording it when a resubmit omits one', async () => {
    const reportId = await approvedBySql();
    await submitEvent(reportId, '1500.50', 2);
    // Only the count changed on resubmit, so the snapshot holds collection_count alone.
    await reportEvent(
      actors.lead,
      'report.resubmit',
      reportId,
      { status: 'returned', total_amount: '1500.50', collection_count: 2, version: 2 },
      submitted('1500.50', 3, 3),
    );
    await approveEvent(reportId);
    expect((await lookup(await codeOf(reportId))).integrity).toBe('verified');
  });

  it('a stale earlier submit with different totals is superseded by the resubmit', async () => {
    const reportId = await approvedBySql();
    await submitEvent(reportId, '1500.50', 3);
    await reportEvent(
      actors.lead,
      'report.resubmit',
      reportId,
      { status: 'returned', total_amount: '1500.50', collection_count: 3, version: 2 },
      submitted('900.00', 3, 3),
    );
    await approveEvent(reportId);
    expect((await lookup(await codeOf(reportId))).integrity).toBe('mismatch');
  });
});

describe('lookupVerification: the real report services', () => {
  async function draftWithCollections(): Promise<string> {
    const seeded = await seedReport(pool, {
      branchId: branchA,
      weekStart: WEEK,
      collections: ['500.00', '500.50', '500.00'].map((amount) => ({
        amount,
        purpose: PURPOSE,
        createdBy: actors.lead.userId,
      })),
    });
    return seeded.reportId;
  }

  it('submit then approve through the services is verified', async () => {
    const reportId = await draftWithCollections();
    await submitReport(ctx(actors.lead), reportId, {});
    await approveReport(ctx(actors.finance), reportId);
    const result = await lookup(await codeOf(reportId));
    expect(result.integrity).toBe('verified');
    expect(result.approvedTotal).toBe('1500.50');
    expect(result.collectionCount).toBe(3);
    const seal = (await anchorOf(reportId)).hash.slice(0, 16);
    expect((await lookup(await codeOf(reportId), seal)).sealCheck).toBe('match');
  });

  it('submit, return, resubmit with the same collections, approve is verified', async () => {
    const reportId = await draftWithCollections();
    await submitReport(ctx(actors.lead), reportId, {});
    await returnReport(ctx(actors.finance), reportId, { reason: RETURN_REASON });
    await submitReport(ctx(actors.lead), reportId, {});
    await approveReport(ctx(actors.finance), reportId);

    const { rows } = await pool.query<{ action: string; has_total: boolean }>(
      `SELECT action, after ? 'total_amount' AS has_total FROM audit_events
        WHERE entity_type = 'report' AND entity_id = $1 ORDER BY chain_seq`,
      [reportId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'report.submit',
      'report.return',
      'report.resubmit',
      'report.approve',
    ]);
    // Unchanged totals: the resubmit snapshot carries no total_amount.
    expect(rows[2]!.has_total).toBe(false);

    const result = await lookup(await codeOf(reportId));
    expect(result.integrity).toBe('verified');
    expect(JSON.stringify(result)).not.toContain(RETURN_REASON);
  });
});

describe('lookupVerification: mismatch', () => {
  it('is a mismatch when the report total is changed after approval', async () => {
    const { reportId, code } = await anchoredReport();
    await editReport('UPDATE weekly_reports SET total_amount = 1600.50 WHERE id = $1', [reportId]);
    const result = await lookup(code);
    expect(result.integrity).toBe('mismatch');
    expect(result.approvedTotal).toBe('1600.50');
  });

  it('is a mismatch when the collection count is changed after approval', async () => {
    const { reportId, code } = await anchoredReport();
    await editReport('UPDATE weekly_reports SET collection_count = 4 WHERE id = $1', [reportId]);
    expect((await lookup(code)).integrity).toBe('mismatch');
  });

  it('is a mismatch when the approval event does not record approved', async () => {
    const reportId = await approvedBySql();
    await submitEvent(reportId);
    await approveEvent(reportId, 'returned');
    expect((await lookup(await codeOf(reportId))).integrity).toBe('mismatch');
  });

  it('is a mismatch when the frozen totals of the submit event differ', async () => {
    const reportId = await approvedBySql();
    await submitEvent(reportId, '1500.00', 3);
    await approveEvent(reportId);
    expect((await lookup(await codeOf(reportId))).integrity).toBe('mismatch');
  });

  it('treats a non-numeric or missing recorded total as a mismatch, never an error', async () => {
    const reportId = await approvedBySql();
    await reportEvent(
      actors.lead,
      'report.submit',
      reportId,
      { status: 'draft', total_amount: null, version: 0 },
      { status: 'submitted', total_amount: 'one thousand', version: 1 },
    );
    await approveEvent(reportId);
    expect((await lookup(await codeOf(reportId))).integrity).toBe('mismatch');
  });
});

describe('lookupVerification: chain_broken', () => {
  it('reports chain_broken with the break point once the cached status is refreshed', async () => {
    const { code } = await anchoredReport();
    expect((await lookup(code)).chain.status).toBe('intact');

    // An edit that leaves the report's figures alone, so only the chain check can catch it.
    await asOwner('audit_events', 'audit_events_no_update_delete', (c) =>
      c.query("UPDATE audit_events SET request_id = 'forged' WHERE chain_seq = 1"),
    );
    // The status is cached for 60 s per process.
    expect((await lookup(code)).integrity).toBe('verified');

    resetChainStatusCache();
    const result = await lookup(code);
    expect(result.integrity).toBe('chain_broken');
    expect(result.chain).toEqual({
      status: 'broken',
      checkedEvents: 0,
      brokenAtSeq: 1,
      checkedAt: expect.any(String),
    });
  });

  it('chain_broken takes precedence over a totals mismatch', async () => {
    const { reportId, code } = await anchoredReport();
    await editReport('UPDATE weekly_reports SET total_amount = 1.00 WHERE id = $1', [reportId]);
    await asOwner('audit_events', 'audit_events_no_update_delete', (c) =>
      c.query(
        `UPDATE audit_events SET after = jsonb_set(after, '{total_amount}', '"1.00"')
          WHERE chain_seq = 1`,
      ),
    );
    expect((await lookup(code)).integrity).toBe('chain_broken');
  });
});

describe('lookupVerification: not found', () => {
  it('returns null for an unknown code, a malformed code and a non-approved report', async () => {
    const { reportId, code } = await anchoredReport();
    const unknown = code === '0000000000' ? '1111111111' : '0000000000';
    for (const raw of [
      unknown,
      '',
      'abc',
      `${code}0`,
      'ABCDE-FGHJK-X',
      '!!!!!!!!!!',
      'U'.repeat(10),
    ]) {
      expect(await lookupVerification(pool, raw), raw).toBeNull();
    }
    expect(await lookupVerification(pool, undefined as unknown as string)).toBeNull();

    // Cannot happen in production (approved reports are locked); simulated as an owner.
    await editReport("UPDATE weekly_reports SET status = 'submitted' WHERE id = $1", [reportId]);
    expect(await lookupVerification(pool, code)).toBeNull();
  });
});

describe('getReportVerification', () => {
  async function notFoundBody(promise: Promise<unknown>) {
    const err = await promise.then(
      () => {
        throw new Error('expected NotFound');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NotFound);
    return mapError(err, 'req-fixed').body;
  }

  it('gives the code, locale-free path and seal to every role that reads the report', async () => {
    const { reportId, code } = await anchoredReport();
    const seal = (await anchorOf(reportId)).hash.slice(0, 16);
    for (const actor of [actors.lead, actors.finance, actors.superAdmin]) {
      expect(await getReportVerification(pool, actor, reportId), actor.role).toEqual({
        code: formatCode(code),
        path: `/verify/${formatCode(code)}?s=${seal}`,
        seal,
      });
    }
  });

  it('gives a path without a seal when the report has no approval event', async () => {
    const reportId = await approvedBySql();
    const code = await codeOf(reportId);
    expect(await getReportVerification(pool, actors.lead, reportId)).toEqual({
      code: formatCode(code),
      path: `/verify/${formatCode(code)}`,
      seal: null,
    });
  });

  it('answers another branch, a draft, an unknown and a malformed id with the same NotFound', async () => {
    const { reportId } = await anchoredReport();
    const draft = await seedReport(pool, { branchId: branchA, weekStart: addDays(WEEK, -7) });
    const bodies = [
      await notFoundBody(getReportVerification(pool, actors.leadB, reportId)),
      await notFoundBody(getReportVerification(pool, actors.lead, draft.reportId)),
      await notFoundBody(
        getReportVerification(pool, actors.lead, '00000000-0000-4000-8000-000000000000'),
      ),
      await notFoundBody(getReportVerification(pool, actors.lead, 'not-a-uuid')),
      await notFoundBody(getReportVerification(pool, actors.superAdmin, draft.reportId)),
    ];
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(JSON.stringify(bodies[0])).not.toContain(reportId);
  });

  it('refuses roles without report.read', async () => {
    const { reportId } = await anchoredReport();
    for (const actor of [actors.hr, actors.editor]) {
      await expect(getReportVerification(pool, actor, reportId)).rejects.toBeInstanceOf(Forbidden);
    }
  });
});
