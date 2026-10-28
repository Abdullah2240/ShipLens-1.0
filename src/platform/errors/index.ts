// One error vocabulary for the API. Messages are short fixed English strings; the UI
// localises from `code`. No framework imports.
import { ZodError } from 'zod';

export type FieldIssue = { path: string; code: string; message: string };

export type ErrorBody = {
  error: { code: string; message: string; details?: unknown; requestId: string };
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class Unauthenticated extends AppError {
  constructor() {
    super(401, 'unauthenticated', 'Authentication required');
  }
}

export class Forbidden extends AppError {
  constructor() {
    super(403, 'forbidden', 'Not allowed');
  }
}

/** Carries no entity name or id, so missing and out-of-scope records look identical. */
export class NotFound extends AppError {
  constructor() {
    super(404, 'not_found', 'Not found');
  }
}

export class Conflict extends AppError {
  constructor(code = 'conflict') {
    super(409, code, 'Conflict with current state');
  }
}

export class ValidationFailed extends AppError {
  constructor(fields: FieldIssue[]) {
    super(422, 'validation_failed', 'Validation failed', { fields });
  }
}

export class RateLimited extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, 'rate_limited', 'Too many requests', { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function zodFields(err: ZodError): FieldIssue[] {
  return err.issues
    .map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Maps any thrown value to a response. Unknown errors become a fixed 500; the caller is
 * responsible for logging the original.
 */
export function mapError(
  err: unknown,
  requestId: string,
): { status: number; body: ErrorBody; headers: Record<string, string> } {
  const headers: Record<string, string> = {};

  if (err instanceof ZodError) {
    const validation = new ValidationFailed(zodFields(err));
    return {
      status: validation.status,
      body: {
        error: {
          code: validation.code,
          message: validation.message,
          details: validation.details,
          requestId,
        },
      },
      headers,
    };
  }

  if (err instanceof AppError) {
    if (err instanceof RateLimited) headers['Retry-After'] = String(err.retryAfterSeconds);
    const error: ErrorBody['error'] = { code: err.code, message: err.message, requestId };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.status, body: { error }, headers };
  }

  return {
    status: 500,
    body: { error: { code: 'internal_error', message: 'Internal error', requestId } },
    headers,
  };
}
