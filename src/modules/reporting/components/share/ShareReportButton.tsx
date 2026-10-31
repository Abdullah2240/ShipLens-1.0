'use client';

import { useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { dirFor, type Locale } from '@/i18n/routing';
import { formatDate, formatInt, formatMoney } from '@/platform/i18n/format';
import {
  buildShareText,
  whatsappUrl,
  type ReportShareSummary,
  type Translate,
} from '../../share-text';

export interface ShareReportButtonProps {
  reportId: string;
}

type ShareError = 'forbidden' | 'not_found' | 'network';

const errorFor = (status: number): ShareError =>
  status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'network';

function isShareReply(value: unknown): value is { summary: ReportShareSummary; link: string } {
  const data = value as { summary?: unknown; link?: unknown } | null;
  return (
    typeof data?.link === 'string' &&
    typeof data.summary === 'object' &&
    data.summary !== null &&
    typeof (data.summary as { amount?: unknown }).amount === 'string'
  );
}

const button =
  'inline-flex h-11 w-full min-w-0 items-center justify-center gap-2 rounded-lg border border-border-strong/60 bg-surface-raised px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 lg:h-10';

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

/** A plain chat bubble with an outgoing arrow: no messaging brand's logo. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4 shrink-0 text-primary rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon="share"
    >
      <path d="M17 9.5a6.5 6.5 0 01-9.6 5.7L3 16.5l1.3-4A6.5 6.5 0 1117 9.5z" />
      <path d="M8 10.5l4-4M8.75 6.5H12v3.25" />
    </svg>
  );
}

/**
 * Shares the report's summary to WhatsApp (WA-01): POSTs the share endpoint (audited, scoped
 * to the lead's own branch), builds the localized message and opens wa.me with it. No chat
 * or phone number is chosen here; WhatsApp asks the user.
 */
export function ShareReportButton({ reportId }: ShareReportButtonProps) {
  const t = useTranslations('share');
  const common = useTranslations('common');
  const locale: Locale = useLocale() === 'ur' ? 'ur' : 'en';
  const hintId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ShareError | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function share() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setOpened(null);
    try {
      const response = await fetch(`/api/v1/reports/${encodeURIComponent(reportId)}/share`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) {
        setError(errorFor(response.status));
        return;
      }
      const json = (await response.json().catch(() => null)) as { data?: unknown } | null;
      if (!isShareReply(json?.data)) {
        setError('network');
        return;
      }
      const { summary, link } = json.data;
      const text = buildShareText(
        t as unknown as Translate,
        summary,
        link,
        {
          amount: formatMoney(summary.amount, locale),
          weekStart: formatDate(summary.weekStart, locale),
          weekEnd: formatDate(summary.weekEnd, locale),
          status: common(`status.${summary.status}`),
          count: formatInt(summary.collectionCount, locale),
        },
        { isolate: dirFor(locale) === 'rtl' },
      );
      const url = whatsappUrl(text);
      window.open(url, '_blank', 'noopener');
      setOpened(url);
    } catch {
      setError('network');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 basis-full flex-col gap-2" data-testid="share-report">
      <button
        type="button"
        onClick={() => void share()}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-describedby={hintId}
        className={button}
      >
        {pending ? <Spinner /> : <ShareIcon />}
        <span className="truncate">{pending ? t('sharing') : t('button')}</span>
      </button>
      <p id={hintId} className="sr-only text-xs leading-relaxed text-text-muted lg:not-sr-only">
        {t('buttonHint')}
      </p>
      <div role="alert">
        {error ? (
          <p
            data-share-error={error}
            className="rounded-lg border border-tone-warning-fg/35 bg-tone-warning-bg px-3 py-2 text-sm text-text"
          >
            {t(`errors.${error}`)}
          </p>
        ) : null}
      </div>
      <div role="status">
        {opened ? (
          <p className="text-xs leading-relaxed text-text-muted">
            {t('opened')}{' '}
            <a
              href={opened}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('openAgain')}
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
