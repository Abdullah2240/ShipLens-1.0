import type { ContentKey } from '@/modules/public-site/keys';

export type { ContentKey };
export type ContentLocale = 'en' | 'ur';
export type ContentStatus = 'draft' | 'published';

export const CONTENT_LOCALES: readonly ContentLocale[] = ['en', 'ur'];

/**
 * One page-content entry as the editor sees it. `title` and `body` are the DRAFT copy;
 * the public copy is never exposed here. `exists` is false for a key/locale pair that
 * has never been saved.
 */
export interface ContentEntryView {
  key: ContentKey;
  locale: ContentLocale;
  exists: boolean;
  title: string | null;
  body: string | null;
  status: ContentStatus;
  hasUnpublishedChanges: boolean;
  translationMissing: boolean;
  publishedAt: string | null;
  updatedAt: string | null;
}

export interface DraftInput {
  title?: string | null;
  body?: string | null;
}
