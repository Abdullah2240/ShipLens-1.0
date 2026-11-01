import { getChainStatus } from '@/platform/audit/chain/verify';
import { getPool } from '@/platform/db';
import { ChainStatusBadge } from './ChainStatusBadge';

export type AuditChainSectionProps = {
  locale: string;
  /** Skip the cached result and verify the whole chain now. */
  fresh?: boolean;
  /** Current audit viewer path without the locale (filters kept); defaults to '/audit'. */
  path?: string;
};

/** Re-check link: the current audit path with chain=fresh added. */
export function recheckHref(locale: string, path = '/audit'): string {
  const separator = path.includes('?') ? '&' : '?';
  return `/${locale}${path}${separator}chain=fresh`;
}

/** Audit viewer header: whether the tamper-evident audit chain is intact, with a re-check. */
export async function AuditChainSection({ locale, fresh = false, path }: AuditChainSectionProps) {
  const status = await getChainStatus(getPool(), fresh ? { fresh: true } : {});
  return (
    <div data-audit-chain className="w-full sm:w-auto sm:max-w-md">
      <ChainStatusBadge
        status={status.status}
        checkedEvents={status.checkedEvents}
        checkedAt={status.checkedAt}
        brokenAtSeq={status.status === 'broken' ? status.brokenAt.chainSeq : null}
        reason={status.status === 'broken' ? status.brokenAt.reason : undefined}
        recheckHref={recheckHref(locale, path)}
        locale={locale === 'ur' ? 'ur' : 'en'}
      />
    </div>
  );
}
