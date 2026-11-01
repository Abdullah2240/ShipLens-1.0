import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { CopyLinkButton } from './CopyLinkButton';
import { groupSeal, Icon, type VerifyLocale } from './parts';
import { Qr } from './Qr';

export type VerificationPanelProps = {
  /** Display form, 'XXXXX-XXXXX'. */
  code: string;
  /** Absolute public URL; the QR encodes exactly this. */
  url: string;
  seal: string | null;
  locale: VerifyLocale;
};

/** Report page card: code, QR, seal and the public link for an approved report. */
export function VerificationPanel({ code, url, seal, locale }: VerificationPanelProps) {
  const t = useTranslations('verify.panel');
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-locale={locale}
      className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card print:shadow-none"
    >
      <header className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-tone-success-bg text-tone-success-fg"
        >
          <Icon name="shieldCheck" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-base font-semibold text-text">
            {t('title')}
          </h2>
          <p className="text-sm text-text-muted">{t('intro')}</p>
        </div>
      </header>

      <div className="grid gap-6 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:px-6">
        <figure className="flex flex-col items-center gap-2 justify-self-center sm:justify-self-start">
          <div className="rounded-xl bg-white p-2 shadow-sm ring-1 ring-border">
            <Qr value={url} label={t('qrLabel')} size={168} />
          </div>
          <figcaption className="text-xs text-text-muted">{t('scan')}</figcaption>
        </figure>

        <div className="flex min-w-0 flex-col gap-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-medium text-text-muted">{t('code')}</dt>
              <dd className="text-2xl font-semibold tracking-wider text-text">
                <bdi dir="ltr" className="font-mono [unicode-bidi:isolate]">
                  {code}
                </bdi>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-medium text-text-muted">{t('seal')}</dt>
              <dd className="text-base font-medium text-text">
                {seal ? (
                  <bdi
                    dir="ltr"
                    data-seal
                    className="font-mono tracking-wide [unicode-bidi:isolate]"
                  >
                    {groupSeal(seal)}
                  </bdi>
                ) : (
                  <span className="text-text-muted">{t('sealNone')}</span>
                )}
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-text-muted">{t('sealHelp')}</p>

          <CopyLinkButton url={url} />

          <div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-hover print:hidden"
            >
              {t('open')}
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="size-4 rtl:-scale-x-100"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 8h9M8.5 4l4 4-4 4" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
