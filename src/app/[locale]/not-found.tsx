import { useTranslations } from 'next-intl';
import { MinimalShell } from '@/components/shell/MinimalShell';
import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';

export default function LocaleNotFound() {
  const t = useTranslations('shell.notFound');

  return (
    <MinimalShell>
      <EmptyState
        title={t('title')}
        body={t('body')}
        action={
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-hover"
          >
            {t('home')}
          </Link>
        }
      />
    </MinimalShell>
  );
}
