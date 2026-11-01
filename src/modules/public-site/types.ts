import type { ContentKey } from './keys';

export type ContentLocale = 'en' | 'ur';

export interface PublishedContent {
  key: ContentKey;
  title: string | null;
  body: string | null;
  locale: ContentLocale;
  fallback: boolean;
}

export interface PublicBranch {
  id: string;
  name: string;
  city: string | null;
  summary: string | null;
}

export interface PublicEvent {
  slug: string;
  title: string;
  summary: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  branchName: string | null;
  locale: ContentLocale;
}
