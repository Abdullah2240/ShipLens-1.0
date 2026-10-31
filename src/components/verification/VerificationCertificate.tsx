import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { formatInt, formatMoney } from '@/platform/i18n/format';
import {
  dateText,
  dateTimeText,
  displayCode,
  groupSeal,
  Icon,
  ltr,
  type VerifyLocale,
} from './parts';

export type CertificateIntegrity = 'verified' | 'mismatch' | 'unanchored' | 'chain_broken';

/** Public verification result; structurally the same as the service's public result. */
export type VerificationCertificateResult = {
  code: string;
  branch: { name: string; city: string | null };
  weekStart: string;
  weekEnd: string;
  approvedTotal: string;
  collectionCount: number | null;
  approvedOn: string | null;
  integrity: CertificateIntegrity;
  anchor: { chainSeq: number; seal: string } | null;
  sealCheck: 'match' | 'mismatch' | 'not_provided';
  chain: {
    status: 'empty' | 'intact' | 'broken';
    checkedEvents: number;
    brokenAtSeq: number | null;
    checkedAt: string;
  };
};

export type VerificationCertificateProps = {
  result: VerificationCertificateResult;
  locale: VerifyLocale;
  /** Heading level of the headline; 1 when the certificate is the page's main content. */
  headingLevel?: 1 | 2;
};

type ToneName = 'success' | 'warning' | 'danger' | 'neutral';

// Full class strings so Tailwind can see them.
const TONES: Record<
  ToneName,
  { band: string; badge: string; motif: string; dot: string; text: string }
> = {
  success: {
    band: 'bg-tone-success-fg',
    badge: 'bg-tone-success-bg text-tone-success-fg ring-tone-success-fg/20',
    motif: 'text-tone-success-fg',
    dot: 'bg-tone-success-bg text-tone-success-fg ring-tone-success-fg/30',
    text: 'text-tone-success-fg',
  },
  warning: {
    band: 'bg-tone-warning-fg',
    badge: 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-fg/20',
    motif: 'text-tone-warning-fg',
    dot: 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-fg/30',
    text: 'text-tone-warning-fg',
  },
  danger: {
    band: 'bg-tone-danger-fg',
    badge: 'bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-fg/20',
    motif: 'text-tone-danger-fg',
    dot: 'bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-fg/30',
    text: 'text-tone-danger-fg',
  },
  neutral: {
    band: 'bg-border-strong',
    badge: 'bg-tone-neutral-bg text-tone-neutral-fg ring-border',
    motif: 'text-text-muted',
    dot: 'bg-tone-neutral-bg text-tone-neutral-fg ring-border',
    text: 'text-text-muted',
  },
};

const INTEGRITY: Record<
  CertificateIntegrity,
  { tone: ToneName; icon: 'shieldCheck' | 'shieldX' | 'shieldAlert' | 'linkBroken' }
> = {
  verified: { tone: 'success', icon: 'shieldCheck' },
  mismatch: { tone: 'danger', icon: 'shieldX' },
  unanchored: { tone: 'warning', icon: 'shieldAlert' },
  chain_broken: { tone: 'danger', icon: 'linkBroken' },
};

// Printing in dark mode would put light text on white paper: the light palette is
// restored for the certificate's subtree when printing.
const PRINT_LIGHT = [
  'print:[--color-text:#2b2420]',
  'print:[--color-text-muted:#65594e]',
  'print:[--color-surface:#ffffff]',
  'print:[--color-surface-raised:#ffffff]',
  'print:[--color-surface-sunken:#f7f3ec]',
  'print:[--color-border:#d9cdb9]',
  'print:[--color-border-strong:#8a7c6b]',
  'print:[--color-accent:#a8430c]',
  'print:[--color-tone-success-bg:#d9eedc]',
  'print:[--color-tone-success-fg:#1b5e2f]',
  'print:[--color-tone-warning-bg:#fbe9c4]',
  'print:[--color-tone-warning-fg:#774700]',
  'print:[--color-tone-danger-bg:#f9dcd6]',
  'print:[--color-tone-danger-fg:#9a2a18]',
  'print:[--color-tone-neutral-bg:#ece5d9]',
  'print:[--color-tone-neutral-fg:#4a4036]',
  'print:shadow-none',
  'print:break-inside-avoid',
].join(' ');

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium tracking-wide text-text-muted uppercase rtl:tracking-normal rtl:normal-case">
        {label}
      </dt>
      <dd className="text-base font-medium text-text">{children}</dd>
    </div>
  );
}

