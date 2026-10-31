export type EventStatus = 'draft' | 'published';

/**
 * One event as the editor sees it. Titles, summaries, venue, times and branch are the
 * DRAFT copy; the public copy is never exposed here. Instants are ISO-8601 UTC strings.
 * `branchName` is the draft branch's name whatever that branch's status.
 */
export interface EventView {
  id: string;
  slug: string;
  titleEn: string | null;
  titleUr: string | null;
  summaryEn: string | null;
  summaryUr: string | null;
  location: string | null;
  startsAt: string | null;
  endsAt: string | null;
  branchId: string | null;
  branchName: string | null;
  status: EventStatus;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

/** An Active branch as offered in the event editor's optional branch select. */
export interface BranchOption {
  id: string;
  name: string;
}
