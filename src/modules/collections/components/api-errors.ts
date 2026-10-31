// Turns collection API error bodies and Zod issues into `collections.errors.*` keys.
// Client-safe: no server imports.

export const ERROR_CODES = [
  'collection_locked',
  'collection_voided',
  'report_not_open',
  'branch_not_accepting',
  'branch_closed',
  'invalid_money',
  'invalid_date',
  'future_date',
  'outside_lock_window',
  'week_change_not_allowed',
  'too_short',
  'too_long',
  'required',
  'empty_patch',
  'generic',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function asErrorCode(value: unknown): ErrorCode | null {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
    ? (value as ErrorCode)
    : null;
}

export type FieldErrors<F extends string> = Partial<Record<F, ErrorCode>>;

export interface ApiFailure<F extends string> {
  fields: FieldErrors<F>;
  /** Shown in the form-level alert (409s and anything without a field). */
  form: ErrorCode | null;
}

interface ErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: { fields?: Array<{ path?: unknown; code?: unknown; message?: unknown }> };
  };
}

/**
 * Route-level validation puts our code in `message` (the Zod code is in `code`); service
 * validation puts it in both. 409s carry it in `error.code`.
 */
export function readApiFailure<F extends string>(
  body: unknown,
  fieldNames: readonly F[],
): ApiFailure<F> {
  const error = (body as ErrorBody | null)?.error;
  const fields: FieldErrors<F> = {};
  let form: ErrorCode | null = null;
  const issues = Array.isArray(error?.details?.fields) ? error.details.fields : [];
  for (const issue of issues) {
    const code = asErrorCode(issue?.message) ?? asErrorCode(issue?.code) ?? 'generic';
    const field = fieldNames.find((name) => name === issue?.path);
    if (field && !fields[field]) fields[field] = code;
    else if (!field) form ??= code;
  }
  if (issues.length === 0) form = asErrorCode(error?.code) ?? 'generic';
  return { fields, form };
}
