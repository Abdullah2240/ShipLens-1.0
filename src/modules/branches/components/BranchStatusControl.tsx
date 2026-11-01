'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog, StatusBadge } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { isBranchReadOnly } from '@/modules/branches/capabilities';
import { BRANCH_TRANSITIONS } from '@/modules/branches/transitions';
import type { BranchDetail, BranchStatus } from '@/modules/branches/types';
import {
  CheckIcon,
  ErrorNote,
  Panel,
  Spinner,
  dangerButton,
  errorKey,
  secondaryButton,
  sendJson,
  type ErrorKey,
} from './form-kit';

const STEPS: readonly BranchStatus[] = ['forming', 'active', 'paused', 'closed'];

/** Moves that change what the branch may do, so they are confirmed first. */
const CONFIRMED: Partial<Record<BranchStatus, 'Close' | 'Pause'>> = {
  closed: 'Close',
  paused: 'Pause',
};

type Feedback = { kind: 'moved'; status: BranchStatus } | { kind: 'error'; key: ErrorKey };
type State = { status: BranchStatus; allowed: readonly BranchStatus[] };

function detailFrom(data: unknown): BranchDetail | null {
  return data && typeof data === 'object' && 'status' in data && 'allowedTransitions' in data
    ? (data as BranchDetail)
    : null;
}

export interface BranchStatusControlProps {
  branchId: string;
  status: BranchStatus;
  allowedTransitions: readonly BranchStatus[];
  canTransition: boolean;
  /** Branch name, quoted in the confirmation text. */
  name: string;
}

export function BranchStatusControl({
  branchId,
  status,
  allowedTransitions,
  canTransition,
  name,
}: BranchStatusControlProps) {
  const t = useTranslations('branches');
  const statusLabel = useTranslations('common.status');
  const router = useRouter();
  const id = useId();

  const [view, setView] = useState<State>({ status, allowed: allowedTransitions });
  const [previous, setPrevious] = useState({ status, allowedTransitions });
  if (status !== previous.status || allowedTransitions !== previous.allowedTransitions) {
    setPrevious({ status, allowedTransitions });
    setView({ status, allowed: allowedTransitions });
  }

  const [confirming, setConfirming] = useState<BranchStatus | null>(null);
  const [pending, setPending] = useState<BranchStatus | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inFlight = useRef(false);

  const closed = isBranchReadOnly(view.status);
  const moves = canTransition && !closed ? view.allowed : [];
  const currentIndex = STEPS.indexOf(view.status);

  async function move(to: BranchStatus) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(to);
    setFeedback(null);
    const reply = await sendJson('POST', `/api/v1/branches/${branchId}/status`, { to });
    if (reply.ok) {
      const next = detailFrom(reply.data);
      setView(
        next
          ? { status: next.status, allowed: next.allowedTransitions }
          : { status: to, allowed: BRANCH_TRANSITIONS[to] },
      );
      setFeedback({ kind: 'moved', status: next?.status ?? to });
      router.refresh();
    } else {
      setFeedback({ kind: 'error', key: errorKey(reply.code) });
      // The status changed elsewhere: fetch the latest state behind the message.
      if (reply.code === 'invalid_transition') router.refresh();
    }
    setPending(null);
    inFlight.current = false;
  }

  function request(to: BranchStatus) {
    if (CONFIRMED[to]) setConfirming(to);
    else void move(to);
  }

  const confirmKind = confirming ? CONFIRMED[confirming] : undefined;

  return (
    <Panel
      title={t('detail.lifecycle')}
      id={`${id}-title`}
      aside={<StatusBadge status={view.status} />}
    >
      <div className="flex flex-col gap-5">
        <ol aria-label={t('status.current')} className="grid grid-cols-4 gap-1.5">
          {STEPS.map((step, index) => {
            const current = step === view.status;
            const passed = !current && index < currentIndex && step !== 'paused';
            return (
              <li
                key={step}
                aria-current={current ? 'step' : undefined}
                className="flex min-w-0 flex-col gap-2"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 rounded-full ${
                    current
                      ? step === 'closed'
                        ? 'bg-text-muted'
                        : 'bg-primary'
                      : passed
                        ? 'bg-primary/35'
                        : 'bg-border'
                  }`}
                />
                <span
                  className={`flex min-w-0 items-center gap-1 truncate text-xs ${
                    current ? 'font-semibold text-text' : 'text-text-muted'
                  }`}
                >
                  {passed ? (
                    <span aria-hidden="true" className="text-primary">
                      <CheckIcon />
                    </span>
                  ) : null}
                  {statusLabel(step)}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-sm leading-relaxed text-text-muted">{t(`statusHelp.${view.status}`)}</p>

        {moves.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            {moves.map((to) => (
              <button
                key={to}
                type="button"
                disabled={pending !== null}
                onClick={() => request(to)}
                className={to === 'closed' ? dangerButton : secondaryButton}
              >
                {pending === to ? <Spinner /> : null}
                {t('status.moveTo', { status: statusLabel(to) })}
              </button>
            ))}
          </div>
        ) : closed ? (
          <p className="border-t border-border pt-5 text-sm text-text-muted">
            {t('status.noMoves')}
          </p>
        ) : null}

        {feedback?.kind === 'error' ? <ErrorNote>{t(`errors.${feedback.key}`)}</ErrorNote> : null}
        <p role="status" className="text-sm empty:hidden">
          {feedback?.kind === 'moved' ? (
            <span className="inline-flex items-center gap-2 font-medium text-tone-success-fg">
              <CheckIcon />
              {t('status.moved', { status: statusLabel(feedback.status) })}
            </span>
          ) : null}
        </p>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirmKind ? t(`status.confirm${confirmKind}Title`) : ''}
        description={confirmKind ? t(`status.confirm${confirmKind}Body`, { name }) : undefined}
        confirmLabel={confirmKind ? t(`status.confirm${confirmKind}Action`) : undefined}
        tone={confirming === 'closed' ? 'destructive' : 'default'}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const to = confirming;
          setConfirming(null);
          if (to) void move(to);
        }}
      />
    </Panel>
  );
}
