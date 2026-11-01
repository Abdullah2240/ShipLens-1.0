import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Forbidden, NotFound } from '@/platform/errors';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('not-found-called');
  }),
  redirect: vi.fn(() => {
    throw new Error('redirect-called');
  }),
  getLocale: vi.fn(async () => 'ur'),
  getActorFromToken: vi.fn(),
  getEnv: vi.fn(() => ({ APP_ORIGIN: 'https://app.example.com' })),
  getPool: vi.fn(() => ({})),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/i18n/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next-intl/server', () => ({ getLocale: mocks.getLocale }));
vi.mock('@/modules/auth', () => ({ getActorFromToken: mocks.getActorFromToken }));
vi.mock('@/platform/config/env', () => ({ getEnv: mocks.getEnv }));
vi.mock('@/platform/db', () => ({ getPool: mocks.getPool }));

import { getPageActor, orNotFound, requirePageActor } from './interim-server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({
    get: (name: string) =>
      name === '__Host-shiplens_session' ? { value: 'A'.repeat(43) } : undefined,
  });
  mocks.getActorFromToken.mockResolvedValue(null);
});

describe('interim page helper', () => {
  it('returns the session actor and user', async () => {
    const found = {
      actor: { userId: 'u1', role: 'super_admin', branchId: null },
      user: { id: 'u1' },
    };
    mocks.getActorFromToken.mockResolvedValue(found);
    expect(await getPageActor()).toEqual(found);
    expect(await requirePageActor()).toEqual(found);
    expect(mocks.getActorFromToken).toHaveBeenCalledWith(
      expect.objectContaining({ pool: expect.anything(), clock: expect.anything() }),
      'A'.repeat(43),
    );
  });

  it('returns null for no session and redirects to localized login when required', async () => {
    expect(await getPageActor()).toBeNull();
    await expect(requirePageActor()).rejects.toThrow('redirect-called');
    expect(mocks.redirect).toHaveBeenCalledWith({ href: '/login', locale: 'ur' });
  });

  it('maps only 403 and 404 to notFound', async () => {
    expect(await orNotFound(Promise.resolve('ok'))).toBe('ok');
    for (const err of [new Forbidden(), new NotFound()]) {
      await expect(orNotFound(Promise.reject(err))).rejects.toThrow('not-found-called');
    }
    const unknown = new Error('database unavailable');
    await expect(orNotFound(Promise.reject(unknown))).rejects.toBe(unknown);
  });
});
