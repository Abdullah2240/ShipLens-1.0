import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DATA_AS_OF, DEMO_SEED, DEMO_WEEKS, generateDemoData } from './generate.mjs';
import { validateDemoData } from './validate.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = path.join(root, 'scripts', 'demo-data', 'generate.mjs');
const dataDir = path.join(root, 'db', 'seed', 'data');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'demo-data-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base = generateDemoData();

function clone() {
  return structuredClone(base);
}

function problemsAfter(mutate) {
  const data = clone();
  mutate(data);
  return validateDemoData(data);
}

function collectionsOf(data, reportId) {
  return data.collections.filter((c) => c.reportId === reportId);
}

function findReport(data, predicate) {
  const report = data.reports.find((r) => predicate(r, collectionsOf(data, r.id)));
  if (!report) throw new Error('fixture report not found');
  return report;
}

// An approved report submitted once and approved once, with at least two collections.
function plainApproved(data) {
  return findReport(
    data,
    (r, cs) => r.status === 'approved' && r.history.length === 2 && cs.length >= 2,
  );
}

function draftWithCollections(data) {
  return findReport(data, (r, cs) => r.status === 'draft' && cs.length >= 2);
}

function addDays(date, days) {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function plusMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}

function run(...args) {
  try {
    execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

describe('constants', () => {
  it('exports the fixed seed, as-of date and 12 PKT Monday weeks', () => {
    expect(DEMO_SEED).toBe(20261031);
    expect(DATA_AS_OF).toBe('2026-10-31');
    expect(DEMO_WEEKS).toHaveLength(12);
    expect(DEMO_WEEKS[0]).toBe('2026-08-10');
    expect(DEMO_WEEKS[11]).toBe('2026-10-26');
    for (const week of DEMO_WEEKS) {
      expect(new Date(`${week}T00:00:00.000Z`).getUTCDay()).toBe(1);
    }
  });
});

describe('generateDemoData', () => {
  it('is deterministic', () => {
    const again = generateDemoData();
    expect(again).toEqual(base);
    for (const key of Object.keys(base)) {
      expect(JSON.stringify(again[key])).toBe(JSON.stringify(base[key]));
    }
  });

  it('differs for a different seed', () => {
    expect(JSON.stringify(generateDemoData(1).collections)).not.toBe(
      JSON.stringify(base.collections),
    );
  });

  it('passes its own validator', () => {
    expect(validateDemoData(base)).toEqual([]);
  });

  it('writes a manifest listing the data files', () => {
    expect(base.manifest).toEqual({
      version: 1,
      seed: DEMO_SEED,
      asOf: DATA_AS_OF,
      weeks: DEMO_WEEKS,
      files: [
        'branches.json',
        'users.json',
        'teams.json',
        'members.json',
        'applications.json',
        'reports.json',
        'collections.json',
      ],
    });
  });

  it('keeps the committed data files in sync (--check)', () => {
    expect(run('--check')).toBe(0);
  });

  it('fails --check when a data file was edited by hand', () => {
    const copy = path.join(tmp, 'edited');
    cpSync(dataDir, copy, { recursive: true });
    expect(run('--check', '--out-dir', copy)).toBe(0);
    const file = path.join(copy, 'collections.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"amount": "', '"amount": "1'));
    expect(run('--check', '--out-dir', copy)).toBe(1);
  });

  it('fails --check when a data file is missing', () => {
    expect(run('--check', '--out-dir', path.join(tmp, 'missing'))).toBe(1);
  });

  it('writes the files to --out-dir in default mode', () => {
    const out = path.join(tmp, 'written');
    expect(run('--out-dir', out)).toBe(0);
    expect(readFileSync(path.join(out, 'reports.json'), 'utf8')).toBe(
      `${JSON.stringify(base.reports, null, 2)}\n`,
    );
  });
});

describe('validateDemoData catches each broken rule', () => {
  const cases = [
    [
      'report week not a Monday',
      (d) => {
        d.reports[0].weekStart = addDays(d.reports[0].weekStart, 1);
      },
      /not a Monday in DEMO_WEEKS/,
    ],
    [
      'report week outside DEMO_WEEKS',
      (d) => {
        d.reports[0].weekStart = '2026-08-03';
      },
      /not a Monday in DEMO_WEEKS/,
    ],
    [
      'two reports for one branch and week',
      (d) => {
        d.reports.push({
          ...structuredClone(d.reports[0]),
          id: '00000000-0000-4000-8000-000000000001',
        });
      },
      /more than one report/,
    ],
    [
      'collection of an unknown report',
      (d) => {
        d.collections[0].reportId = '00000000-0000-4000-8000-000000000002';
      },
      /unknown report/,
    ],
    [
      'collection branch differs from its report branch',
      (d) => {
        const c = d.collections.find((x) => x.branchKey === 'sample');
        c.branchKey = 'lahore';
      },
      /branch differs from its report/,
    ],
    [
      'collection dated outside its report week',
      (d) => {
        const r = plainApproved(d);
        collectionsOf(d, r.id)[0].collectedOn = addDays(r.weekStart, 7);
      },
      /outside its report week/,
    ],
    [
      'collection dated after DATA_AS_OF',
      (d) => {
        const r = draftWithCollections(d);
        collectionsOf(d, r.id)[0].collectedOn = addDays(DATA_AS_OF, 1);
      },
      /after DATA_AS_OF/,
    ],
    [
      'amount not a 2-decimal string',
      (d) => {
        d.collections[0].amount = '125.5';
      },
      /amount/,
    ],
    [
      'amount of zero',
      (d) => {
        d.collections[0].amount = '0.00';
      },
      /greater than zero/,
    ],
    [
      'voided collection without a reason',
      (d) => {
        d.collections.find((c) => c.status === 'voided').voidReason = null;
      },
      /voided without voidReason/,
    ],
    [
      'active collection with void fields',
      (d) => {
        const c = d.collections.find((x) => x.status === 'active');
        c.voidReason = 'x';
        c.voidedAt = c.createdAt;
      },
      /active but has void fields/,
    ],
    [
      'void while the report was not open',
      (d) => {
        const r = plainApproved(d);
        const c = collectionsOf(d, r.id).find((x) => x.status === 'active');
        c.status = 'voided';
        c.voidReason = 'late void';
        c.voidedAt = plusMinutes(r.history[1].at, 60);
        c.routedAt = null;
        c.routedByKey = null;
      },
      /voided while its report was not open/,
    ],
    [
      'routed collection in a report that is not approved',
      (d) => {
        const r = draftWithCollections(d);
        const c = collectionsOf(d, r.id).find((x) => x.status === 'active');
        c.routedAt = plusMinutes(c.createdAt, 60);
        c.routedByKey = 'finance';
      },
      /routed but/,
    ],
    [
      'routed voided collection',
      (d) => {
        const c = d.collections.find((x) => x.routedAt !== null);
        c.status = 'voided';
        c.voidReason = 'x';
        c.voidedAt = c.createdAt;
      },
      /routed but/,
    ],
    [
      'routed by a non finance user',
      (d) => {
        d.collections.find((x) => x.routedAt !== null).routedByKey = 'lead';
      },
      /routedByKey/,
    ],
    [
      'history with a disallowed transition',
      (d) => {
        plainApproved(d).history.shift();
      },
      /invalid transition/,
    ],
    [
      'history that does not end at the final status',
      (d) => {
        plainApproved(d).status = 'submitted';
      },
      /history ends at/,
    ],
    [
      'history timestamps not increasing',
      (d) => {
        const r = plainApproved(d);
        r.history[1].at = r.history[0].at;
      },
      /not strictly after/,
    ],
    [
      'collection created after the first submission',
      (d) => {
        const r = plainApproved(d);
        collectionsOf(d, r.id)[0].createdAt = plusMinutes(r.history[0].at, 1);
      },
      /before collection .* was created/,
    ],
    [
      'nil report without confirmNil',
      (d) => {
        findReport(d, (r, cs) => r.status === 'approved' && cs.length === 0).confirmNil = false;
      },
      /confirmNil/,
    ],
    [
      'forming branch with reports',
      (d) => {
        d.branches.find((b) => b.key === 'lahore').status = 'forming';
      },
      /forming branch/,
    ],
    [
      'closed branch with open reports',
      (d) => {
        d.branches.find((b) => b.key === 'islamabad').status = 'closed';
      },
      /closed branch/,
    ],
    [
      'paused branch with draft or returned reports',
      (d) => {
        d.branches.find((b) => b.key === 'sample').status = 'paused';
      },
      /paused branch/,
    ],
    [
      'collection created by someone who is not a lead of the branch',
      (d) => {
        d.collections.find((c) => c.branchKey === 'sample').createdByKey = 'lead.lahore';
      },
      /createdByKey/,
    ],
    [
      'submission by a finance reviewer',
      (d) => {
        plainApproved(d).history[0].actorKey = 'finance';
      },
      /actor/,
    ],
    [
      'approval by a branch lead',
      (d) => {
        const r = plainApproved(d);
        r.history[1].actorKey = r.history[0].actorKey;
      },
      /actor/,
    ],
    [
      'member linked to a pending application',
      (d) => {
        const app = d.applications.find((a) => a.status === 'pending');
        const member = d.members.find(
          (m) => m.applicationId === null && m.branchKey === app.branchKey,
        );
        member.applicationId = app.id;
      },
      /accepted application/,
    ],
    [
      'accepted application without a member',
      (d) => {
        const member = d.members.find((m) => m.applicationId !== null);
        member.applicationId = null;
      },
      /exactly one member/,
    ],
    [
      'member team from another branch',
      (d) => {
        const member = d.members.find((m) => m.teamId !== null);
        member.teamId = d.teams.find((t) => t.branchKey !== member.branchKey).id;
      },
      /team .* another branch/,
    ],
    [
      'branch name without (Demo)',
      (d) => {
        d.branches[0].name = 'Real Branch';
      },
      /\(Demo\)/,
    ],
    [
      'user email outside shiplens.test',
      (d) => {
        d.users[0].email = 'someone@example.com';
      },
      /@shiplens\.test/,
    ],
    [
      'member email outside shiplens.test',
      (d) => {
        d.members.find((m) => m.email !== null).email = 'someone@example.com';
      },
      /@shiplens\.test/,
    ],
    [
      'application email outside shiplens.test',
      (d) => {
        d.applications[0].email = 'someone@example.com';
      },
      /@shiplens\.test/,
    ],
    [
      'a demo user no longer marked existing',
      (d) => {
        d.users.find((u) => u.key === 'hr').existing = false;
      },
      /existing/,
    ],
    [
      'a generated user marked existing',
      (d) => {
        d.users.find((u) => u.key === 'lead.lahore').existing = true;
      },
      /existing/,
    ],
  ];

  it.each(cases)('%s', (_name, mutate, pattern) => {
    const problems = problemsAfter(mutate);
    expect(
      problems.some((p) => pattern.test(p)),
      `expected ${pattern} in:\n${problems.join('\n')}`,
    ).toBe(true);
  });
});

describe('state coverage', () => {
  const reportById = new Map(base.reports.map((r) => [r.id, r]));
  const byStatus = (status) => base.reports.filter((r) => r.status === status);

  it('has branches in every status', () => {
    const count = (status) => base.branches.filter((b) => b.status === status).length;
    expect(count('active')).toBe(3);
    expect(count('forming')).toBe(1);
    expect(count('paused')).toBe(1);
    expect(count('closed')).toBe(1);
    for (const b of base.branches) expect(b.name.endsWith('(Demo)')).toBe(true);
    expect(base.branches.find((b) => b.key === 'sample')).toMatchObject({
      name: 'Sample Branch (Demo)',
      city: 'Karachi',
      status: 'active',
      adopt: true,
    });
  });

  it('has reports in every status, a nil approval and a returned-then-approved history', () => {
    expect(byStatus('submitted').length).toBeGreaterThanOrEqual(3);
    expect(byStatus('returned').length).toBeGreaterThanOrEqual(2);
    const nil = byStatus('approved').filter(
      (r) => r.confirmNil && collectionsOf(base, r.id).length === 0,
    );
    expect(nil.length).toBeGreaterThanOrEqual(1);
    const reworked = byStatus('approved').filter((r) => {
      const events = r.history.map((h) => h.event).join(',');
      return events.includes('returned,resubmitted');
    });
    expect(reworked.length).toBeGreaterThanOrEqual(1);
  });

  it('gives every active branch a draft for the final week with live collections', () => {
    const active = base.branches.filter((b) => b.status === 'active');
    for (const branch of active) {
      const report = base.reports.find(
        (r) => r.branchKey === branch.key && r.weekStart === '2026-10-26',
      );
      expect(report?.status).toBe('draft');
      const live = collectionsOf(base, report.id).filter(
        (c) =>
          c.status === 'active' && c.collectedOn >= '2026-10-26' && c.collectedOn <= '2026-10-31',
      );
      expect(live.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('has voided collections in draft, submitted, returned and approved reports', () => {
    const statuses = new Set(
      base.collections
        .filter((c) => c.status === 'voided')
        .map((c) => reportById.get(c.reportId).status),
    );
    expect([...statuses].sort()).toEqual(['approved', 'draft', 'returned', 'submitted']);
  });

  it('has routed and unrouted approved collections in at least two branches', () => {
    const branchesWithBoth = base.branches.filter((b) => {
      const approved = base.collections.filter(
        (c) =>
          c.branchKey === b.key &&
          c.status === 'active' &&
          reportById.get(c.reportId).status === 'approved',
      );
      return approved.some((c) => c.routedAt) && approved.some((c) => !c.routedAt);
    });
    expect(branchesWithBoth.length).toBeGreaterThanOrEqual(2);
  });

  it('gives the sample branch reports in every status', () => {
    const statuses = new Set(
      base.reports.filter((r) => r.branchKey === 'sample').map((r) => r.status),
    );
    expect([...statuses].sort()).toEqual(['approved', 'draft', 'returned', 'submitted']);
  });

  it('has about 16 applications, about 40 members and 2-3 teams per active branch', () => {
    expect(base.applications.length).toBeGreaterThanOrEqual(14);
    expect(base.applications.length).toBeLessThanOrEqual(18);
    expect(base.members.length).toBeGreaterThanOrEqual(36);
    expect(base.members.length).toBeLessThanOrEqual(44);
    for (const status of ['pending', 'accepted', 'declined']) {
      expect(base.applications.some((a) => a.status === status)).toBe(true);
    }
    for (const status of ['active', 'inactive', 'left']) {
      expect(base.members.some((m) => m.status === status)).toBe(true);
    }
    for (const b of base.branches.filter((x) => x.status === 'active')) {
      const teams = base.teams.filter((t) => t.branchKey === b.key).length;
      expect(teams).toBeGreaterThanOrEqual(2);
      expect(teams).toBeLessThanOrEqual(3);
    }
  });

  it('uses only fictional contact details', () => {
    const emails = [
      ...base.users.map((u) => u.email),
      ...base.members.map((m) => m.email).filter(Boolean),
      ...base.applications.map((a) => a.email),
    ];
    for (const email of emails) expect(email).toMatch(/^[a-z0-9.]+@shiplens\.test$/);
    const phones = [...base.members, ...base.applications].map((p) => p.phone).filter(Boolean);
    for (const phone of phones) expect(phone).toMatch(/^0300000\d{4}$/);
  });
});

describe('money never touches floats', () => {
  const source = readFileSync(script, 'utf8');

  it('uses no float parsing or formatting in the generator', () => {
    expect(source).not.toMatch(/parseFloat/);
    expect(source).not.toMatch(/toFixed/);
    expect(source).not.toMatch(/Number\(/);
  });

  it('renders every amount as a canonical 2-decimal string', () => {
    for (const c of base.collections) {
      expect(c.amount).toMatch(/^[1-9]\d*\.\d{2}$|^0\.(?!00)\d{2}$/);
    }
  });
});
