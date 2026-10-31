import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Conflict, Forbidden, NotFound } from '@/platform/errors';

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

import { getCurrentActor, orNotFound, requireActor } from './server';

const token = 'A'.repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEnv.mockReturnValue({ APP_ORIGIN: 'https://app.example.com' });
  mocks.cookies.mockResolvedValue({
    get: (name: string) => (name === '__Host-shiplens_session' ? { value: token } : undefined),
  });
  mocks.getActorFromToken.mockResolvedValue(null);
});

describe('server session helpers', () => {
  it('does not read the environment or pool at import', () => {
    expect(mocks.getEnv).not.toHaveBeenCalled();
    expect(mocks.getPool).not.toHaveBeenCalled();
  });

  it('returns the session actor and user from the __Host- cookie over https', async () => {
    const found = {
      actor: { userId: 'u1', role: 'super_admin', branchId: null },
      user: { id: 'u1' },
    };
    mocks.getActorFromToken.mockResolvedValue(found);
    expect(await getCurrentActor()).toEqual(found);
    expect(await requireActor()).toEqual(found);
    expect(mocks.getActorFromToken).toHaveBeenCalledWith(
      expect.objectContaining({ pool: expect.anything(), clock: expect.anything() }),
      token,
    );
  });

  it('reads the plain cookie name over http', async () => {
    mocks.getEnv.mockReturnValue({ APP_ORIGIN: 'http://localhost:3000' });
    await getCurrentActor();
    expect(mocks.getActorFromToken).toHaveBeenLastCalledWith(expect.anything(), null);
    mocks.cookies.mockResolvedValue({
      get: (name: string) => (name === 'shiplens_session' ? { value: token } : undefined),
    });
    await getCurrentActor();
    expect(mocks.getActorFromToken).toHaveBeenLastCalledWith(expect.anything(), token);
  });

  it('returns null without a session and redirects to the localised login when required', async () => {
    expect(await getCurrentActor()).toBeNull();
    await expect(requireActor()).rejects.toThrow('redirect-called');
    expect(mocks.redirect).toHaveBeenCalledWith({ href: '/login', locale: 'ur' });
  });

  it('maps only 403 and 404 to notFound', async () => {
    expect(await orNotFound(Promise.resolve('ok'))).toBe('ok');
    for (const err of [new Forbidden(), new NotFound()]) {
      await expect(orNotFound(Promise.reject(err))).rejects.toThrow('not-found-called');
    }
    const conflict = new Conflict();
    await expect(orNotFound(Promise.reject(conflict))).rejects.toBe(conflict);
    const unknown = new Error('database unavailable');
    await expect(orNotFound(Promise.reject(unknown))).rejects.toBe(unknown);
  });
});
