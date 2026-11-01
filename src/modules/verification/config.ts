import { createRateLimiter } from '@/platform/rate-limit';

/** The anchor: the latest audit event of this action for the report. */
export const APPROVAL_AUDIT_ACTION = 'report.approve';

/** Totals evidence: the latest of these events before the anchor that records each field. */
export const TOTALS_AUDIT_ACTIONS = ['report.submit', 'report.resubmit'] as const;

/** Hex characters of the anchor hash printed and encoded in the QR as the seal. */
export const SEAL_LENGTH = 16;

export const SEAL_PATTERN = /^[0-9a-f]{16}$/;

export const VERIFY_RATE_LIMIT = { max: 30, windowMs: 60_000 } as const;

// Per server process, shared by the public page and the public API.
export const verifyRateLimiter = createRateLimiter(VERIFY_RATE_LIMIT);
