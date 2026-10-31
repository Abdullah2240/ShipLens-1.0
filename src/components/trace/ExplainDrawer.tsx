'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { formatDateTime, formatInt } from '@/platform/i18n/format';
import { FilterChips, type ExplainFilterChip } from './TraceHeader';

export interface ExplainIdentity {
  left: ReactNode; // logical-css-ignore: identity operand, not a CSS property
  right: ReactNode; // logical-css-ignore: identity operand, not a CSS property
  holds: boolean;
}

export interface ExplainDrawerProps {
  /** Figure id with copy under `trace.figures.<id>`, e.g. 'approved'. */
  figure: string;
  value: ReactNode;
  recordCount: number;
  /** ISO instant the figure was read at. */
  asOf: string;
  filters: ExplainFilterChip[];
  identities?: ExplainIdentity[];
  triggerLabel?: string;
  triggerVariant?: 'icon' | 'text';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function InfoGlyph({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-current font-serif leading-none font-semibold italic ${className}`}
    >
      i
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-[0.08em] text-text-muted uppercase rtl:tracking-normal">
        {title}
      </h3>
      {children}
    </section>
  );
}

function formatAsOf(asOf: string, locale: Locale): string {
  try {
    return formatDateTime(new Date(asOf), locale);
  } catch {
    return asOf;
  }
}

/** "How is this calculated": the definition, scope and provenance of one figure. */
export function ExplainDrawer({
  figure,
  value,
  recordCount,
  asOf,
  filters,
  identities,
  triggerLabel,
  triggerVariant = 'text',
}: ExplainDrawerProps) {
  const t = useTranslations('trace');
  const locale = useLocale() as Locale;
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const copy = (part: string) => {
    const key = `figures.${figure}.${part}`;
    return t.has(key) ? t(key) : null;
  };
  const figureLabel = copy('label') ?? figure;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      wasOpen.current = true;
      headingRef.current?.focus();
    } else {
      if (dialog.open) dialog.close();
      if (wasOpen.current) {
        wasOpen.current = false;
        triggerRef.current?.focus();
      }
    }
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && focusables.includes(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  const openLabel = triggerLabel ?? t('explain.open');
  const definition = copy('definition');
  const includes = copy('includes');
  const excludes = copy('excludes');

  return (
    <>
      {triggerVariant === 'icon' ? (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-label={triggerLabel ?? t('explain.openFor', { figure: figureLabel })}
          onClick={() => setOpen(true)}
          className="inline-flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-sunken hover:text-primary"
        >
          <InfoGlyph className="size-4 text-[0.625rem]" />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary-hover hover:underline"
        >
          <InfoGlyph className="size-4 text-[0.625rem]" />
          {openLabel}
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className={[
          // Phones: a bottom sheet.
          'fixed inset-x-0 top-auto bottom-0 m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-hidden',
          'rounded-t-2xl border-0 border-t border-border bg-surface-raised p-0 text-text shadow-card',
          'backdrop:bg-surface-sunken/70 backdrop:backdrop-blur-[2px]',
          // Wide screens: a sheet on the inline-end side, full height.
          'sm:inset-y-0 sm:start-auto sm:end-0 sm:h-dvh sm:max-h-dvh sm:w-[28rem] sm:max-w-[calc(100vw-2rem)]',
          'sm:rounded-none sm:rounded-s-2xl sm:border-t-0 sm:border-s',
          // Enter from the bottom on phones, from the inline end on wide screens.
          'transition-[translate] duration-300 ease-out motion-reduce:transition-none',
          'starting:open:translate-y-full sm:starting:open:translate-y-0',
          'sm:starting:open:translate-x-full sm:rtl:starting:open:-translate-x-full',
        ].join(' ')}
      >
        <div className="flex h-full max-h-[inherit] flex-col">
          <span
            aria-hidden="true"
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden"
          />
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 pt-4 pb-4 sm:pt-6">
            <h2
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              className="flex min-w-0 flex-col gap-1 rounded-md outline-offset-4"
            >
              <span className="text-xs font-semibold tracking-[0.14em] text-accent uppercase rtl:tracking-normal">
                {t('explain.title')}
              </span>
              <span className="text-lg leading-snug font-semibold text-text">{figureLabel}</span>
            </h2>
            <button
              type="button"
              aria-label={t('explain.close')}
              onClick={() => setOpen(false)}
              className="-me-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-sunken hover:text-text"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-6">
            <div className="rounded-card border border-border bg-surface-sunken/60 px-5 py-4">
              <p className="text-xs text-text-muted">{t('explain.value')}</p>
              <p className="mt-1 text-[1.75rem] leading-tight font-semibold tabular-nums tracking-tight text-text">
                <bdi dir="ltr">{value}</bdi>
              </p>
            </div>

            {definition ? (
              <Section title={t('explain.definition')}>
                <p className="text-sm leading-relaxed text-text">{definition}</p>
              </Section>
            ) : null}

            {includes || excludes ? (
              <div className="grid gap-3">
                {includes ? (
                  <Section title={t('explain.includes')}>
                    <p className="flex gap-2 text-sm text-text">
                      <span aria-hidden="true" className="font-semibold text-tone-success-fg">
                        +
                      </span>
                      <span>{includes}</span>
                    </p>
                  </Section>
                ) : null}
                {excludes ? (
                  <Section title={t('explain.excludes')}>
                    <p className="flex gap-2 text-sm text-text">
                      <span aria-hidden="true" className="font-semibold text-tone-danger-fg">
                        −
                      </span>
                      <span>{excludes}</span>
                    </p>
                  </Section>
                ) : null}
              </div>
            ) : null}

            <Section title={t('explain.filters')}>
              {filters.length > 0 ? (
                <FilterChips chips={filters} label={t('explain.filters')} />
              ) : (
                <p className="text-sm text-text-muted">{t('explain.allTime')}</p>
              )}
            </Section>

            <dl className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-text-muted">{t('explain.recordCount')}</dt>
                <dd className="text-sm font-semibold tabular-nums text-text">
                  <bdi dir="ltr">{formatInt(recordCount, locale)}</bdi>
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-text-muted">{t('explain.asOf')}</dt>
                <dd className="text-sm font-semibold tabular-nums text-text">
                  <time dateTime={asOf}>
                    <bdi>{formatAsOf(asOf, locale)}</bdi>{' '}
                    <span className="font-normal text-text-muted">{t('explain.timezone')}</span>
                  </time>
                </dd>
              </div>
            </dl>

            {identities && identities.length > 0 ? (
              <Section title={t('explain.identities')}>
                <ul className="flex flex-col gap-2">
                  {identities.map((identity, index) => (
                    <li
                      key={index}
                      data-holds={String(identity.holds)}
                      className="flex flex-col gap-2 rounded-lg border border-border px-3.5 py-3"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm tabular-nums text-text">
                        <span>{identity.left}</span>
                        <span className="text-text-muted">=</span>
                        <span>{identity.right}</span>
                      </span>
                      <span
                        data-tone={identity.holds ? 'success' : 'danger'}
                        className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          identity.holds
                            ? 'bg-tone-success-bg text-tone-success-fg'
                            : 'bg-tone-danger-bg text-tone-danger-fg'
                        }`}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                          className="size-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {identity.holds ? (
                            <path d="m3.5 8.5 3 3 6-7" />
                          ) : (
                            <path d="M8 4v5M8 11.75v.01" />
                          )}
                        </svg>
                        {identity.holds ? t('explain.holds') : t('explain.broken')}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>

          <div className="flex justify-end border-t border-border bg-surface-sunken px-6 py-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border-strong/60 px-4 py-2 text-sm font-semibold text-text transition-colors hover:bg-surface"
            >
              {t('explain.close')}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