type Step = { key: string; title: string; detail: ReactNode; tone: ToneName; done: boolean };

/** The public "proof" card for one approved weekly report. Renders listed fields only. */
export function VerificationCertificate({
  result,
  locale,
  headingLevel = 2,
}: VerificationCertificateProps) {
  const t = useTranslations('verify.result');
  const headingId = useId();
  const trailId = useId();
  const dir = locale === 'ur' ? 'rtl' : 'ltr';
  const look = INTEGRITY[result.integrity];
  const tone = TONES[look.tone];
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const SubHeading = headingLevel === 1 ? 'h2' : 'h3';

  const { chain, anchor } = result;
  const checkedTime = dateTimeText(chain.checkedAt, locale);
  const chainLine =
    chain.status === 'intact'
      ? t.rich('chain.intact', { count: formatInt(chain.checkedEvents, locale), ltr })
      : chain.status === 'broken'
        ? t.rich('chain.broken', { seq: String(chain.brokenAtSeq ?? '?'), ltr })
        : t('chain.empty');

  const steps: Step[] = [
    {
      key: 'approved',
      title: t('trail.approved'),
      detail: result.approvedOn ? (
        <bdi dir="ltr" className="tabular [unicode-bidi:isolate]">
          {dateText(result.approvedOn, locale)}
        </bdi>
      ) : (
        t('notRecorded')
      ),
      tone: result.approvedOn ? 'success' : 'neutral',
      done: Boolean(result.approvedOn),
    },
    {
      key: 'recorded',
      title: t('trail.recorded'),
      detail: anchor ? t.rich('anchor', { seq: String(anchor.chainSeq), ltr }) : t('anchorMissing'),
      tone: anchor ? 'success' : 'warning',
      done: Boolean(anchor),
    },
    {
      key: 'checked',
      title: t('trail.checked'),
      detail: (
        <>
          {chainLine}
          <span className="block">{t.rich('checkedAt', { time: checkedTime, ltr })}</span>
        </>
      ),
      tone:
        chain.status === 'intact' ? 'success' : chain.status === 'broken' ? 'danger' : 'neutral',
      done: chain.status === 'intact',
    },
  ];

  return (
    <article
      dir={dir}
      lang={locale}
      aria-labelledby={headingId}
      data-integrity={result.integrity}
      data-seal-check={result.sealCheck}
      className={`relative isolate overflow-hidden rounded-card border border-border bg-surface-raised text-text shadow-card ${PRINT_LIGHT}`}
    >
      <div aria-hidden="true" className={`h-1.5 ${tone.band}`} />

      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -end-24 -top-24 -z-10 size-72 rounded-full border-[18px] border-double border-current opacity-[0.07] ${tone.motif}`}
      >
        <div className="absolute inset-7 rounded-full border-2 border-dashed border-current" />
        <div className="absolute inset-16 rounded-full border border-current" />
      </div>

      <header className="flex flex-col gap-6 px-6 pt-7 sm:px-10 sm:pt-9">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase rtl:tracking-normal">
            {t('eyebrow')}
          </p>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs">
            <span className="text-text-muted">{t('code')}</span>
            <bdi
              dir="ltr"
              data-code
              className="font-mono font-semibold tracking-wider text-text [unicode-bidi:isolate]"
            >
              {displayCode(result.code)}
            </bdi>
          </p>
        </div>

        <div className="flex items-start gap-4">
          <span
            className={`grid size-12 shrink-0 place-items-center rounded-full ring-4 ${tone.badge}`}
          >
            <Icon name={look.icon} className="size-6" />
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <Heading
              id={headingId}
              className="font-display-ur text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl rtl:tracking-normal"
            >
              {t(`integrity.${result.integrity}`)}
            </Heading>
            <p className="max-w-prose text-sm leading-6 text-text-muted sm:text-base">
              {t(`integrityDetail.${result.integrity}`)}
            </p>
          </div>
        </div>
      </header>

      {result.sealCheck === 'mismatch' ? (
        <div
          data-seal-warning
          className="mx-6 mt-6 flex items-start gap-3 rounded-xl border-2 border-tone-danger-fg/50 bg-tone-danger-bg px-4 py-3 text-tone-danger-fg sm:mx-10"
        >
          <Icon name="shieldX" className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">{t('sealMismatchTitle')}</p>
            <p className="text-sm">{t('sealCheck.mismatch')}</p>
          </div>
        </div>
      ) : null}

      <section className="mx-6 mt-7 rounded-xl border border-border bg-surface-sunken px-5 py-5 sm:mx-10 sm:px-6">
        <p className="text-sm font-medium text-text-muted">{t('approvedTotal')}</p>
        <p
          data-total
          className="mt-1 text-4xl leading-tight font-semibold tracking-tight text-text sm:text-5xl"
        >
          <bdi dir="ltr" className="tabular whitespace-nowrap [unicode-bidi:isolate]">
            {formatMoney(result.approvedTotal, locale)}
          </bdi>
        </p>
        <p className="mt-2 text-sm text-text-muted">
          {t.rich('week', {
            start: dateText(result.weekStart, locale),
            end: dateText(result.weekEnd, locale),
            ltr,
          })}
        </p>
      </section>

      <dl className="grid gap-x-8 gap-y-5 px-6 pt-6 sm:grid-cols-3 sm:px-10">
        <Fact label={t('branch')}>
          <bdi>{result.branch.name}</bdi>
          {result.branch.city ? (
            <span className="block text-sm font-normal text-text-muted">
              <bdi>{result.branch.city}</bdi>
            </span>
          ) : null}
        </Fact>
        <Fact label={t('collections')}>
          {result.collectionCount === null ? (
            <span className="text-text-muted">{t('notRecorded')}</span>
          ) : (
            <bdi dir="ltr" className="tabular [unicode-bidi:isolate]">
              {formatInt(result.collectionCount, locale)}
            </bdi>
          )}
        </Fact>
        <Fact label={t('approvedOn')}>
          {result.approvedOn ? (
            <bdi dir="ltr" className="tabular [unicode-bidi:isolate]">
              {dateText(result.approvedOn, locale)}
            </bdi>
          ) : (
            <span className="text-text-muted">{t('notRecorded')}</span>
          )}
        </Fact>
      </dl>

      <section aria-labelledby={trailId} className="px-6 pt-8 sm:px-10">
        <SubHeading
          id={trailId}
          className="text-xs font-semibold tracking-wide text-text-muted uppercase rtl:tracking-normal rtl:normal-case"
        >
          {t('trail.label')}
        </SubHeading>
        <ol className="mt-4 grid gap-5 sm:grid-cols-3 sm:gap-4">
          {steps.map((step, index) => (
            <li
              key={step.key}
              data-step={step.key}
              data-done={step.done}
              className={`relative flex gap-3 sm:flex-col ${
                index < steps.length - 1
                  ? "after:absolute after:start-4 after:top-10 after:-bottom-4 after:w-px after:bg-border after:content-[''] sm:after:start-11 sm:after:-end-3 sm:after:top-4 sm:after:bottom-auto sm:after:h-px sm:after:w-auto"
                  : ''
              }`}
            >
              <span
                className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ${TONES[step.tone].dot}`}
              >
                {step.done ? (
                  <Icon name="check" className="size-4" />
                ) : (
                  <bdi dir="ltr" aria-hidden="true">
                    {index + 1}
                  </bdi>
                )}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm font-semibold text-text">{step.title}</p>
                <p
                  className={`text-sm leading-6 ${step.done ? 'text-text-muted' : TONES[step.tone].text}`}
                >
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {anchor ? (
        <div className="mx-6 mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-dashed border-border pt-5 sm:mx-10">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-medium tracking-wide text-text-muted uppercase rtl:tracking-normal rtl:normal-case">
              {t('seal')}
            </span>
            <bdi
              dir="ltr"
              data-seal
              className="font-mono text-sm font-semibold tracking-wide text-text [unicode-bidi:isolate]"
            >
              {groupSeal(anchor.seal)}
            </bdi>
          </p>
          {result.sealCheck === 'match' ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-tone-success-fg">
              <Icon name="check" className="size-4 shrink-0" />
              {t('sealCheck.match')}
            </p>
          ) : null}
        </div>
      ) : null}

      <footer className="mt-8 flex flex-col gap-4 border-t border-border bg-surface-sunken px-6 py-6 sm:px-10">
        <div className="flex flex-col gap-1">
          <SubHeading className="text-sm font-semibold text-text">
            {t('howItWorksTitle')}
          </SubHeading>
          <p className="max-w-prose text-sm leading-6 text-text-muted">{t('howItWorks')}</p>
        </div>
        <p className="flex items-center gap-2 text-sm font-medium text-text">
          <Icon name="lock" className="size-4 shrink-0 text-primary" />
          {t('privacy')}
        </p>
      </footer>
    </article>
  );
}
