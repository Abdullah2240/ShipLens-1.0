import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KPI_NAMES } from '@/platform/config/constants';
import {
  COUNT_FIGURES,
  FIGURES,
  MONEY_FIGURES,
  REPORTING_LIMITS,
  figureFromSlug,
  traceHref,
} from './figures';
import type { FigureId } from './types';

const BRANCH = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';
const COLLECTION = '33333333-3333-4333-8333-333333333333';

describe('FIGURES', () => {
  it('covers every KPI name plus routed, and nothing else', () => {
    const ids = Object.keys(FIGURES).sort();
    expect(ids).toEqual([...KPI_NAMES, 'routed'].sort());
    expect([...MONEY_FIGURES, ...COUNT_FIGURES].sort()).toEqual(ids);
  });

  it('splits figures into money and count measures', () => {
    expect(MONEY_FIGURES).toEqual([
      'collected',
      'approved',
      'pending_approval',
      'in_progress',
      'not_yet_routed',
      'routed',
    ]);
    expect(COUNT_FIGURES).toEqual(['active_branches', 'reports_awaiting_review']);
    for (const id of MONEY_FIGURES) expect(FIGURES[id].measure).toBe('amount');
    for (const id of COUNT_FIGURES) expect(FIGURES[id].measure).toBe('count');
  });

  it('has unique kebab-case slugs that round-trip through figureFromSlug', () => {
    const slugs = Object.values(FIGURES).map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const [id, def] of Object.entries(FIGURES)) {
      expect(def.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(figureFromSlug(def.slug)).toBe(id);
    }
    expect(FIGURES.pending_approval.slug).toBe('pending-approval');
    expect(FIGURES.not_yet_routed.slug).toBe('not-yet-routed');
    expect(FIGURES.reports_awaiting_review.slug).toBe('reports-awaiting-review');
  });

  it('returns null for unknown, empty, snake_case and prototype slugs', () => {
    for (const slug of [
      '',
      'unknown',
      'pending_approval',
      'not_yet_routed',
      'APPROVED',
      ' approved',
      'constructor',
      '__proto__',
      'toString',
    ]) {
      expect(figureFromSlug(slug)).toBeNull();
    }
  });

  it('maps money figures to view predicate columns and count figures to none', () => {
    expect(FIGURES.collected.predicate).toBe('TRUE');
    expect(FIGURES.approved.predicate).toBe('is_approved');
    expect(FIGURES.pending_approval.predicate).toBe('is_pending_approval');
    expect(FIGURES.in_progress.predicate).toBe('is_in_progress');
    expect(FIGURES.not_yet_routed.predicate).toBe('is_not_yet_routed');
    expect(FIGURES.routed.predicate).toBe('is_routed');
    expect(FIGURES.active_branches.predicate).toBeNull();
    expect(FIGURES.reports_awaiting_review.predicate).toBeNull();
  });

  it('names the collection-level money figure for every figure', () => {
    for (const id of MONEY_FIGURES) expect(FIGURES[id].collectionPredicate).toBe(id);
    expect(FIGURES.reports_awaiting_review.collectionPredicate).toBe('pending_approval');
    expect(FIGURES.active_branches.collectionPredicate).toBeNull();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(FIGURES)).toBe(true);
    expect(Object.isFrozen(FIGURES.approved)).toBe(true);
    expect(Object.isFrozen(MONEY_FIGURES)).toBe(true);
    expect(Object.isFrozen(REPORTING_LIMITS)).toBe(true);
  });

  it('exposes the reporting limits', () => {
    expect(REPORTING_LIMITS).toEqual({
      traceMaxRows: 500,
      unroutedPageSize: 50,
      maxPageSize: 200,
      impactCacheSeconds: 60,
    });
  });
});

describe('traceHref', () => {
  it('builds the overview level without filters', () => {
    expect(traceHref('approved', {}, {})).toBe('/dashboard/kpi/approved');
    expect(traceHref('pending_approval', {}, {})).toBe('/dashboard/kpi/pending-approval');
  });

  it('nests branch, report and collection in that order', () => {
    expect(traceHref('approved', { branchId: BRANCH }, {})).toBe(
      `/dashboard/kpi/approved/branches/${BRANCH}`,
    );
    expect(traceHref('approved', { branchId: BRANCH, reportId: REPORT }, {})).toBe(
      `/dashboard/kpi/approved/branches/${BRANCH}/reports/${REPORT}`,
    );
    expect(
      traceHref(
        'not_yet_routed',
        { branchId: BRANCH, reportId: REPORT, collectionId: COLLECTION },
        {},
      ),
    ).toBe(
      `/dashboard/kpi/not-yet-routed/branches/${BRANCH}/reports/${REPORT}/collections/${COLLECTION}`,
    );
  });

  it('appends filters in canonical order', () => {
    expect(traceHref('collected', {}, { branch: BRANCH, to: '2026-09', from: '2026-08' })).toBe(
      `/dashboard/kpi/collected?from=2026-08&to=2026-09&branch=${BRANCH}`,
    );
    expect(traceHref('collected', {}, { to: '2026-09' })).toBe(
      '/dashboard/kpi/collected?to=2026-09',
    );
  });

  it('drops the branch filter once a branch is in the path', () => {
    expect(traceHref('approved', { branchId: BRANCH }, { from: '2026-08', branch: BRANCH })).toBe(
      `/dashboard/kpi/approved/branches/${BRANCH}?from=2026-08`,
    );
    expect(traceHref('approved', { branchId: BRANCH }, { branch: BRANCH })).toBe(
      `/dashboard/kpi/approved/branches/${BRANCH}`,
    );
  });

  it('throws on a report without a branch or a collection without a report', () => {
    expect(() => traceHref('approved', { reportId: REPORT }, {})).toThrow();
    expect(() =>
      traceHref('approved', { branchId: BRANCH, collectionId: COLLECTION }, {}),
    ).toThrow();
  });

  it('throws on an unknown figure', () => {
    expect(() => traceHref('bogus' as FigureId, {}, {})).toThrow();
  });
});

describe('money discipline in the reporting module', () => {
  it('uses no float parsing or float formatting anywhere in the module source', () => {
    const dir = path.resolve(import.meta.dirname);
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.int.test.ts'),
    );
    expect(files).toEqual(expect.arrayContaining(['figures.ts', 'filters.ts', 'types.ts']));
    for (const file of files) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/parseFloat|\bNumber\(|toFixed|Math\.round/);
    }
  });
});
