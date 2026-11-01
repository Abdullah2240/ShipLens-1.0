import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { ContentLocale, PublicBranch } from '@/modules/public-site';

export interface BranchesByCityProps {
  branches: PublicBranch[];
  locale: ContentLocale;
}

interface CityGroup {
  /** null collects branches without a city. */
  city: string | null;
  branches: PublicBranch[];
}

/** Keeps the service's order (city, then name) and always puts branches without a city last. */
function groupByCity(branches: PublicBranch[]): CityGroup[] {
  const groups = new Map<string | null, PublicBranch[]>();
  for (const branch of branches) {
    const city = branch.city?.trim() ? branch.city.trim() : null;
    const list = groups.get(city) ?? [];
    list.push(branch);
    groups.set(city, list);
  }
  const named = [...groups.entries()].filter(([city]) => city !== null);
  const unnamed = groups.get(null);
  return [
    ...named.map(([city, list]) => ({ city, branches: list })),
    ...(unnamed ? [{ city: null, branches: unnamed }] : []),
  ];
}

const PIN =
  'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z';

function Monogram({ name }: { name: string }) {
  const initial = Array.from(name.trim())[0] ?? '';
  return (
    <span
      aria-hidden="true"
      className="font-display-ur grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg font-bold text-accent"
    >
      {initial}
    </span>
  );
}

export function BranchesByCity({ branches }: BranchesByCityProps) {
  const t = useTranslations('public.branches');

  if (branches.length === 0) {
    return <EmptyState title={t('empty.title')} body={t('empty.body')} />;
  }

  const groups = groupByCity(branches);
  const anchor = (index: number) => `branches-city-${index}`;

  return (
    <div className="flex flex-col gap-12 md:gap-16">
      {groups.length > 1 ? (
        <nav aria-label={t('jumpTo')} className="-mb-4 md:-mb-8">
          <ul className="flex flex-wrap gap-2">
            {groups.map((group, index) => (
              <li key={group.city ?? '\u0000'}>
                <a
                  href={`#${anchor(index)}`}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface-raised px-4 text-sm font-medium text-text transition-colors hover:border-accent/50 hover:bg-accent-soft"
                >
                  <bdi>{group.city ?? t('otherCity')}</bdi>
                  <span className="text-text-muted tabular-nums">{group.branches.length}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {groups.map((group, index) => (
        <section
          key={group.city ?? '\u0000'}
          id={anchor(index)}
          aria-labelledby={`${anchor(index)}-title`}
          className="scroll-mt-24"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-3">
            <svg
              viewBox="0 0 24 24"
              className="size-5 shrink-0 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={PIN} />
            </svg>
            <h2
              id={`${anchor(index)}-title`}
              className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl"
            >
              <bdi>{group.city ?? t('otherCity')}</bdi>
            </h2>
            <span className="text-sm text-text-muted">
              {t('cityCount', { count: group.branches.length })}
            </span>
          </div>

          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {group.branches.map((branch) => (
              <li
                key={branch.id}
                className="relative flex flex-col gap-4 overflow-hidden rounded-card border border-border bg-surface-raised p-6 shadow-card transition-colors hover:border-accent/40"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-12 end-[-3rem] size-28 rounded-full bg-accent-soft/60 blur-2xl"
                />
                <div className="relative flex items-start gap-4">
                  <Monogram name={branch.name} />
                  <h3 className="pt-2 text-lg leading-snug font-semibold text-text">
                    <bdi>{branch.name}</bdi>
                  </h3>
                </div>
                {branch.summary?.trim() ? (
                  <p dir="auto" className="relative whitespace-pre-line text-text-muted">
                    {branch.summary}
                  </p>
                ) : null}
                <Link
                  prefetch={false}
                  href={`/get-involved/apply?branch=${branch.id}`}
                  className="relative mt-auto inline-flex w-fit items-center gap-1.5 pt-2 font-semibold text-primary underline-offset-4 hover:text-primary-hover hover:underline"
                >
                  {t('applyHere')}
                  <span aria-hidden="true" className="rtl:-scale-x-100">
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
