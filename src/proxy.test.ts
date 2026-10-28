import { describe, expect, it, vi } from 'vitest';
import { dirFor } from '@/i18n/routing';
import { config } from './proxy';

// next-intl's middleware imports 'next/server' without an extension, which Node ESM
// cannot resolve under Vitest. Only the exported matcher is under test here.
vi.mock('next-intl/middleware', () => ({ default: () => () => undefined }));

// The matcher is a path-to-regexp string. This one only uses a negative lookahead
// group, so anchoring it as a RegExp gives the same behaviour.
function matcherRegExp(): RegExp {
  const source = config.matcher[0];
  return new RegExp('^' + source + '$');
}

describe('proxy matcher', () => {
  const re = matcherRegExp();

  it.each([
    '/api/health',
    '/api/health/db',
    '/api/v1/auth/login',
    '/_next/static/x.js',
    '/_vercel/insights',
    '/favicon.ico',
  ])('skips %s', (path) => {
    expect(re.test(path)).toBe(false);
  });

  it.each(['/', '/en', '/ur', '/ur/branches', '/en/login'])('handles %s', (path) => {
    expect(re.test(path)).toBe(true);
  });
});

describe('dirFor', () => {
  it('returns rtl for Urdu and ltr for English', () => {
    expect(dirFor('ur')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
  });
});
