import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Bdi, Ltr } from '@/components/ui';
import { fillSlots, slot } from '@/components/ui/Bidi';
import { getProfile } from '@/modules/auth';
import { LogoutButton } from '@/modules/auth/ui/LogoutButton';
import { getPool } from '@/platform/db';
import { requireActor } from '@/platform/http/server';

// Session dependent: rendered on every request, never cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('account.title')} | ${common('appName')}`, robots: { index: false } };
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('');
  return letters.toLocaleUpperCase('en');
}

function DetailIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 shrink-0 text-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ROLE_ICON = 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3zM9 12l2 2 4-4';
const BRANCH_ICON = 'M4 20V9l8-5 8 5v11M9 20v-6h6v6M3 20h18';

export default async function AccountPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user } = await requireActor();
  const [t, profile] = await Promise.all([getTranslations('auth'), getProfile(getPool(), user)]);
  const firstName = profile.name.trim().split(/\s+/)[0] ?? profile.name;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-accent">{t('account.title')}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-text">
          {fillSlots(t('account.greeting', { name: slot() }), [<Bdi key="name">{firstName}</Bdi>])}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t('account.intro')}</p>
      </header>

      <section
        aria-labelledby="account-details"
        className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
      >
        <h2 id="account-details" className="sr-only">
          {t('account.details')}
        </h2>

        <div className="relative flex items-center gap-5 overflow-hidden border-b border-border bg-surface-sunken/70 px-6 py-6 sm:px-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -end-16 -top-20 size-56 rounded-full border-[18px] border-primary opacity-[0.07]"
          />
          <div
            aria-hidden="true"
            lang="en"
            className="relative grid size-16 shrink-0 place-items-center rounded-2xl bg-primary text-xl font-semibold tracking-wide text-primary-contrast shadow-card"
          >
            {initialsOf(profile.name)}
          </div>
          <div className="relative min-w-0 flex-1">
            <p className="text-xs font-medium text-text-muted">{t('account.signedInAs')}</p>
            <p className="truncate text-xl font-semibold text-text">
              <Bdi>{profile.name}</Bdi>
            </p>
            <p className="truncate text-sm text-text-muted">
              <Ltr>{profile.email}</Ltr>
            </p>
          </div>
        </div>

        <dl className="grid gap-px bg-border sm:grid-cols-2">
          <div className="flex items-start gap-3 bg-surface-raised px-6 py-5 sm:px-8">
            <DetailIcon path={ROLE_ICON} />
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-text-muted">{t('account.role')}</dt>
              <dd className="text-base font-semibold text-text">{t(`roles.${profile.role}`)}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3 bg-surface-raised px-6 py-5 sm:px-8">
            <DetailIcon path={BRANCH_ICON} />
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-text-muted">{t('account.branch')}</dt>
              <dd className="text-base font-semibold text-text">
                {profile.branchName ? (
                  <bdi>{profile.branchName}</bdi>
                ) : (
                  <span className="font-medium text-text-muted">{t('account.noBranch')}</span>
                )}
              </dd>
            </div>
          </div>
        </dl>

        <div className="flex flex-col gap-4 border-t border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-sm text-text-muted">{t('account.logoutHint')}</p>
          <LogoutButton />
        </div>
      </section>
    </div>
  );
}
