import { useTranslations } from 'next-intl';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'pending';

// Full class strings so Tailwind can see them.
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-tone-neutral-bg text-tone-neutral-fg',
  info: 'bg-tone-info-bg text-tone-info-fg',
  success: 'bg-tone-success-bg text-tone-success-fg',
  warning: 'bg-tone-warning-bg text-tone-warning-fg',
  danger: 'bg-tone-danger-bg text-tone-danger-fg',
  pending: 'bg-tone-pending-bg text-tone-pending-fg',
};

export const STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  returned: 'warning',
  approved: 'success',
  pending: 'pending',
  accepted: 'success',
  declined: 'danger',
  active: 'success',
  inactive: 'neutral',
  forming: 'info',
  paused: 'warning',
  closed: 'neutral',
  published: 'success',
  voided: 'danger',
};

export type StatusBadgeProps = { status: string; label?: string };

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const t = useTranslations('common.status');
  const known = Object.hasOwn(STATUS_TONES, status);
  const tone: Tone = known ? (STATUS_TONES[status] ?? 'neutral') : 'neutral';
  const text = label ?? (known ? t(status) : status);

  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}
