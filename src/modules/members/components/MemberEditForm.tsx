'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bdi, ConfirmDialog, Ltr, StatusBadge } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { MemberPatch } from '@/modules/members/schema';
import {
  MEMBER_ROLES,
  MEMBER_STATUS_VALUES,
  type MemberListItem,
  type MemberStatus,
} from '@/modules/members/types';
import { formatDate } from '@/platform/i18n/format';
import { MEMBERS_PATH } from './MembersFilters';
import { MemberCode, isKnownRole } from './MembersTable';

type TeamOption = { id: string; name: string };
type Values = { teamId: string; memberRole: string; status: MemberStatus };
type Feedback = 'saved' | 'teamInvalid' | 'error';

export interface MemberEditFormProps {
  member: MemberListItem;
  /** Teams of the member's own branch only; the page filters them. */
  teams: TeamOption[];
  canEdit: boolean;
}

const valuesOf = (member: MemberListItem): Values => ({
  teamId: member.teamId ?? '',
  memberRole: member.memberRole,
  status: member.status,
});

function changes(base: Values, next: Values): MemberPatch {
  const patch: MemberPatch = {};
  if (next.teamId !== base.teamId) patch.teamId = next.teamId || null;
  if (next.memberRole !== base.memberRole) {
    patch.memberRole = next.memberRole as (typeof MEMBER_ROLES)[number];
  }
  if (next.status !== base.status) patch.status = next.status;
  return patch;
}

function isInvalidTeam(status: number, json: unknown): boolean {
  if (status !== 422) return false;
  const fields = (json as { error?: { details?: { fields?: unknown } } } | null)?.error?.details
    ?.fields;
  return (
    Array.isArray(fields) && fields.some((f: { code?: unknown }) => f?.code === 'invalid_team')
  );
}

