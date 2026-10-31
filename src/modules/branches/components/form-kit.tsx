// Shared pieces of the branch management forms: one JSON request helper, error-code
// mapping onto `branches.errors.*`, and the small visual building blocks.
import type { ReactNode } from 'react';

export const ERROR_KEYS = [
  'invalid_transition',
  'branch_has_open_reports',
  'branch_closed',
  'duplicate_branch_name',
  'invalid_user',
  'too_short',
  'too_long',
  'empty_patch',
  'generic',
] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export function errorKey(code: unknown): ErrorKey {
  return typeof code === 'string' && (ERROR_KEYS as readonly string[]).includes(code)
    ? (code as ErrorKey)
    : 'generic';
}

export interface FieldIssue {
  path: string;
  reason: ErrorKey;
}

export interface Reply {
  ok: boolean;
  status: number;
  /** The `data` member of a success body. */
  data: unknown;
  /** The `error.code` of a failure body, if any. */
  code: string | null;
  fields: FieldIssue[];
}

function fieldsOf(json: unknown): FieldIssue[] {
  const raw = (json as { error?: { details?: { fields?: unknown } } } | null)?.error?.details
    ?.fields;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: { path?: unknown; code?: unknown; message?: unknown }) => {
    if (typeof item?.path !== 'string') return [];
    // Schema issues carry the stable reason in `message`; service issues in `code`.
    const byMessage = errorKey(item.message);
    return [{ path: item.path, reason: byMessage !== 'generic' ? byMessage : errorKey(item.code) }];
  });
}

export async function sendJson(
  method: 'POST' | 'PATCH',
  url: string,
  payload: unknown,
): Promise<Reply> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json: unknown = await response.json().catch(() => null);
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    return {
      ok: response.ok,
      status: response.status,
      data: (json as { data?: unknown } | null)?.data ?? null,
      code: typeof code === 'string' ? code : null,
      fields: fieldsOf(json),
    };
  } catch {
    return { ok: false, status: 0, data: null, code: null, fields: [] };
  }
}

export const fieldClass =
  'block w-full rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

export const primaryButton =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButton =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border-strong/60 bg-surface-raised px-3.5 text-sm font-semibold text-text shadow-xs transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButton =
  'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger/40 bg-surface-raised px-3.5 text-sm font-semibold text-tone-danger-fg shadow-xs transition-colors hover:bg-tone-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50';

export function Spinner() {
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

export function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="mt-0.5 size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M7 9V6.75a3 3 0 016 0V9" />
    </svg>
  );
}

/** Calm informational strip, for read-only and closed notices. */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-lg border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-sm text-tone-info-fg">
      <LockIcon />
      <span>{children}</span>
    </p>
  );
}

/** Error strip announced to assistive technology. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger/40 bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg"
    >
      {children}
    </p>
  );
}

/** Card with a header row, matching the other admin detail screens. */
export function Panel({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col rounded-card border border-border bg-surface-raised shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 id={id} className="text-sm font-semibold text-text">
          {title}
        </h2>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** One label and value pair inside a definition list. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-semibold text-text-muted">{label}</dt>
      <dd className="min-w-0 text-sm text-text">{children}</dd>
    </div>
  );
}
