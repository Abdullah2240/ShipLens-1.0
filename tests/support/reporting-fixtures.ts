import type { Pool } from 'pg';
import type { Actor } from '@/platform/authz';
import type { Role } from '@/platform/authz/roles';
import { seedBranch, seedUser, type BranchRow, type UserRow } from './db';
import { seedReport } from './finance-fixtures';

// A small hand-built reporting scenario. SCENARIO_EXPECTED is written by hand from the
// amounts below (never computed by app code), so the reporting module is checked against
// an independent oracle.
//
// Branch A (active)
//   approved  week 2026-08-31: 1000.00 on 08-31, 250.50 on 09-01 (routed), voided 999.99 on 09-02
//   submitted week 2026-09-07: 300.00 on 09-08
//   returned  week 2026-09-14: 40.25 on 09-14, voided 5.00 on 09-15
//   draft     week 2026-10-05: 10.00 on 10-06
// Branch B (active)
//   approved  week 2026-08-24: 500.00 on 08-25 (approved after A's approved report)
//   approved  week 2026-09-07: nil report, no collections
// Branch C (paused) and branch D (forming): no reports.
//
// The 08-31 and 09-01 collections share the week of Monday 2026-08-31 but fall in
// different PKT months; that report's week_start (August) differs from the month of its
// routed collection (September).

export const SCENARIO_ROUTED_AT = '2026-09-10T06:00:00.000Z';

type MoneyRow = { value: string; recordCount: number };
type MoneyExpectation = {
  collected: MoneyRow;
  approved: MoneyRow;
  pending_approval: MoneyRow;
  in_progress: MoneyRow;
  not_yet_routed: MoneyRow;
  routed: MoneyRow;
};
export type ScenarioFigures = {
  money: MoneyExpectation;
  counts: { active_branches: number; reports_awaiting_review: number };
};

const ZERO = { value: '0.00', recordCount: 0 };

export const SCENARIO_EXPECTED = {
  allTime: {
    money: {
      collected: { value: '2100.75', recordCount: 6 },
      approved: { value: '1750.50', recordCount: 3 },
      pending_approval: { value: '300.00', recordCount: 1 },
      in_progress: { value: '50.25', recordCount: 2 },
      not_yet_routed: { value: '1500.00', recordCount: 2 },
      routed: { value: '250.50', recordCount: 1 },
    },
    counts: { active_branches: 2, reports_awaiting_review: 1 },
  },
  august: {
    money: {
      collected: { value: '1500.00', recordCount: 2 },
      approved: { value: '1500.00', recordCount: 2 },
      pending_approval: ZERO,
      in_progress: ZERO,
      not_yet_routed: { value: '1500.00', recordCount: 2 },
      routed: ZERO,
    },
    counts: { active_branches: 2, reports_awaiting_review: 0 },
  },
  september: {
    money: {
      collected: { value: '590.75', recordCount: 3 },
      approved: { value: '250.50', recordCount: 1 },
      pending_approval: { value: '300.00', recordCount: 1 },
      in_progress: { value: '40.25', recordCount: 1 },
      not_yet_routed: ZERO,
      routed: { value: '250.50', recordCount: 1 },
    },
    counts: { active_branches: 2, reports_awaiting_review: 1 },
  },
  branchA: {
    money: {
      collected: { value: '1600.75', recordCount: 5 },
      approved: { value: '1250.50', recordCount: 2 },
      pending_approval: { value: '300.00', recordCount: 1 },
      in_progress: { value: '50.25', recordCount: 2 },
      not_yet_routed: { value: '1000.00', recordCount: 1 },
      routed: { value: '250.50', recordCount: 1 },
    },
    counts: { active_branches: 1, reports_awaiting_review: 1 },
  },
  branchB: {
    money: {
      collected: { value: '500.00', recordCount: 1 },
      approved: { value: '500.00', recordCount: 1 },
      pending_approval: ZERO,
      in_progress: ZERO,
      not_yet_routed: { value: '500.00', recordCount: 1 },
      routed: ZERO,
    },
    counts: { active_branches: 1, reports_awaiting_review: 0 },
  },
  branchC: {
    money: {
      collected: ZERO,
      approved: ZERO,
      pending_approval: ZERO,
      in_progress: ZERO,
      not_yet_routed: ZERO,
      routed: ZERO,
    },
    counts: { active_branches: 0, reports_awaiting_review: 0 },
  },
  // Months with data only; the service gap-fills around them.
  trend: [
    {
      month: '2026-08',
      collected: '1500.00',
      approved: '1500.00',
      pendingApproval: '0.00',
      inProgress: '0.00',
      notYetRouted: '1500.00',
      routed: '0.00',
    },
    {
      month: '2026-09',
      collected: '590.75',
      approved: '250.50',
      pendingApproval: '300.00',
      inProgress: '40.25',
      notYetRouted: '0.00',
      routed: '250.50',
    },
    {
      month: '2026-10',
      collected: '10.00',
      approved: '0.00',
      pendingApproval: '0.00',
      inProgress: '10.00',
      notYetRouted: '0.00',
      routed: '0.00',
    },
  ],
  // Not-yet-routed amounts, oldest approval first: A's report was approved before B's.
  unroutedAmounts: ['1000.00', '500.00'],
  unroutedTotal: '1500.00',
} as const satisfies Record<string, unknown> & {
  allTime: ScenarioFigures;
  august: ScenarioFigures;
  september: ScenarioFigures;
  branchA: ScenarioFigures;
  branchB: ScenarioFigures;
  branchC: ScenarioFigures;
};

