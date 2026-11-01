'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApplicationStatus } from '@/platform/config/constants';
import { MemberCode, memberHref } from '@/modules/members/components/MembersTable';

export interface ApplicationDecisionProps {
  applicationId: string;
  applicantName: string;
  status: ApplicationStatus;
}

type Choice = 'accept' | 'decline';
type Outcome =
  | { kind: 'accepted'; memberId: string; memberCode: string }
  | { kind: 'declined' }
  | { kind: 'alreadyDecided' }
  | { kind: 'error' };

const NOTE_MAX = 500;

function acceptedMember(json: unknown): { memberId: string; memberCode: string } | null {
  const data = (json as { data?: { memberId?: unknown; memberCode?: unknown } } | null)?.data;
  return typeof data?.memberId === 'string' && typeof data.memberCode === 'string'
    ? { memberId: data.memberId, memberCode: data.memberCode }
    : null;
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

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="mt-0.5 size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

/** Accept and decline controls for a pending application. Each decision is confirmed first. */
export function ApplicationDecision({
  applicationId,
  applicantName,
  status,
}: ApplicationDecisionProps) {
  const t = useTranslations('applications.admin');
  const router = useRouter();
  const noteId = useId();
  const [dialog, setDialog] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false);

  async function decide(choice: Choice) {
    if (inFlight.current) return;
    inFlight.current = true;
    setDialog(null);
    setPending(true);
    setOutcome(null);

    const trimmed = note.trim();
    const init: RequestInit =
      choice === 'accept'
        ? { method: 'POST', credentials: 'same-origin' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(trimmed ? { note: trimmed } : {}),
          };

    let next: Outcome = { kind: 'error' };
    try {
      const response = await fetch(`/api/v1/applications/${applicationId}/${choice}`, init);
      if (response.ok) {
        if (choice === 'decline') {
          next = { kind: 'declined' };
        } else {
          const member = acceptedMember(await response.json().catch(() => null));
          next = member ? { kind: 'accepted', ...member } : { kind: 'error' };
        }
      } else if (response.status === 409) {
        next = { kind: 'alreadyDecided' };
      }
    } catch {
      next = { kind: 'error' };
    }

    setOutcome(next);
    setPending(false);
    if (next.kind === 'error') {
      inFlight.current = false;
    } else {
      // Show the decision the server now holds; this component keeps its notice meanwhile.
      router.refresh();
    }
  }

  if (outcome?.kind === 'accepted') {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-lg border border-tone-success-fg/25 bg-tone-success-bg px-4 py-3 text-sm text-tone-success-fg"
      >
        <p className="flex items-start gap-2 font-semibold">
          <Check />
          <span>{t('decision.accepted', { name: applicantName })}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 ps-6">
          <span className="text-xs font-semibold">{t('detail.member')}</span>
          <MemberCode code={outcome.memberCode} />
          <Link
            href={memberHref(outcome.memberId)}
            className="font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('detail.viewMember')}
          </Link>
        </p>
      </div>
    );
  }

  if (outcome?.kind === 'declined') {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm font-semibold text-text"
      >
        <Check />
        <span>{t('decision.declined')}</span>
      </p>
    );
  }

  if (outcome?.kind === 'alreadyDecided') {
    return (
      <p
        role="alert"
        className="rounded-lg border border-tone-warning-fg/30 bg-tone-warning-bg px-4 py-3 text-sm font-medium text-tone-warning-fg"
      >
        {t('decision.alreadyDecided')}
      </p>
    );
  }

  if (status !== 'pending') return null;

  const open = (choice: Choice) => {
    if (inFlight.current) return;
    if (choice === 'decline') setNote('');
    setDialog(choice);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-text-muted">{t('decision.prompt')}</p>

      {outcome?.kind === 'error' ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg"
        >
          {t('decision.error')}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={pending}
          onClick={() => open('accept')}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('decision.accept')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => open('decline')}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-danger/50 bg-surface-raised px-4 text-sm font-semibold text-danger shadow-xs transition-colors hover:bg-tone-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('decision.decline')}
        </button>
      </div>

      {pending ? (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-text-muted">
          <Spinner />
          {t('decision.working')}
        </p>
      ) : null}

      <ConfirmDialog
        open={dialog === 'accept'}
        title={t('decision.acceptTitle')}
        description={t('decision.acceptBody', { name: applicantName })}
        confirmLabel={t('decision.confirmAccept')}
        onConfirm={() => void decide('accept')}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === 'decline'}
        tone="destructive"
        title={t('decision.declineTitle')}
        description={
          <span className="flex flex-col gap-4">
            <span>{t('decision.declineBody', { name: applicantName })}</span>
            <span className="flex flex-col gap-1.5">
              <label htmlFor={noteId} className="text-sm font-semibold text-text">
                {t('decision.noteLabel')}
              </label>
              <textarea
                id={noteId}
                name="note"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                placeholder={t('decision.notePlaceholder')}
                aria-describedby={`${noteId}-hint`}
                onChange={(event) => setNote(event.target.value)}
                className="block w-full resize-y rounded-lg border border-border-strong/50 bg-surface-raised px-3 py-2 text-sm leading-relaxed text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              <span id={`${noteId}-hint`} className="text-xs text-text-muted">
                {t('decision.noteHint')}
              </span>
            </span>
          </span>
        }
        confirmLabel={t('decision.confirmDecline')}
        onConfirm={() => void decide('decline')}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
