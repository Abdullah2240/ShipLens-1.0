'use client';

import { useTranslations } from 'next-intl';
import { MinimalShell } from '@/components/shell/MinimalShell';
import { ErrorState } from '@/components/ui';
import { Link } from '@/i18n/navigation';

export default function LocaleError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('shell.error');

  return (
    <MinimalShell>
      <div className="flex flex-col items-center gap-4">
        <ErrorState title={t('title')} body={t('body')} onRetry={reset} />
        <Link
          href="/"
          className="text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          {t('home')}
        </Link>
      </div>
    </MinimalShell>
  );
}