export interface ReportingScenario {
  branches: { a: BranchRow; b: BranchRow; c: BranchRow; d: BranchRow };
  users: {
    superAdmin: UserRow;
    finance: UserRow;
    leadA: UserRow;
    leadB: UserRow;
    hrA: UserRow;
    editor: UserRow;
  };
  actors: Record<'superAdmin' | 'finance' | 'leadA' | 'hrA' | 'editor', Actor>;
  reports: {
    aApproved: string;
    aSubmitted: string;
    aReturned: string;
    aDraft: string;
    bApproved: string;
    bNil: string;
  };
  collections: {
    a1000: string;
    a250: string;
    aVoid999: string;
    a300: string;
    a40: string;
    aVoid5: string;
    a10: string;
    b500: string;
  };
}

export function actorOf(user: UserRow): Actor {
  return { userId: user.id, role: user.role as Role, branchId: user.branch_id, name: user.name };
}

/** Seeds the scenario into an empty database (call resetDb first). */
export async function buildReportingScenario(pool: Pool): Promise<ReportingScenario> {
  const a = await seedBranch(pool, {
    code: 'BR-A',
    name: 'Alpha',
    city: 'Lahore',
    status: 'active',
  });
  const b = await seedBranch(pool, {
    code: 'BR-B',
    name: 'Bravo',
    city: 'Karachi',
    status: 'active',
  });
  const c = await seedBranch(pool, { code: 'BR-C', name: 'Charlie', status: 'paused' });
  const d = await seedBranch(pool, { code: 'BR-D', name: 'Delta', status: 'forming' });

  const superAdmin = await seedUser(pool, { role: 'super_admin', name: 'Sana Admin' });
  const finance = await seedUser(pool, { role: 'finance_reviewer', name: 'Faraz Finance' });
  const leadA = await seedUser(pool, { role: 'branch_lead', branchId: a.id, name: 'Lead Alpha' });
  const leadB = await seedUser(pool, { role: 'branch_lead', branchId: b.id, name: 'Lead Bravo' });
  const hrA = await seedUser(pool, { role: 'hr_lead', branchId: a.id, name: 'HR Alpha' });
  const editor = await seedUser(pool, { role: 'content_editor', name: 'Content Editor' });

  const aApproved = await seedReport(pool, {
    branchId: a.id,
    weekStart: '2026-08-31',
    status: 'approved',
    submittedBy: leadA.id,
    reviewedBy: finance.id,
    collections: [
      {
        amount: '1000.00',
        collectedOn: '2026-08-31',
        purpose: 'Food parcels',
        createdBy: leadA.id,
      },
      {
        amount: '250.50',
        collectedOn: '2026-09-01',
        purpose: 'School fees',
        createdBy: leadA.id,
        routedAt: SCENARIO_ROUTED_AT,
      },
      {
        amount: '999.99',
        collectedOn: '2026-09-02',
        purpose: 'Entered twice',
        status: 'voided',
        createdBy: leadA.id,
      },
    ],
  });
  const aSubmitted = await seedReport(pool, {
    branchId: a.id,
    weekStart: '2026-09-07',
    status: 'submitted',
    submittedBy: leadA.id,
    collections: [
      { amount: '300.00', collectedOn: '2026-09-08', purpose: 'Medicine', createdBy: leadA.id },
    ],
  });
  const aReturned = await seedReport(pool, {
    branchId: a.id,
    weekStart: '2026-09-14',
    status: 'returned',
    submittedBy: leadA.id,
    reviewedBy: finance.id,
    collections: [
      { amount: '40.25', collectedOn: '2026-09-14', purpose: 'Water', createdBy: leadA.id },
      { amount: '5.00', collectedOn: '2026-09-15', status: 'voided', createdBy: leadA.id },
    ],
  });
  const aDraft = await seedReport(pool, {
    branchId: a.id,
    weekStart: '2026-10-05',
    collections: [
      { amount: '10.00', collectedOn: '2026-10-06', purpose: 'Blankets', createdBy: leadA.id },
    ],
  });
  const bApproved = await seedReport(pool, {
    branchId: b.id,
    weekStart: '2026-08-24',
    status: 'approved',
    submittedBy: leadB.id,
    reviewedBy: finance.id,
    collections: [
      { amount: '500.00', collectedOn: '2026-08-25', purpose: 'Rations', createdBy: leadB.id },
    ],
  });
  const bNil = await seedReport(pool, {
    branchId: b.id,
    weekStart: '2026-09-07',
    status: 'approved',
    submittedBy: leadB.id,
    reviewedBy: finance.id,
  });

  return {
    branches: { a, b, c, d },
    users: { superAdmin, finance, leadA, leadB, hrA, editor },
    actors: {
      superAdmin: actorOf(superAdmin),
      finance: actorOf(finance),
      leadA: actorOf(leadA),
      hrA: actorOf(hrA),
      editor: actorOf(editor),
    },
    reports: {
      aApproved: aApproved.reportId,
      aSubmitted: aSubmitted.reportId,
      aReturned: aReturned.reportId,
      aDraft: aDraft.reportId,
      bApproved: bApproved.reportId,
      bNil: bNil.reportId,
    },
    collections: {
      a1000: aApproved.collectionIds[0]!,
      a250: aApproved.collectionIds[1]!,
      aVoid999: aApproved.collectionIds[2]!,
      a300: aSubmitted.collectionIds[0]!,
      a40: aReturned.collectionIds[0]!,
      aVoid5: aReturned.collectionIds[1]!,
      a10: aDraft.collectionIds[0]!,
      b500: bApproved.collectionIds[0]!,
    },
  };
}
