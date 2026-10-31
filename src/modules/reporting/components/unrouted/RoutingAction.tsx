'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useRouter } from '@/i18n/navigation';
import { markRouted, unmarkRouted, type RoutingErrorCode } from './routing-client';

type NoticeInput = { tone: 'success' | 'danger'; text: string };
type Notice = NoticeInput & { id: number };
type Announce = (notice: NoticeInput) => void;

const RoutingStatusContext = createContext<Announce | null>(null);

// Conflicts mean the list on screen is stale: refresh it so the row moves where it belongs.
const REFRESH_ON: ReadonlySet<RoutingErrorCode> = new Set([
  'already_routed',
  'not_routed',
  'not_approved',
  'not_found',
]);
const SUCCESS_VISIBLE_MS = 6000;

let noticeSeq = 0;

function useNotice(): [Notice | null, Announce, () => void] {
  const [notice, setNotice] = useState<Notice | null>(null);
  const announce = useCallback<Announce>((next) => {
    noticeSeq += 1;
    setNotice({ ...next, id: noticeSeq });
  }, []);
  const dismiss = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!notice || notice.tone !== 'success') return;
    const timer = setTimeout(
      () => setNotice((n) => (n?.id === notice.id ? null : n)),
      SUCCESS_VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [notice]);

  return [notice, announce, dismiss];
}

function NoticeCard({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const t = useTranslations('unrouted.toast');
  const success = notice.tone === 'success';
  return (
    <div
      data-tone={notice.tone}
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card border bg-surface-raised p-3.5 text-sm text-text shadow-card ${
        success ? 'border-tone-success-fg/30' : 'border-tone-danger-fg/40'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
          success
            ? 'bg-tone-success-bg text-tone-success-fg'
            : 'bg-tone-danger-bg text-tone-danger-fg'
        }`}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {success ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M8 4v5M8 11.75v.01" />}
        </svg>
      </span>
      <p className="min-w-0 flex-1 leading-relaxed">{notice.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('dismiss')}
        className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-sunken hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

/** Both live regions exist before anything is announced, so screen readers pick changes up. */
function NoticeRegion({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6 print:hidden">
      <div aria-live="polite" aria-atomic="true" className="contents">
        {notice?.tone === 'success' ? (
          <NoticeCard key={notice.id} notice={notice} onDismiss={onDismiss} />
        ) : null}
      </div>
      <div role="alert" aria-atomic="true" className="contents">
        {notice?.tone === 'danger' ? (
          <NoticeCard key={notice.id} notice={notice} onDismiss={onDismiss} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Holds routing announcements for a whole list, so the message stays on screen after the
 * row that raised it leaves the list.
 */
export function RoutingStatusProvider({ children }: { children: ReactNode }) {
  const [notice, announce, dismiss] = useNotice();
  return (
    <RoutingStatusContext.Provider value={announce}>
      {children}
      <NoticeRegion notice={notice} onDismiss={dismiss} />
    </RoutingStatusContext.Provider>
  );
}

export interface RoutingActionProps {
  collectionId: string;
  mode: 'mark' | 'undo';
  /** Human summary of the collection, e.g. "BR002, 12 Oct 2026, PKR 12,500.00". */
  summary: string;
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 motion-safe:animate-spin"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const secondaryButton =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm font-semibold text-text shadow-xs transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:border-border disabled:text-text-muted disabled:shadow-none';
const textButton =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm font-semibold text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline';

/** Mark a collection as sent to the main account, or undo that, after a confirmation. */
export function RoutingAction({ collectionId, mode, summary }: RoutingActionProps) {
  const t = useTranslations('unrouted');
  const router = useRouter();
  const shared = useContext(RoutingStatusContext);
  const [localNotice, localAnnounce, localDismiss] = useNotice();
  const announce = shared ?? localAnnounce;

  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const inFlight = useRef(false);

  const mark = mode === 'mark';
  const busy = sending || refreshing;

  async function onConfirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpen(false);
    setSending(true);
    const result = await (mark ? markRouted : unmarkRouted)(collectionId);
    setSending(false);
    if (result.ok) {
      // The row leaves this list on refresh; until then it must not be sent again.
      setDone(true);
      announce({ tone: 'success', text: t(mark ? 'toast.marked' : 'toast.undone', { summary }) });
      startTransition(() => router.refresh());
      return;
    }
    inFlight.current = false;
    announce({ tone: 'danger', text: t(`errors.${result.code}`) });
    if (REFRESH_ON.has(result.code)) startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        data-variant={mark ? 'secondary' : 'text'}
        aria-label={t(mark ? 'actions.markFor' : 'actions.undoFor', { summary })}
        aria-busy={busy || undefined}
        disabled={busy || done}
        onClick={() => {
          if (!inFlight.current) setOpen(true);
        }}
        className={mark ? secondaryButton : textButton}
      >
        {sending ? <Spinner /> : null}
        {sending
          ? t(mark ? 'actions.marking' : 'actions.undoing')
          : t(mark ? 'actions.mark' : 'actions.undo')}
      </button>
      <ConfirmDialog
        open={open}
        title={t(mark ? 'actions.confirmMarkTitle' : 'actions.confirmUndoTitle')}
        description={t(mark ? 'actions.confirmMarkBody' : 'actions.confirmUndoBody', { summary })}
        confirmLabel={t(mark ? 'actions.confirmMark' : 'actions.confirmUndo')}
        onConfirm={() => void onConfirm()}
        onCancel={() => setOpen(false)}
      />
      {shared ? null : <NoticeRegion notice={localNotice} onDismiss={localDismiss} />}
    </>
  );
}
