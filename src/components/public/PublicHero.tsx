import type { ReactNode } from 'react';

export type HeroMotif = 'network' | 'calendar';

export interface PublicHeroProps {
  /** Small pill above the heading, for example the page's navigation label. */
  eyebrow: string;
  title: string;
  lead: string;
  motif: HeroMotif;
  /** Tailwind max width of the content column, matching the page body below. */
  width?: 'max-w-3xl' | 'max-w-6xl';
  children?: ReactNode;
}

function Motif({ motif }: { motif: HeroMotif }) {
  const className =
    'pointer-events-none absolute -bottom-32 end-[-6rem] hidden size-[28rem] text-accent/25 md:block';
  if (motif === 'network') {
    // Neighbourhood branches joined into one network.
    const nodes = [
      [90, 120],
      [200, 70],
      [310, 140],
      [140, 240],
      [260, 260],
      [200, 350],
      [340, 300],
    ] as const;
    const links = [
      [0, 1],
      [1, 2],
      [0, 3],
      [1, 3],
      [1, 4],
      [2, 4],
      [3, 4],
      [3, 5],
      [4, 5],
      [4, 6],
      [2, 6],
    ] as const;
    return (
      <svg aria-hidden="true" viewBox="0 0 400 400" fill="none" className={className}>
        {links.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={nodes[a][0]}
            y1={nodes[a][1]}
            x2={nodes[b][0]}
            y2={nodes[b][1]}
            stroke="currentColor"
            strokeWidth="1.4"
          />
        ))}
        {nodes.map(([cx, cy], index) => (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={index === 4 ? 14 : 8}
            fill="currentColor"
            className={index === 4 ? 'text-accent/60' : undefined}
          />
        ))}
      </svg>
    );
  }
  // A month grid with a few days marked.
  const marked = new Set([9, 17, 23]);
  return (
    <svg aria-hidden="true" viewBox="0 0 400 400" fill="none" className={className}>
      {Array.from({ length: 35 }, (_, index) => {
        const x = 30 + (index % 7) * 50;
        const y = 50 + Math.floor(index / 7) * 62;
        return marked.has(index) ? (
          <rect key={index} x={x} y={y} width="36" height="36" rx="9" fill="currentColor" />
        ) : (
          <rect
            key={index}
            x={x + 1}
            y={y + 1}
            width="34"
            height="34"
            rx="9"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        );
      })}
    </svg>
  );
}

/** The warm hero band shared by the public list pages, in the Home page's visual language. */
export function PublicHero({
  eyebrow,
  title,
  lead,
  motif,
  width = 'max-w-6xl',
  children,
}: PublicHeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-border bg-linear-to-b from-accent-soft/70 to-surface">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 end-[-6rem] size-80 rounded-full bg-primary/10 blur-3xl"
      />
      <Motif motif={motif} />
      <div className={`relative mx-auto w-full ${width} px-4 py-14 md:px-6 md:py-20`}>
        <div className="flex max-w-3xl flex-col gap-5">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-surface-raised px-3 py-1 text-sm font-semibold text-accent">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            {eyebrow}
          </p>
          <h1 className="font-display-ur text-4xl font-bold tracking-tight text-balance text-text md:text-5xl md:leading-[1.15]">
            {title}
          </h1>
          <p className="max-w-2xl text-lg text-pretty text-text-muted md:text-xl">{lead}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
