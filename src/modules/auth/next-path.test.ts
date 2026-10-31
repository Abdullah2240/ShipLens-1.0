import { describe, expect, it } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each([
    '/en/branches?x=1',
    '/en/account',
    '/ur/share/reports/3f1c2b9e-8a4d-4c1e-9b2a-1d2e3f4a5b6c',
    '/account',
    '/en/reports?status=submitted&page=2#top',
    '/',
  ])('keeps the same-origin path %s unchanged', (raw) => {
    expect(safeNextPath(raw)).toBe(raw);
  });

  it.each([null, undefined, ''])('returns null for %s', (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it.each([
    'https://evil.test',
    'http://x',
    'HTTPS://evil.test/en/account',
    '//evil.test',
    '//evil.test/en/account',
    '/\\evil.test',
    '\\\\evil.test',
    '/%5Cevil.test',
    '/%5cevil.test',
    '/%2F%2Fevil.test',
    '/%2f/evil.test',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'en/account',
    ' /en/account',
    '/en/account\n',
    '/en/\r\nSet-Cookie:x=1',
    '/en/\taccount',
    '/en/\u0000account',
    '/en/%0aaccount',
    '/en/../../x',
    '/en/%2e%2e/x',
    '/en/./account',
    '/%E0%A4%A',
  ])('rejects %j', (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it('rejects paths longer than 512 characters', () => {
    const ok = `/en/${'a'.repeat(508)}`;
    expect(ok).toHaveLength(512);
    expect(safeNextPath(ok)).toBe(ok);
    expect(safeNextPath(`${ok}b`)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(safeNextPath(42 as unknown as string)).toBeNull();
    expect(safeNextPath(['/en'] as unknown as string)).toBeNull();
  });
});
