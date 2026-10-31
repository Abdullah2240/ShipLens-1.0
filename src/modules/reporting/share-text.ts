// WhatsApp share text (WA-01). Pure and framework-free, so the report page's client button
// and the tests build exactly the same message. The text carries the summary fields and the
// sign-in link only: never line items, purposes or names.
import type { ReportStatus } from '@/platform/config/constants';

/** The minimal report summary a share may disclose. Amounts are decimal strings. */
export interface ReportShareSummary {
  reportId: string;
  branchName: string;
  branchCode: string;
  weekStart: string;
  weekEnd: string;
  status: ReportStatus;
  /** Frozen total for submitted and approved reports, the live sum otherwise. */
  amount: string;
  collectionCount: number;
  amountIsFrozen: boolean;
}

/** A translator bound to the `share` namespace (next-intl `t` or `createTranslator`). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Display strings, already localized by the caller with the shared formatters. */
export interface ShareTextFormatted {
  amount: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  /** Formatted collection count; defaults to the plain number. */
  count?: string;
}

export interface ShareTextOptions {
  /**
   * Wrap branch, code, dates, amount and count in first-strong isolates (U+2068 .. U+2069)
   * so an Urdu (RTL) message keeps them in reading order.
   */
  isolate?: boolean;
  /** Lines added after the link line, for later extensions of the message. */
  appendLines?: readonly string[];
}

const FSI = '\u2068';
const PDI = '\u2069';
// Line breaks and explicit bidi controls (embeddings, overrides, isolates) in stored text
// could add lines or reorder the message, so they are removed from branch name and code.
const UNSAFE_TEXT = /[\r\n\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

const clean = (value: string) => value.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();

/** The share message: five lines (branch, week, status, total, link), plus any appended lines. */
export function buildShareText(
  t: Translate,
  s: ReportShareSummary,
  link: string,
  formatted: ShareTextFormatted,
  options: ShareTextOptions = {},
): string {
  const wrap = options.isolate ? (v: string) => `${FSI}${v}${PDI}` : (v: string) => v;
  const body = t('text', {
    branch: wrap(clean(s.branchName)),
    code: wrap(clean(s.branchCode)),
    weekStart: wrap(formatted.weekStart),
    weekEnd: wrap(formatted.weekEnd),
    status: formatted.status,
    amount: wrap(formatted.amount),
    count: s.collectionCount,
    countText: wrap(formatted.count ?? String(s.collectionCount)),
    // Never isolated: a trailing control character could be swallowed into the link.
    link,
  });
  return [body, ...(options.appendLines ?? [])].join('\n');
}

/** A wa.me link with the message prefilled; WhatsApp lets the user pick the chat. */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
