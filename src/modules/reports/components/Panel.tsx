import { useId, type ReactNode } from 'react';

export interface PanelProps {
  title: string;
  description?: string;
  /** Right-aligned (start-aligned in RTL) extra next to the title. */
  aside?: ReactNode;
  children: ReactNode;
  /** Flush content (tables) instead of padded content. */
  flush?: boolean;
}

/** A titled card section; the heading labels the region. */
export function Panel({ title, description, aside, children, flush = false }: PanelProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-card border border-border bg-surface-raised shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-sm font-semibold text-text">
            {title}
          </h2>
          {description ? <p className="text-xs text-text-muted">{description}</p> : null}
        </div>
        {aside}
      </header>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}
