// Business constants. One module, no imports, erasable TypeScript only.

export const TIMEZONE = 'Asia/Karachi';
export const WEEK_START = 'monday';

// Default, confirm against the brief: a report locks LOCK_DAYS after the anchor date,
// day 7 inclusive. A returned report reopens for editing.
export const LOCK_DAYS = 7;
export const LOCK_ANCHOR = 'collected_on';

export const REPORT_STATUSES = ['draft', 'submitted', 'returned', 'approved'] as const;
export const BRANCH_STATUSES = ['forming', 'active', 'paused', 'closed'] as const;
export const COLLECTION_STATUSES = ['active', 'voided'] as const;
export const APPLICATION_STATUSES = ['pending', 'accepted', 'declined'] as const;
export const CONTENT_STATUSES = ['draft', 'published'] as const;
export const MEMBER_STATUSES = ['active', 'inactive'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type BranchStatus = (typeof BRANCH_STATUSES)[number];
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

// Each name is later a named SQL predicate in the reporting module. Definitions are
// adjusted to the expected values, never the data.
export const KPI_NAMES = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'active_branches',
  'reports_awaiting_review',
] as const;
export type KpiName = (typeof KPI_NAMES)[number];

// Provisional until the owner confirms. IDs come from Postgres sequences, so gaps are allowed.
export const ID_FORMATS = {
  branchCode: { prefix: 'BR', digits: 3 },
  memberId: { prefix: 'M', digits: 5 },
} as const;

export const SESSION = {
  idleMinutes: 720,
  absoluteDays: 7,
  touchIntervalSeconds: 60,
} as const;

export const LOGIN_THROTTLE = {
  windowMinutes: 15,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
} as const;

export const PG_POOL_MAX = 5;

// Matches numeric(14,2).
export const MONEY = { scale: 2, maxIntegerDigits: 12 } as const;
