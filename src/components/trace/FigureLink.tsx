import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

export type FigureSize = 'sm' | 'md' | 'lg' | 'xl';

export interface FigureLinkProps {
  href: string;
  children: ReactNode;
  /** Full accessible name, e.g. "Approved, PKR 4,692,717.65: view by branch". */
  label: string;
  size?: FigureSize;
}

// Sizes change typography only; xl is the page headline number.
const SIZE: Record<FigureSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl leading-tight',
  xl: 'text-[2rem] leading-none sm:text-[2.5rem]',
};

/** A figure that is also the way into the records behind it. */
export function FigureLink({ href, children, label, size = 'md' }: FigureLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`group inline-flex items-baseline gap-[0.3em] rounded-md font-semibold tabular-nums tracking-tight text-text decoration-primary/40 decoration-1 underline-offset-[0.2em] transition-colors hover:text-primary hover:underline focus-visible:text-primary ${SIZE[size]}`}
    >
      <bdi dir="ltr">{children}</bdi>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-[0.6em] shrink-0 self-center text-primary opacity-50 transition-[opacity,translate] group-hover:translate-x-[0.12em] group-hover:opacity-100 group-focus-visible:opacity-100 rtl:-scale-x-100 rtl:group-hover:-translate-x-[0.12em] motion-reduce:transition-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 3.5 10.5 8 6 12.5" />
      </svg>
    </Link>
  );
}
