import { createHash } from 'node:crypto';
import { CONTENT_KEYS } from '@/modules/public-site/keys';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { Conflict, NotFound, ValidationFailed } from '@/platform/errors';
import {
  publishRow,
  selectEntries,
  selectEntry,
  unpublishRow,
  upsertDraft,
  type ContentEntryRow,
} from './repo';
import { draftInputSchema, parseEntryParams } from './schema';
import {
  CONTENT_LOCALES,
  type ContentEntryView,
  type ContentKey,
  type ContentLocale,
  type DraftInput,
} from './types';

const hasText = (title: string | null, body: string | null) =>
  Boolean(title?.trim() || body?.trim());

const bodyDigest = (body: string | null) =>
  createHash('sha256')
    .update(body ?? '')
    .digest('hex');

function toView(
  key: ContentKey,
  locale: ContentLocale,
  row: ContentEntryRow | null,
): ContentEntryView {
  if (!row) {
    return {
      key,
      locale,
      exists: false,
      title: null,
      body: null,
      status: 'draft',
      hasUnpublishedChanges: false,
      translationMissing: locale === 'ur',
      publishedAt: null,
      updatedAt: null,
    };
  }
  return {
    key,
    locale,
    exists: true,
    title: row.title,
    body: row.body,
    status: row.status,
    hasUnpublishedChanges:
      row.status === 'published' &&
      (row.title !== row.published_title || row.body !== row.published_body),
    translationMissing: locale === 'ur' && !hasText(row.title, row.body),
    publishedAt: row.published_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

// Audit snapshots carry a digest of the body, never the text (content allowlist).
const draftSnapshot = (row: ContentEntryRow) => ({
  key: row.key,
  locale: row.locale,
  status: row.status,
  title: row.title,
  body_digest: bodyDigest(row.body),
});
const publicSnapshot = (row: ContentEntryRow) => ({
  key: row.key,
  locale: row.locale,
  status: row.status,
  title: row.published_title,
  body_digest: bodyDigest(row.published_body),
});

export async function listEntries(db: Queryable, actor: Actor): Promise<ContentEntryView[]> {
  authorize(actor, 'content.read');
  const rows = await selectEntries(db);
  const byId = new Map(rows.map((row) => [`${row.key}/${row.locale}`, row]));
  return CONTENT_KEYS.flatMap((key) =>
    CONTENT_LOCALES.map((locale) => toView(key, locale, byId.get(`${key}/${locale}`) ?? null)),
  );
}

export async function getEntry(
  db: Queryable,
  actor: Actor,
  key: string,
  locale: string,
): Promise<ContentEntryView> {
  authorize(actor, 'content.read');
  const params = parseEntryParams(key, locale);
  return toView(params.key, params.locale, await selectEntry(db, params.key, params.locale));
}

/** The private draft copy, for editors only; the public read never sees it. */
export async function previewEntry(
  db: Queryable,
  actor: Actor,
  key: string,
  locale: string,
): Promise<ContentEntryView> {
  authorize(actor, 'content.preview');
  const params = parseEntryParams(key, locale);
  return toView(params.key, params.locale, await selectEntry(db, params.key, params.locale));
}

/**
 * Creates or updates the draft copy. Fields left out of `input` keep their saved value;
 * status and the public copy never change here.
 */
export async function saveDraft(
  ctx: CommandContext,
  key: string,
  locale: string,
  input: DraftInput,
): Promise<ContentEntryView> {
  const actor = ctx.actor!;
  authorize(actor, 'content.edit');
  const params = parseEntryParams(key, locale);
  const draft = draftInputSchema.parse(input);
  return command(ctx, 'content.save_draft', async (tx, audit) => {
    const existing = await selectEntry(tx, params.key, params.locale, { forUpdate: true });
    const title = draft.title !== undefined ? draft.title : (existing?.title ?? null);
    const body = draft.body !== undefined ? draft.body : (existing?.body ?? null);
    const saved = await upsertDraft(tx, params.key, params.locale, title, body, actor.userId);
    audit({
      action: 'content.save_draft',
      entityType: 'content',
      entityId: saved.id,
      before: existing ? draftSnapshot(existing) : null,
      after: draftSnapshot(saved),
    });
    return toView(params.key, params.locale, saved);
  });
}

export async function publishEntry(
  ctx: CommandContext,
  key: string,
  locale: string,
): Promise<ContentEntryView> {
  const actor = ctx.actor!;
  authorize(actor, 'content.publish');
  const params = parseEntryParams(key, locale);
  return command(ctx, 'content.publish', async (tx, audit) => {
    const existing = await selectEntry(tx, params.key, params.locale, { forUpdate: true });
    if (!existing) throw new NotFound();
    if (!hasText(existing.title, existing.body)) {
      throw new ValidationFailed([
        { path: 'body', code: 'empty_content', message: 'empty_content' },
      ]);
    }
    const published = await publishRow(tx, existing.id, actor.userId);
    audit({
      action: 'content.publish',
      entityType: 'content',
      entityId: published.id,
      before: publicSnapshot(existing),
      after: publicSnapshot(published),
    });
    return toView(params.key, params.locale, published);
  });
}

export async function unpublishEntry(
  ctx: CommandContext,
  key: string,
  locale: string,
): Promise<ContentEntryView> {
  const actor = ctx.actor!;
  authorize(actor, 'content.unpublish');
  const params = parseEntryParams(key, locale);
  return command(ctx, 'content.unpublish', async (tx, audit) => {
    const existing = await selectEntry(tx, params.key, params.locale, { forUpdate: true });
    if (!existing) throw new NotFound();
    if (existing.status !== 'published') throw new Conflict('not_published');
    const unpublished = await unpublishRow(tx, existing.id, actor.userId);
    audit({
      action: 'content.unpublish',
      entityType: 'content',
      entityId: unpublished.id,
      before: publicSnapshot(existing),
      after: publicSnapshot(unpublished),
    });
    return toView(params.key, params.locale, unpublished);
  });
}
