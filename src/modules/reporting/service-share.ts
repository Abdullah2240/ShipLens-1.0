// WhatsApp share (WA-01, WA-02). A Branch Lead shares a minimal summary of one of their
// branch's weekly reports; the summary read and its report.share audit row commit in one
// transaction. The link points at an ordinary scoped page that requires a sign-in.
import { z } from 'zod';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound, Unauthenticated } from '@/platform/errors';
import { addDays } from '@/platform/time';
import { selectScopedReportId, selectShareSummary } from './repo-share';
import type { ReportShareSummary } from './share-text';

export type { ReportShareSummary } from './share-text';

export type ShareLocale = 'en' | 'ur';

/** Body of POST /api/v1/reports/:id/share. */
export const shareInputSchema = z.strictObject({
  locale: z.enum(['en', 'ur'], { error: 'invalid_locale' }).optional(),
});
export type ShareInput = z.output<typeof shareInputSchema>;

export interface ShareResult {
  summary: ReportShareSummary;
  link: string;
}

/** The sign-in protected landing page for a shared report. */
export function shareLink(appOrigin: string, locale: ShareLocale, reportId: string): string {
  return `${appOrigin.replace(/\/+$/, '')}/${locale}/share/reports/${reportId}`;
}

/**
 * Reads the share summary of a report in the actor's scope and records one report.share
 * audit event (entity share, after { channel: 'whatsapp' }) in the same transaction.
 * Missing and out-of-scope reports raise the same NotFound and write nothing.
 */
export async function shareReport(
  ctx: CommandContext,
  reportId: string,
  opts: { appOrigin: string; locale: ShareLocale },
): Promise<ShareResult> {
  if (!ctx.actor) throw new Unauthenticated();
  const scope = authorize(ctx.actor, 'report.share');

  const summary = await command(ctx, 'report.share', async (tx, audit) => {
    const row = await selectShareSummary(tx, scope, reportId);
    if (!row) throw new NotFound();
    audit({
      action: 'report.share',
      entityType: 'share',
      entityId: row.reportId,
      branchId: row.branchId,
      reportId: row.reportId,
      after: { channel: 'whatsapp' },
    });
    const result: ReportShareSummary = {
      reportId: row.reportId,
      branchName: row.branchName,
      branchCode: row.branchCode,
      weekStart: row.weekStart,
      weekEnd: addDays(row.weekStart, 6),
      status: row.status,
      amount: row.amount,
      collectionCount: row.collectionCount,
      amountIsFrozen: row.amountIsFrozen,
    };
    return result;
  });

  return { summary, link: shareLink(opts.appOrigin, opts.locale, summary.reportId) };
}

/**
 * The share landing check: the actor must hold report.read and the report must exist in
 * their scope. Out of scope and missing give the same NotFound. Reads only; not audited.
 */
export async function resolveSharedReport(
  db: Queryable,
  actor: Actor,
  reportId: string,
): Promise<{ reportId: string }> {
  const scope = authorize(actor, 'report.read');
  const id = await selectScopedReportId(db, scope, reportId);
  if (!id) throw new NotFound();
  return { reportId: id };
}
