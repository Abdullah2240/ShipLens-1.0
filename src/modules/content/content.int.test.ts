import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPublishedContent } from '@/modules/public-site';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Conflict, Forbidden, NotFound, ValidationFailed } from '@/platform/errors';
import { systemClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import {
  getEntry,
  listEntries,
  previewEntry,
  publishEntry,
  saveDraft,
  unpublishEntry,
} from './service';

const db = testPool();
const digest = (text: string | null) =>
  createHash('sha256')
    .update(text ?? '')
    .digest('hex');

async function actorFor(role: Actor['role']): Promise<Actor> {
  const branchId = role === 'hr_lead' || role === 'branch_lead' ? (await seedBranch(db)).id : null;
  const user = await seedUser(db, { role, branchId });
  return { userId: user.id, role, branchId };
}
const ctx = (actor: Actor): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: systemClock,
  pool: db,
});
async function auditRows(action?: string) {
  const { rows } = await db.query<{
    action: string;
    entity_type: string;
    entity_id: string;
    actor_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT action, entity_type, entity_id, actor_id, before, after FROM audit_events
     ${action ? 'WHERE action = $1' : ''} ORDER BY occurred_at, id`,
    action ? [action] : [],
  );
  return rows;
}

beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

describe('content permissions', () => {
  it('allows content_editor and super_admin and forbids every other role', async () => {
    for (const role of ['content_editor', 'super_admin'] as const) {
      await resetDb(db);
      const actor = await actorFor(role);
      expect(await listEntries(db, actor)).toHaveLength(8);
      await saveDraft(ctx(actor), 'about', 'en', { title: 'About', body: 'Body' });
      expect((await getEntry(db, actor, 'about', 'en')).title).toBe('About');
      expect((await previewEntry(db, actor, 'about', 'en')).body).toBe('Body');
      await publishEntry(ctx(actor), 'about', 'en');
      expect((await unpublishEntry(ctx(actor), 'about', 'en')).status).toBe('draft');
    }

    await resetDb(db);
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'about', 'en', { title: 'About', body: 'Body' });
    await publishEntry(ctx(editor), 'about', 'en');
    const before = (await auditRows()).length;
    for (const role of ['hr_lead', 'branch_lead', 'finance_reviewer'] as const) {
      const actor = await actorFor(role);
      await expect(listEntries(db, actor)).rejects.toThrow(Forbidden);
      await expect(getEntry(db, actor, 'about', 'en')).rejects.toThrow(Forbidden);
      await expect(previewEntry(db, actor, 'about', 'en')).rejects.toThrow(Forbidden);
      await expect(saveDraft(ctx(actor), 'about', 'en', { title: 'Nope' })).rejects.toThrow(
        Forbidden,
      );
      await expect(publishEntry(ctx(actor), 'about', 'en')).rejects.toThrow(Forbidden);
      await expect(unpublishEntry(ctx(actor), 'about', 'en')).rejects.toThrow(Forbidden);
      // forbidden even for unknown keys, so the key space is not probeable
      await expect(getEntry(db, actor, 'admin', 'en')).rejects.toThrow(Forbidden);
    }
    expect(await auditRows()).toHaveLength(before);
    expect((await getEntry(db, editor, 'about', 'en')).title).toBe('About');
  });

  it('returns NotFound for unknown keys or locales from every function', async () => {
    const editor = await actorFor('content_editor');
    for (const [key, locale] of [
      ['admin', 'en'],
      ['about', 'fr'],
    ] as const) {
      await expect(getEntry(db, editor, key, locale)).rejects.toThrow(NotFound);
      await expect(previewEntry(db, editor, key, locale)).rejects.toThrow(NotFound);
      await expect(saveDraft(ctx(editor), key, locale, { title: 'x' })).rejects.toThrow(NotFound);
      await expect(publishEntry(ctx(editor), key, locale)).rejects.toThrow(NotFound);
      await expect(unpublishEntry(ctx(editor), key, locale)).rejects.toThrow(NotFound);
    }
    expect(await auditRows()).toHaveLength(0);
  });
});

describe('listEntries', () => {
  it('lists every key and locale with translation-missing markers', async () => {
    const editor = await actorFor('content_editor');
    const empty = await listEntries(db, editor);
    expect(empty.map((entry) => `${entry.key}/${entry.locale}`)).toEqual([
      'about/en',
      'about/ur',
      'programs/en',
      'programs/ur',
      'get-involved/en',
      'get-involved/ur',
      'contact/en',
      'contact/ur',
    ]);
    for (const entry of empty) {
      expect(entry).toMatchObject({
        exists: false,
        title: null,
        body: null,
        status: 'draft',
        hasUnpublishedChanges: false,
        translationMissing: entry.locale === 'ur',
        publishedAt: null,
        updatedAt: null,
      });
    }

    await saveDraft(ctx(editor), 'about', 'ur', { title: 'ہمارے بارے میں' });
    await saveDraft(ctx(editor), 'programs', 'ur', { title: null, body: null });
    await saveDraft(ctx(editor), 'contact', 'ur', { title: '   ', body: '' });
    const list = await listEntries(db, editor);
    const find = (key: string, locale: string) =>
      list.find((entry) => entry.key === key && entry.locale === locale)!;
    expect(find('about', 'ur')).toMatchObject({ exists: true, translationMissing: false });
    expect(find('programs', 'ur')).toMatchObject({ exists: true, translationMissing: true });
    expect(find('contact', 'ur')).toMatchObject({ exists: true, translationMissing: true });
    expect(find('about', 'en')).toMatchObject({ exists: false, translationMissing: false });
  });

  it('ignores stray rows whose key is not a known content key', async () => {
    const editor = await actorFor('content_editor');
    await db.query(`INSERT INTO content_entries (key, locale, title) VALUES ('legacy', 'en', 'x')`);
    expect(await listEntries(db, editor)).toHaveLength(8);
  });
});

describe('saveDraft', () => {
  it('creates then updates the draft and audits each call without the body', async () => {
    const editor = await actorFor('content_editor');
    const body = 'DISTINCTIVE-BODY-TEXT-7731 about our work';
    const created = await saveDraft(ctx(editor), 'about', 'en', { title: 'About', body });
    expect(created).toMatchObject({
      key: 'about',
      locale: 'en',
      exists: true,
      title: 'About',
      body,
      status: 'draft',
      hasUnpublishedChanges: false,
      translationMissing: false,
      publishedAt: null,
    });
    expect(created.updatedAt).toEqual(expect.any(String));
    const { rows } = await db.query<{ id: string; updated_by: string; status: string }>(
      `SELECT id, updated_by, status FROM content_entries WHERE key = 'about' AND locale = 'en'`,
    );
    expect(rows[0]).toMatchObject({ updated_by: editor.userId, status: 'draft' });

    const updated = await saveDraft(ctx(editor), 'about', 'en', { body: 'Second body' });
    expect(updated).toMatchObject({ title: 'About', body: 'Second body' });

    const audits = await auditRows('content.save_draft');
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      entity_type: 'content',
      entity_id: rows[0]!.id,
      actor_id: editor.userId,
      before: null,
      after: {
        key: 'about',
        locale: 'en',
        status: 'draft',
        title: 'About',
        body_digest: digest(body),
      },
    });
    expect(audits[1]).toMatchObject({
      before: { body_digest: digest(body) },
      after: { body_digest: digest('Second body') },
    });
    expect(Object.keys(audits[1]!.after!)).toEqual(['body_digest']);
    expect(JSON.stringify(audits)).not.toContain('DISTINCTIVE-BODY-TEXT-7731');
    expect(JSON.stringify(audits)).not.toContain('Second body');
  });

  it('keeps a draft invisible to the public read', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'about', 'en', { title: 'Secret', body: 'Draft only' });
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
    expect(await getPublishedContent(db, 'about', 'ur')).toBeNull();
  });

  it('changes only the draft copy of a published entry', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'about', 'en', { title: 'Live', body: 'Live body' });
    await publishEntry(ctx(editor), 'about', 'en');
    const edited = await saveDraft(ctx(editor), 'about', 'en', { body: 'Next body' });
    expect(edited).toMatchObject({
      status: 'published',
      body: 'Next body',
      hasUnpublishedChanges: true,
    });
    expect(await getPublishedContent(db, 'about', 'en')).toMatchObject({
      title: 'Live',
      body: 'Live body',
    });
  });

  it('stores script markup unchanged', async () => {
    const editor = await actorFor('content_editor');
    const body = '<script>alert(1)</script>\n<img src=x onerror=alert(2)>';
    expect((await saveDraft(ctx(editor), 'contact', 'en', { body })).body).toBe(body);
    expect((await getEntry(db, editor, 'contact', 'en')).body).toBe(body);
    await publishEntry(ctx(editor), 'contact', 'en');
    expect((await getPublishedContent(db, 'contact', 'en'))?.body).toBe(body);
  });
});

describe('publishEntry', () => {
  it('copies the draft to the public copy and audits the change', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'programs', 'en', { title: 'Programs', body: 'First' });
    const published = await publishEntry(ctx(editor), 'programs', 'en');
    expect(published).toMatchObject({ status: 'published', hasUnpublishedChanges: false });
    expect(published.publishedAt).toEqual(expect.any(String));
    expect(await getPublishedContent(db, 'programs', 'en')).toMatchObject({
      title: 'Programs',
      body: 'First',
      fallback: false,
    });
    const [audit] = await auditRows('content.publish');
    expect(audit).toMatchObject({
      entity_type: 'content',
      before: { status: 'draft', title: null, body_digest: digest(null) },
      after: { status: 'published', title: 'Programs', body_digest: digest('First') },
    });
    expect(JSON.stringify(audit)).not.toContain('"First"');

    await saveDraft(ctx(editor), 'programs', 'en', { title: 'Programs 2', body: 'Second' });
    expect(await getPublishedContent(db, 'programs', 'en')).toMatchObject({ body: 'First' });
    await publishEntry(ctx(editor), 'programs', 'en');
    expect(await getPublishedContent(db, 'programs', 'en')).toMatchObject({
      title: 'Programs 2',
      body: 'Second',
    });
    const audits = await auditRows('content.publish');
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({
      before: { title: 'Programs', body_digest: digest('First') },
      after: { title: 'Programs 2', body_digest: digest('Second') },
    });
    const { rows } = await db.query(
      `SELECT published_title, published_body FROM content_entries WHERE key = 'programs'`,
    );
    expect(rows).toEqual([{ published_title: 'Programs 2', published_body: 'Second' }]);
  });

  it('refuses an empty entry with no audit row and 404s a missing row', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'about', 'en', { title: '  ', body: null });
    const before = (await auditRows()).length;
    const error = await publishEntry(ctx(editor), 'about', 'en').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationFailed);
    expect((error as ValidationFailed).details).toEqual({
      fields: [{ path: 'body', code: 'empty_content', message: 'empty_content' }],
    });
    expect(await auditRows()).toHaveLength(before);
    expect((await getEntry(db, editor, 'about', 'en')).status).toBe('draft');

    await expect(publishEntry(ctx(editor), 'contact', 'en')).rejects.toThrow(NotFound);
    expect(await auditRows()).toHaveLength(before);
  });
});

describe('unpublishEntry', () => {
  it('hides the entry immediately, keeps the draft and can re-publish', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'about', 'en', { title: 'About', body: 'Live' });
    await publishEntry(ctx(editor), 'about', 'en');
    await saveDraft(ctx(editor), 'about', 'en', { body: 'Newer draft' });
    const unpublished = await unpublishEntry(ctx(editor), 'about', 'en');
    expect(unpublished).toMatchObject({
      status: 'draft',
      body: 'Newer draft',
      hasUnpublishedChanges: false,
    });
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
    const [audit] = await auditRows('content.unpublish');
    expect(audit).toMatchObject({
      entity_type: 'content',
      before: { status: 'published' },
      after: { status: 'draft' },
    });

    await expect(unpublishEntry(ctx(editor), 'about', 'en')).rejects.toThrow(
      expect.objectContaining({ status: 409, code: 'not_published' }),
    );
    await expect(unpublishEntry(ctx(editor), 'about', 'en')).rejects.toBeInstanceOf(Conflict);
    expect(await auditRows('content.unpublish')).toHaveLength(1);
    await expect(unpublishEntry(ctx(editor), 'contact', 'en')).rejects.toThrow(NotFound);

    await publishEntry(ctx(editor), 'about', 'en');
    expect(await getPublishedContent(db, 'about', 'en')).toMatchObject({ body: 'Newer draft' });
  });

  it('falls back to English when the Urdu entry is not published', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'about', 'en', { title: 'About', body: 'English' });
    await publishEntry(ctx(editor), 'about', 'en');
    expect(await getPublishedContent(db, 'about', 'ur')).toMatchObject({
      locale: 'en',
      body: 'English',
      fallback: true,
    });

    await saveDraft(ctx(editor), 'about', 'ur', { title: 'تعارف', body: 'اردو متن' });
    await publishEntry(ctx(editor), 'about', 'ur');
    expect(await getPublishedContent(db, 'about', 'ur')).toMatchObject({
      locale: 'ur',
      body: 'اردو متن',
      fallback: false,
    });

    await unpublishEntry(ctx(editor), 'about', 'ur');
    expect(await getPublishedContent(db, 'about', 'ur')).toMatchObject({
      locale: 'en',
      fallback: true,
    });
  });
});

describe('previewEntry', () => {
  it('returns the draft copy even when nothing is published', async () => {
    const editor = await actorFor('content_editor');
    await saveDraft(ctx(editor), 'get-involved', 'ur', { title: 'شامل ہوں', body: 'مسودہ' });
    expect(await previewEntry(db, editor, 'get-involved', 'ur')).toMatchObject({
      title: 'شامل ہوں',
      body: 'مسودہ',
      status: 'draft',
    });
    expect(await getPublishedContent(db, 'get-involved', 'ur')).toBeNull();
    const absent = await previewEntry(db, editor, 'contact', 'en');
    expect(absent).toMatchObject({ exists: false, title: null, body: null });
    await expect(
      previewEntry(db, await actorFor('finance_reviewer'), 'get-involved', 'ur'),
    ).rejects.toThrow(Forbidden);
  });
});
