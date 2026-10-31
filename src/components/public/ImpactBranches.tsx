import { useTranslations } from 'next-intl';
import { Bdi } from '@/components/ui';

export interface ImpactBranch {
  name: string;
  city: string | null;
}

export interface ImpactBranchesProps {
  /** Active branches, ordered by city (no city last), then name. */
  branches: ImpactBranch[];
}

interface CityGroup {
  city: string | null;
  names: string[];
}

/** Keeps the incoming order and always puts branches without a city last. */
function groupByCity(branches: ImpactBranch[]): CityGroup[] {
  const groups = new Map<string | null, string[]>();
  for (const branch of branches) {
    const city = branch.city?.trim() ? branch.city.trim() : null;
    const names = groups.get(city) ?? [];
    names.push(branch.name);
    groups.set(city, names);
  }
  const named = [...groups.entries()].filter(([city]) => city !== null);
  const unnamed = groups.get(null);
  return [
    ...named.map(([city, names]) => ({ city, names })),
    ...(unnamed ? [{ city: null, names: unnamed }] : []),
  ];
}

const PIN =
  'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z';

/** Active branches grouped by city as warm cards: city heading, then branch names. */
export function ImpactBranches({ branches }: ImpactBranchesProps) {
  const t = useTranslations('impact.branches');
  const groups = groupByCity(branches);

  return (
    <section
      aria-labelledby="impact-branches-title"
      className="border-y border-border bg-surface-sunken"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20">
        <div className="max-w-2xl">
          <h2
            id="impact-branches-title"
            className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl"
          >
            {t('title')}
          </h2>
          <p className="mt-3 text-lg text-pretty text-text-muted">{t('lead')}</p>
        </div>

        {groups.length === 0 ? (
          <p className="mt-8 rounded-card border border-dashed border-border-strong/50 bg-surface-raised px-6 py-8 text-text-muted">
            {t('empty')}
          </p>
        ) : (
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group, index) => (
              <li
                key={group.city ?? '\u0000'}
                data-impact-city={group.city ?? ''}
                className="relative flex flex-col gap-5 overflow-hidden rounded-card border border-border bg-surface-raised p-6 shadow-card"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-12 end-[-3rem] size-28 rounded-full bg-accent-soft/70 blur-2xl"
                />
                <div className="relative flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={PIN} />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <h3
                      id={`impact-city-${index}`}
                      className="text-lg leading-snug font-semibold text-text"
                    >
                      <Bdi>{group.city ?? t('otherCity')}</Bdi>
                    </h3>
                    <p className="text-sm text-text-muted">
                      {t('count', { count: group.names.length })}
                    </p>
                  </div>
                </div>
                <ul
                  aria-labelledby={`impact-city-${index}`}
                  className="relative flex flex-col divide-y divide-border border-t border-border"
                >
                  {group.names.map((name, i) => (
                    <li key={`${name}-${i}`} className="flex items-center gap-3 py-2.5">
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-primary"
                      />
                      <Bdi className="min-w-0 font-medium text-text">{name}</Bdi>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
