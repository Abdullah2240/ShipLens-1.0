import { getReportVerification } from '@/modules/verification';
import type { Actor } from '@/platform/authz';
import { getEnv } from '@/platform/config/env';
import { getPool } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { VerificationPanel } from './VerificationPanel';

export type ReportVerificationSectionProps = {
  reportId: string;
  actor: Actor;
  locale: string;
};

/**
 * The public verification card of an approved report, for the report page. Renders nothing
 * when the report has no public code (not approved, or out of the actor's scope); any other
 * failure is left to the page's error boundary.
 */
export async function ReportVerificationSection({
  reportId,
  actor,
  locale,
}: ReportVerificationSectionProps) {
  let link;
  try {
    link = await getReportVerification(getPool(), actor, reportId);
  } catch (err) {
    if (err instanceof NotFound) return null;
    throw err;
  }
  const url = `${getEnv().APP_ORIGIN.replace(/\/+$/, '')}${link.path}`;
  return (
    <VerificationPanel
      code={link.code}
      url={url}
      seal={link.seal}
      locale={locale === 'ur' ? 'ur' : 'en'}
    />
  );
}
