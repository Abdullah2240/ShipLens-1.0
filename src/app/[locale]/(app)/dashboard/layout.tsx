import type { ReactNode } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardTabs } from '@/modules/reporting/components/dashboard/DashboardTabs';

// Section frame for every /dashboard/** page. It reads no session: each page authorizes
// itself, and a refused page renders the not-found page in place of this layout.
export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 print:hidden">
        <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase rtl:tracking-normal">
          {t('section')}
        </p>
        <DashboardTabs />
      </div>
      {children}
    </div>
  );
}
