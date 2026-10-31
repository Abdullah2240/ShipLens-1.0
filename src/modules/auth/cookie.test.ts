import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readSessionToken,
  serializeSessionCookie,
  sessionCookieName,
} from './cookie';

const TOKEN = 'A'.repeat(43);

describe('session cookie', () => {
  it('serialises a secure cookie with the host prefix and strict flags', () => {
    const c = serializeSessionCookie(TOKEN, { secure: true, maxAgeSeconds: 604800 });
    expect(c.startsWith(`__Host-shiplens_session=${TOKEN}`)).toBe(true);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']) {
      expect(c).toContain(part);
    }
    expect(c).not.toMatch(/Domain/i);
  });

  it('uses the plain name and omits Secure when the caller says so (dev over http)', () => {
    const c = serializeSessionCookie(TOKEN, { secure: false, maxAgeSeconds: 60 });
    expect(c.startsWith(`${SESSION_COOKIE}=${TOKEN}`)).toBe(true);
    expect(c).not.toContain('__Host-');
    expect(c).not.toContain('Secure');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
  });

  it('picks the cookie name from the secure flag', () => {
    expect(sessionCookieName(true)).toBe('__Host-shiplens_session');
    expect(sessionCookieName(false)).toBe('shiplens_session');
  });

  it('clears with Max-Age=0 and the same name and flags', () => {
    const c = clearSessionCookie({ secure: true });
    expect(c.startsWith('__Host-shiplens_session=;')).toBe(true);
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('Path=/');
    expect(c).toContain('SameSite=Lax');
    expect(clearSessionCookie({ secure: false })).not.toContain('Secure');
  });

  it('rejects a non-integer or negative max age', () => {
    expect(() => serializeSessionCookie(TOKEN, { secure: true, maxAgeSeconds: -1 })).toThrow();
    expect(() => serializeSessionCookie(TOKEN, { secure: true, maxAgeSeconds: 1.5 })).toThrow();
  });

  it('refuses to serialise a token with unsafe characters', () => {
    expect(() => serializeSessionCookie('a;b', { secure: true, maxAgeSeconds: 1 })).toThrow();
    expect(() => serializeSessionCookie('a b', { secure: true, maxAgeSeconds: 1 })).toThrow();
    expect(() => serializeSessionCookie('', { secure: true, maxAgeSeconds: 1 })).toThrow();
  });

  it('reads the token among several cookies', () => {
    const header = `theme=dark; __Host-shiplens_session=${TOKEN}; other=1`;
    expect(readSessionToken(header, true)).toBe(TOKEN);
  });

  it('reads only the cookie matching the secure flag', () => {
    expect(readSessionToken(`shiplens_session=${TOKEN}`, true)).toBeNull();
    expect(readSessionToken(`__Host-shiplens_session=${TOKEN}`, false)).toBeNull();
    expect(readSessionToken(`shiplens_session=${TOKEN}`, false)).toBe(TOKEN);
  });

  it('ignores malformed pieces and returns null when absent', () => {
    expect(readSessionToken(null, true)).toBeNull();
    expect(readSessionToken(undefined, true)).toBeNull();
    expect(readSessionToken('', true)).toBeNull();
    expect(readSessionToken(';;; garbage; =x; novalue', true)).toBeNull();
    expect(readSessionToken(`junk;; ;__Host-shiplens_session=${TOKEN}`, true)).toBe(TOKEN);
  });

  it('rejects values that are not shaped like a session token', () => {
    expect(readSessionToken('__Host-shiplens_session=short', true)).toBeNull();
    expect(readSessionToken(`__Host-shiplens_session=${'A'.repeat(44)}`, true)).toBeNull();
    expect(readSessionToken(`__Host-shiplens_session=${'A'.repeat(42)}!`, true)).toBeNull();
  });
});
