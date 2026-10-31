import { useTranslations } from 'next-intl';

function Bar({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none ${className}`}
    />
  );
}

// Same frame as the overview (header, filters, money flow, counts and trend), so the page
// settles in place without moving.
export default function DashboardLoading() {
  const t = useTranslations('dashboard');

  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-8">
      <span className="sr-only">{t('loading')}</span>
      <div className="flex flex-col gap-3">
        <Bar className="h-9 w-64 max-w-full" />
        <Bar className="h-4 w-[32rem] max-w-full" />
        <Bar className="h-3 w-48" />
      </div>
      <Bar className="h-24 w-full rounded-card" />
      <div className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card">
        <div className="border-b border-border px-6 py-4 sm:px-8">
          <Bar className="h-3 w-28" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-5 px-6 py-7 sm:px-8">
              <Bar className="h-4 w-24" />
              <Bar className={i === 0 ? 'h-10 w-72 max-w-full' : 'h-7 w-56 max-w-full'} />
              <Bar className="h-2.5 w-full rounded-full" />
              <div className="grid grid-cols-3 gap-4">
                <Bar className="h-10" />
                <Bar className="h-10" />
                <Bar className="h-10" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Bar className="h-36 rounded-card" />
          <Bar className="h-36 rounded-card" />
        </div>
        <Bar className="h-80 rounded-card" />
      </div>
    </div>
  );
}
