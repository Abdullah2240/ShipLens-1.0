'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bdi, DataTable, EmptyState, type Column } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { TeamItem } from '@/modules/members/types';
import { formatInt } from '@/platform/i18n/format';

type BranchOption = { id: string; name: string };
type Failure = 'duplicate' | 'nameInvalid' | 'error' | 'chooseBranch';
type Reply = { ok: boolean; status: number; json: unknown };

export interface TeamsPanelProps {
  teams: TeamItem[];
  canManage: boolean;
  /** Only for Super Admin, who must pick the branch of a new team. */
  branches?: BranchOption[];
}

const NAME_MIN = 2;
const NAME_MAX = 60;
const validName = (name: string) => name.length >= NAME_MIN && name.length <= NAME_MAX;

async function send(method: 'POST' | 'PATCH', url: string, payload: unknown): Promise<Reply> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return {
      ok: response.ok,
      status: response.status,
      json: await response.json().catch(() => null),
    };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

function failureOf(reply: Reply): Failure {
  if (reply.status === 409) return 'duplicate';
  if (reply.status === 422) {
    const fields = (reply.json as { error?: { details?: { fields?: unknown } } } | null)?.error
      ?.details?.fields;
    if (Array.isArray(fields) && fields.some((f: { path?: unknown }) => f?.path === 'name')) {
      return 'nameInvalid';
    }
  }
  return 'error';
}

const fieldClass =
  'block h-10 w-full rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60';
const primaryButton =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';
const quietButton =
  'inline-flex h-8 items-center justify-center rounded-md px-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" className="text-sm font-medium text-tone-danger-fg">
      {children}
    </p>
  );
}

