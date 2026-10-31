'use client';

import { useId, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { AuditFacets, AuditQuery } from '../types';
import { AUDIT_PATH, auditHref } from './audit-entity-link';

export interface AuditFiltersProps {
  facets: AuditFacets;
  query: AuditQuery;
}

const MESSAGE_KEY = /^[a-z][a-z0-9_]*$/i;
const FILTER_KEYS = ['from', 'to', 'actor', 'action', 'entity', 'entityId', 'branch'] as const;

const labelClass = 'text-xs font-semibold text-text-muted';
const fieldClass =
  'block h-10 w-full min-w-0 rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Adds the current value when the facets do not list it, so a shared URL survives Apply. */
function withCurrent(values: string[], current: string | undefined): string[] {
  return current && !values.includes(current) ? [...values, current] : values;
}

/** Audit filters. Apply writes them to the URL (dropping the page cursor); Reset clears them. */
export function AuditFilters({ facets, query }: AuditFiltersProps) {
  const t = useTranslations('audit');
  const router = useRouter();
  const id = useId();
  const label = (prefix: string, key: string) =>
    MESSAGE_KEY.test(key) && t.has(`${prefix}.${key}`) ? t(`${prefix}.${key}`) : key;
  const any = t('viewer.filters.any');
  const actionLabel = (action: string) => {
    const key = action.replaceAll('.', '_');
    return MESSAGE_KEY.test(key) && t.has(`actions.${key}`) ? t(`actions.${key}`) : action;
  };

  // Actions grouped by record family ("report.approve" sits under Report).
  const actions = withCurrent(facets.actions, query.action);
  const families = [...new Set(actions.map((a) => a.split('.')[0] ?? a))];
  const entityTypes = withCurrent(facets.entityTypes, query.entity);
  const actors =
    facets.actors.some((a) => a.id === query.actor) || !query.actor
      ? facets.actors
      : [...facets.actors, { id: query.actor, name: query.actor, role: '' }];
  const branches =
    facets.branches.some((b) => b.id === query.branch) || !query.branch
      ? facets.branches
      : [...facets.branches, { id: query.branch, code: query.branch.slice(0, 8), name: '' }];

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: Partial<Record<(typeof FILTER_KEYS)[number], string>> = {};
    for (const key of FILTER_KEYS) {
      const value = String(data.get(key) ?? '').trim();
      if (value) next[key] = value;
    }
    if (next.from && next.to && next.from > next.to) [next.from, next.to] = [next.to, next.from];
    router.push(auditHref({ ...next, limit: query.limit }));
  }

  function reset() {
    router.push(AUDIT_PATH);
  }

  const field = (name: string) => `${id}-${name}`;
  // Remount on a new URL so back and forward show the filters of that URL.
  const formKey = FILTER_KEYS.map((key) => query[key] ?? '').join('|');

  return (
    <form
      key={formKey}
      method="get"
      onSubmit={apply}
      role="search"
      aria-labelledby={field('title')}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised p-4 shadow-card sm:p-5"
    >
      <h2 id={field('title')} className="text-sm font-semibold text-text">
        {t('viewer.filters.title')}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('from')} className={labelClass}>
            {t('viewer.filters.from')}
          </label>
          <input
            id={field('from')}
            type="date"
            name="from"
            dir="ltr"
            lang="en-GB"
            defaultValue={query.from ?? ''}
            className={`${fieldClass} tabular`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('to')} className={labelClass}>
            {t('viewer.filters.to')}
          </label>
          <input
            id={field('to')}
            type="date"
            name="to"
            dir="ltr"
            lang="en-GB"
            defaultValue={query.to ?? ''}
            className={`${fieldClass} tabular`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('actor')} className={labelClass}>
            {t('viewer.filters.actor')}
          </label>
          <select
            id={field('actor')}
            name="actor"
            defaultValue={query.actor ?? ''}
            className={fieldClass}
          >
            <option value="">{any}</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.role ? `${actor.name} · ${label('roles', actor.role)}` : actor.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('branch')} className={labelClass}>
            {t('viewer.filters.branch')}
          </label>
          <select
            id={field('branch')}
            name="branch"
            defaultValue={query.branch ?? ''}
            className={fieldClass}
          >
            <option value="">{any}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name ? `${branch.code} · ${branch.name}` : branch.code}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor={field('action')} className={labelClass}>
            {t('viewer.filters.action')}
          </label>
          <select
            id={field('action')}
            name="action"
            defaultValue={query.action ?? ''}
            className={fieldClass}
          >
            <option value="">{any}</option>
            {families.map((family) => (
              <optgroup key={family} label={label('entities', family)}>
                {actions
                  .filter((action) => (action.split('.')[0] ?? action) === family)
                  .map((action) => (
                    <option key={action} value={action}>
                      {actionLabel(action)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('entity')} className={labelClass}>
            {t('viewer.filters.entity')}
          </label>
          <select
            id={field('entity')}
            name="entity"
            defaultValue={query.entity ?? ''}
            className={fieldClass}
          >
            <option value="">{any}</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {label('entities', type)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={field('entityId')} className={labelClass}>
            {t('viewer.filters.entityId')}
          </label>
          <input
            id={field('entityId')}
            type="text"
            name="entityId"
            dir="ltr"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            defaultValue={query.entityId ?? ''}
            className={`${fieldClass} font-mono text-[0.92em]`}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-sunken hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('viewer.filters.reset')}
        </button>
        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('viewer.filters.apply')}
        </button>
      </div>
    </form>
  );
}
