import type { ReactNode } from 'react';
import { Ltr, MoneyText } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { basisPoints, bpToPercent } from './ratio';

export type IdentityTone = 'success' | 'pending' | 'neutral' | 'info' | 'warning';

export interface IdentitySegment {
  key: string;
  label: ReactNode;
  amount: string;
  href?: string;
  tone: IdentityTone;
}

export type IdentityBarProps = { total: string; segments: IdentitySegment[]; caption: string };

// Full class strings so Tailwind can see them.
const FILL: Record<IdentityTone, string> = {
  success: 'bg-tone-success-fg',
  pending: 'bg-tone-pending-fg',
  neutral: 'bg-border-strong',
  info: 'bg-tone-info-fg',
  warning: 'bg-tone-warning-fg',
};

function LegendBody({ segment, share }: { segment: IdentitySegment; share: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`mt-[0.45em] size-2.5 shrink-0 rounded-[3px] ${FILL[segment.tone]}`}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-text-muted">{segment.label}</span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <MoneyText
            amount={segment.amount}
            className="text-base font-semibold text-text group-hover/legend:text-primary"
          />
          <Ltr className="tabular text-xs text-text-muted">{share}</Ltr>
        </span>
      </span>
    </>
  );
}

/** Proportional split of one figure. The legend carries every value as text and link. */
export function IdentityBar({ total, segments, caption }: IdentityBarProps) {
  const shares = segments.map((segment) => ({
    segment,
    bp: basisPoints(segment.amount, total),
  }));

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <figcaption className="text-xs font-medium tracking-wide text-text-muted">
        {caption}
      </figcaption>

      <div
        data-track
        aria-hidden="true"
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        {shares
          .filter(({ bp }) => bp > 0)
          .map(({ segment, bp }) => (
            <div
              key={segment.key}
              data-bar-segment={segment.key}
              data-bp={bp}
              className={`h-full min-w-1 ${FILL[segment.tone]}`}
              style={{ inlineSize: bpToPercent(bp) }}
            />
          ))}
      </div>

      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {shares.map(({ segment, bp }) => (
          <li key={segment.key} data-legend-segment={segment.key} className="min-w-0">
            {segment.href ? (
              <Link
                href={segment.href}
                className="-m-1.5 flex items-start gap-2.5 rounded-lg p-1.5 group/legend hover:bg-surface-sunken"
              >
                <LegendBody segment={segment} share={bpToPercent(bp)} />
              </Link>
            ) : (
              <div className="flex items-start gap-2.5">
                <LegendBody segment={segment} share={bpToPercent(bp)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </figure>
  );
}
