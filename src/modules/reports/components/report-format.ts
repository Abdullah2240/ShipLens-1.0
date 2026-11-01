// Pure display helpers shared by the report screens. Safe in server and client components.
import type { Locale } from '@/i18n/routing';
import { formatDate, formatDateTime, formatMoney } from '@/platform/i18n/format';
import type { ReportQuery } from '../types';

export const REPORTS_PATH = '/reports';
export const REVIEW_QUEUE_PATH = '/reports/review';
export const reportHref = (id: string) => `${REPORTS_PATH}/${id}`;
export const collectionHref = (id: string) => `/collections/${id}`;

/** Rows added by each "show more". Matches the list default. */
export const REPORT_PAGE_STEP = 60;

export type ReportFilterValues = Pick<ReportQuery, 'status' | 'branchId' | 'weekStart'> & {
  limit?: number;
};

/** List URL for a set of filters; the default limit stays out of the URL. */
export function reportsHref(values: ReportFilterValues, limit?: number): string {
  const params = new URLSearchParams();
  for (const key of ['status', 'branchId', 'weekStart'] as const) {
    const value = values[key];
    if (value) params.set(key, value);
  }
  const effective = limit ?? values.limit;
  if (effective && effective !== REPORT_PAGE_STEP) params.set('limit', String(effective));
  const search = params.toString();
  return search ? `${REPORTS_PATH}?${search}` : REPORTS_PATH;
}

export function asLocale(raw: string): Locale {
  return raw === 'ur' ? 'ur' : 'en';
}

function attempt(format: () => string, fallback: string): string {
  try {
    return format();
  } catch {
    return fallback;
  }
}

export const safeDate = (value: string, locale: Locale) =>
  attempt(() => formatDate(value, locale), value);

export const safeDateTime = (value: string, locale: Locale) =>
  attempt(() => formatDateTime(new Date(value), locale), value);

export const safeMoney = (value: string, locale: Locale) =>
  attempt(() => formatMoney(value, locale), value);