export function TeamsPanel({ teams, canManage, branches }: TeamsPanelProps) {
  const t = useTranslations('members.teams');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();

  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<Failure | null>(null);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<Failure | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);

  const [notice, setNotice] = useState<'created' | 'renamed' | null>(null);
  const inFlight = useRef(false);

  // Names renamed here show at once; a refresh brings the server copy and clears them.
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [previous, setPrevious] = useState(teams);
  if (teams !== previous) {
    setPrevious(teams);
    setRenamed({});
  }
  const nameOf = (team: TeamItem) => renamed[team.id] ?? team.name;

  useEffect(() => {
    if (editing) renameInput.current?.focus();
  }, [editing]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmed = name.trim();
    setNotice(null);
    if (!validName(trimmed)) return setCreateError('nameInvalid');
    if (branches && !branchId) return setCreateError('chooseBranch');
    inFlight.current = true;
    setCreating(true);
    setCreateError(null);
    const reply = await send(
      'POST',
      '/api/v1/teams',
      branches ? { name: trimmed, branchId } : { name: trimmed },
    );
    if (reply.ok) {
      setName('');
      setNotice('created');
      router.refresh();
    } else {
      setCreateError(failureOf(reply));
    }
    setCreating(false);
    inFlight.current = false;
  }

  function startRename(team: TeamItem) {
    setEditing(team.id);
    setDraft(nameOf(team));
    setRenameError(null);
    setNotice(null);
  }

  function cancelRename() {
    setEditing(null);
    setRenameError(null);
  }

  async function onRename(event: FormEvent<HTMLFormElement>, team: TeamItem) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmed = draft.trim();
    if (trimmed === nameOf(team)) return cancelRename();
    if (!validName(trimmed)) return setRenameError('nameInvalid');
    inFlight.current = true;
    setRenaming(true);
    setRenameError(null);
    const reply = await send('PATCH', `/api/v1/teams/${team.id}`, { name: trimmed });
    if (reply.ok) {
      setRenamed((current) => ({ ...current, [team.id]: trimmed }));
      setEditing(null);
      setNotice('renamed');
      router.refresh();
    } else {
      setRenameError(failureOf(reply));
    }
    setRenaming(false);
    inFlight.current = false;
  }

  const columns: Column<TeamItem>[] = [
    {
      key: 'name',
      header: t('name'),
      className: 'min-w-48',
      render: (team) =>
        editing === team.id ? (
          <form noValidate onSubmit={(e) => void onRename(e, team)} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={renameInput}
                type="text"
                value={draft}
                maxLength={NAME_MAX}
                dir="auto"
                disabled={renaming}
                aria-label={t('renameLabel', { name: nameOf(team) })}
                aria-invalid={renameError ? true : undefined}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') cancelRename();
                }}
                className={`${fieldClass} h-9 max-w-64 flex-1`}
              />
              <button
                type="submit"
                disabled={renaming}
                className={`${quietButton} bg-primary text-primary-contrast hover:bg-primary-hover`}
              >
                {t('save')}
              </button>
              <button
                type="button"
                disabled={renaming}
                onClick={cancelRename}
                className={`${quietButton} text-text-muted hover:bg-surface-sunken hover:text-text`}
              >
                {t('cancel')}
              </button>
            </div>
            {renameError ? <ErrorText>{t(renameError)}</ErrorText> : null}
          </form>
        ) : (
          <Bdi className="font-semibold text-text">{nameOf(team)}</Bdi>
        ),
    },
  ];

  if (branches) {
    columns.push({
      key: 'branch',
      header: t('branch'),
      render: (team) => <Bdi className="whitespace-nowrap text-text-muted">{team.branchName}</Bdi>,
    });
  }

  columns.push({
    key: 'members',
    header: t('members'),
    align: 'numeric',
    render: (team) => formatInt(team.memberCount, locale),
  });

  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      align: 'end',
      render: (team) =>
        editing === team.id ? null : (
          <button
            type="button"
            onClick={() => startRename(team)}
            aria-label={t('renameAction', { name: nameOf(team) })}
            className={`${quietButton} text-primary hover:bg-surface-sunken`}
          >
            {t('rename')}
          </button>
        ),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <section
          aria-labelledby={`${id}-create`}
          className="rounded-card border border-border bg-surface-raised p-4 shadow-card sm:p-5"
        >
          <h2 id={`${id}-create`} className="mb-3 text-sm font-semibold text-text">
            {t('createTitle')}
          </h2>
          <form noValidate onSubmit={(e) => void onCreate(e)} className="flex flex-col gap-3">
            <div
              className={`grid gap-3 sm:items-end ${branches ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-name`} className="text-xs font-semibold text-text-muted">
                  {t('nameLabel')}
                </label>
                <input
                  id={`${id}-name`}
                  type="text"
                  name="name"
                  value={name}
                  maxLength={NAME_MAX}
                  dir="auto"
                  disabled={creating}
                  placeholder={t('createPlaceholder')}
                  aria-invalid={
                    createError === 'nameInvalid' || createError === 'duplicate' ? true : undefined
                  }
                  onChange={(e) => {
                    setName(e.target.value);
                    if (notice === 'created') setNotice(null);
                  }}
                  className={`${fieldClass} placeholder:text-text-muted/80`}
                />
              </div>
              {branches ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-branch`} className="text-xs font-semibold text-text-muted">
                    {t('branchLabel')}
                  </label>
                  <select
                    id={`${id}-branch`}
                    name="branchId"
                    required
                    value={branchId}
                    disabled={creating}
                    aria-invalid={createError === 'chooseBranch' ? true : undefined}
                    onChange={(e) => setBranchId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">{t('chooseBranch')}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <button type="submit" disabled={creating} className={primaryButton}>
                <svg
                  viewBox="0 0 20 20"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M10 4.5v11M4.5 10h11" />
                </svg>
                {t('create')}
              </button>
            </div>
            {createError ? <ErrorText>{t(createError)}</ErrorText> : null}
          </form>
        </section>
      ) : (
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
          <span>{t('readOnlyNotice')}</span>
        </p>
      )}

      {/* Empty until a create or rename succeeds; hidden while empty so it adds no gap. */}
      <div role="status" className="empty:hidden">
        {notice ? (
          <p className="inline-flex items-center gap-2 text-sm font-medium text-tone-success-fg">
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
            {t(notice)}
          </p>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={teams}
        getRowKey={(team) => team.id}
        caption={t('caption')}
        captionHidden
        empty={
          <EmptyState title={t('empty')} body={canManage ? t('emptyBody') : t('emptyReadOnly')} />
        }
      />
    </div>
  );
}