function memberFrom(json: unknown): MemberListItem | null {
  const data = (json as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' && 'memberCode' in data ? (data as MemberListItem) : null;
}

function safeDate(value: string, locale: Locale): string {
  try {
    return formatDate(value, locale);
  } catch {
    return value;
  }
}

const fieldClass =
  'block h-10 w-full rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-card border border-border bg-surface-raised shadow-card">
      <h2 className="border-b border-border px-5 py-3.5 text-sm font-semibold text-text">
        {title}
      </h2>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold text-text-muted">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 animate-spin motion-reduce:animate-none"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function MemberEditForm({ member, teams, canEdit }: MemberEditFormProps) {
  const t = useTranslations('members');
  const statusLabel = useTranslations('common.status');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();

  // `view` is the latest server state: the prop after a refresh, or the reply of a save.
  const [view, setView] = useState(member);
  const [previous, setPrevious] = useState(member);
  const [values, setValues] = useState(() => valuesOf(member));
  if (member !== previous) {
    setPrevious(member);
    setView(member);
    setValues(valuesOf(member));
  }

  const [pending, setPending] = useState(false);
  const [confirmLeft, setConfirmLeft] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inFlight = useRef(false);

  const base = valuesOf(view);
  const patch = changes(base, values);
  const dirty = Object.keys(patch).length > 0;

  // Keep the current values selectable even if they fall outside the offered lists.
  const teamOptions =
    view.teamId && !teams.some((team) => team.id === view.teamId)
      ? [...teams, { id: view.teamId, name: view.teamName ?? view.teamId }]
      : teams;
  const roleOptions: string[] = isKnownRole(view.memberRole)
    ? [...MEMBER_ROLES]
    : [...MEMBER_ROLES, view.memberRole];

  const roleLabel = (value: string) => (isKnownRole(value) ? t(`roles.${value}`) : value);
  const teamName = view.teamId
    ? (teams.find((team) => team.id === view.teamId)?.name ?? view.teamName)
    : null;

  async function save(body: MemberPatch) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFeedback(null);
    let status = 0;
    let json: unknown = null;
    try {
      const response = await fetch(`/api/v1/members/${view.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = response.status;
      json = await response.json().catch(() => null);
      if (response.ok) {
        const next = memberFrom(json) ?? {
          ...view,
          teamId: values.teamId || null,
          teamName: teamOptions.find((team) => team.id === values.teamId)?.name ?? null,
          memberRole: values.memberRole,
          status: values.status,
        };
        setView(next);
        setValues(valuesOf(next));
        setFeedback('saved');
        router.refresh();
      } else {
        setFeedback(isInvalidTeam(status, json) ? 'teamInvalid' : 'error');
      }
    } catch {
      setFeedback('error');
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || pending) return;
    if (patch.status === 'left') {
      setConfirmLeft(true);
      return;
    }
    void save(patch);
  }

  function update(next: Partial<Values>) {
    setValues((current) => ({ ...current, ...next }));
    if (feedback === 'saved') setFeedback(null);
  }

  const notProvided = <span className="text-text-muted">{t('detail.notProvided')}</span>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={MEMBERS_PATH}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5l-5 5 5 5" />
          </svg>
          {t('detail.back')}
        </Link>

        <header className="flex flex-col gap-3 border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('detail.title')}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              <Bdi>{view.fullName}</Bdi>
            </h1>
            <MemberCode code={view.memberCode} />
            <StatusBadge status={view.status} />
          </div>
          <p className="text-sm text-text-muted">
            <Bdi>{view.branchName}</Bdi>
            {' · '}
            {teamName != null ? <Bdi>{teamName}</Bdi> : t('detail.unassigned')}
            {' · '}
            {roleLabel(view.memberRole)}
          </p>
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <Card title={t('detail.profile')}>
          <dl className="grid gap-5 sm:grid-cols-2">
            <Fact label={t('columns.code')}>
              <MemberCode code={view.memberCode} />
            </Fact>
            <Fact label={t('columns.branch')}>
              <Bdi>{view.branchName}</Bdi>
            </Fact>
            <Fact label={t('detail.email')}>
              {view.email ? <Ltr className="break-all">{view.email}</Ltr> : notProvided}
            </Fact>
            <Fact label={t('detail.phone')}>
              {view.phone ? <Ltr className="tabular">{view.phone}</Ltr> : notProvided}
            </Fact>
            <Fact label={t('columns.joined')}>
              {view.joinedOn ? (
                <Bdi className="tabular">
                  <time dateTime={view.joinedOn}>{safeDate(view.joinedOn, locale)}</time>
                </Bdi>
              ) : (
                notProvided
              )}
            </Fact>
          </dl>
        </Card>

        <Card title={t('detail.assignment')}>
          {canEdit ? (
            <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-team`} className="text-sm font-semibold text-text">
                  {t('edit.team')}
                </label>
                <select
                  id={`${id}-team`}
                  name="teamId"
                  value={values.teamId}
                  disabled={pending}
                  aria-describedby={`${id}-team-hint`}
                  aria-invalid={feedback === 'teamInvalid' || undefined}
                  onChange={(e) => update({ teamId: e.target.value })}
                  className={fieldClass}
                >
                  <option value="">{t('detail.unassigned')}</option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <p id={`${id}-team-hint`} className="text-xs text-text-muted">
                  {t('edit.teamHint')}
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-role`} className="text-sm font-semibold text-text">
                    {t('edit.role')}
                  </label>
                  <select
                    id={`${id}-role`}
                    name="memberRole"
                    value={values.memberRole}
                    disabled={pending}
                    onChange={(e) => update({ memberRole: e.target.value })}
                    className={fieldClass}
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-status`} className="text-sm font-semibold text-text">
                    {t('edit.status')}
                  </label>
                  <select
                    id={`${id}-status`}
                    name="status"
                    value={values.status}
                    disabled={pending}
                    onChange={(e) => update({ status: e.target.value as MemberStatus })}
                    className={fieldClass}
                  >
                    {MEMBER_STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {statusLabel(value)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {feedback === 'teamInvalid' || feedback === 'error' ? (
                <p
                  role="alert"
                  className="rounded-lg border border-danger/40 bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg"
                >
                  {t(`edit.${feedback}`)}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p role="status" className="text-sm text-text-muted">
                  {dirty ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="size-2 rounded-full bg-tone-warning-fg" />
                      {t('edit.unsaved')}
                    </span>
                  ) : feedback === 'saved' ? (
                    <span className="inline-flex items-center gap-2 text-tone-success-fg">
                      <svg
                        viewBox="0 0 20 20"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                      </svg>
                      {t('edit.saved')}
                    </span>
                  ) : null}
                </p>
                <button
                  type="submit"
                  disabled={!dirty || pending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? <Spinner /> : null}
                  {pending ? t('edit.saving') : t('edit.save')}
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-5">
              <dl className="grid gap-5 sm:grid-cols-3">
                <Fact label={t('edit.team')}>
                  {teamName != null ? (
                    <Bdi>{teamName}</Bdi>
                  ) : (
                    <span className="text-text-muted italic">{t('detail.unassigned')}</span>
                  )}
                </Fact>
                <Fact label={t('edit.role')}>{roleLabel(view.memberRole)}</Fact>
                <Fact label={t('edit.status')}>{statusLabel(view.status)}</Fact>
              </dl>
              <p className="flex items-start gap-2.5 rounded-lg border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-sm text-tone-info-fg">
                <svg
                  viewBox="0 0 20 20"
                  className="mt-0.5 size-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
                  <path d="M7 9V6.75a3 3 0 016 0V9" />
                </svg>
                <span>{t('detail.readOnlyNotice')}</span>
              </p>
            </div>
          )}
        </Card>
      </div>

      {canEdit ? (
        <ConfirmDialog
          open={confirmLeft}
          tone="destructive"
          title={t('edit.leftTitle')}
          description={t('edit.leftBody', { name: view.fullName })}
          confirmLabel={t('edit.leftConfirm')}
          onConfirm={() => {
            setConfirmLeft(false);
            void save(patch);
          }}
          onCancel={() => setConfirmLeft(false)}
        />
      ) : null}
    </div>
  );
}
