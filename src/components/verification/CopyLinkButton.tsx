'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from './parts';

export type CopyLinkButtonProps = { url: string };

type CopyState = 'idle' | 'copied' | 'manual';

const RESET_MS = 2500;

/** The public link in a read-only field with a copy button; falls back to selecting the text. */
export function CopyLinkButton({ url }: CopyLinkButtonProps) {
  const t = useTranslations('verify.panel');
  const [state, setState] = useState<CopyState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function show(next: CopyState) {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    if (next === 'copied') timer.current = setTimeout(() => setState('idle'), RESET_MS);
  }

  function selectText() {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }

  async function copy() {
    try {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        await clipboard.writeText(url);
        show('copied');
        return;
      }
    } catch {
      // Permission denied or insecure context: fall through to selecting the text.
    }
    selectText();
    show('manual');
  }

  const copied = state === 'copied';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-text-muted">
        {t('link')}
      </label>
      <div className="flex min-w-0 items-stretch gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          readOnly
          dir="ltr"
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text"
        />
        <button
          type="button"
          onClick={() => void copy()}
          data-state={state}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            copied
              ? 'border-tone-success-fg/40 bg-tone-success-bg text-tone-success-fg'
              : 'border-border bg-surface-raised text-text hover:border-primary hover:text-primary'
          }`}
        >
          {copied ? <Icon name="check" className="size-4" /> : null}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-text-muted">
        {state === 'copied' ? t('copied') : state === 'manual' ? t('copyManual') : ''}
      </p>
    </div>
  );
}
