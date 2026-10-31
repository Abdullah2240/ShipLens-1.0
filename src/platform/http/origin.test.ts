import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, isMutatingMethod } from './origin';

const APP = 'https://app.example.com';

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.com/api/v1/probe', { method, headers });
}

describe('isAllowedOrigin', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('accepts the exact app origin on %s', (method) => {
    expect(isAllowedOrigin(req(method, { origin: APP }), APP)).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['the literal null', 'null'],
    ['another host', 'https://other.test'],
    ['http instead of https', 'http://app.example.com'],
    ['another port', 'https://app.example.com:8443'],
    ['a prefix-attack host', 'https://app.example.com.evil.test'],
    ['a trailing slash', 'https://app.example.com/'],
    ['different case', 'https://APP.example.com'],
  ])('rejects %s Origin on a mutation', (_label, origin) => {
    const headers: Record<string, string> = origin === undefined ? {} : { origin };
    expect(isAllowedOrigin(req('POST', headers), APP)).toBe(false);
  });

  it('still rejects a mutation with no Origin even when Sec-Fetch-Site says same-origin', () => {
    expect(isAllowedOrigin(req('POST', { 'sec-fetch-site': 'same-origin' }), APP)).toBe(false);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('skips the check on %s', (method) => {
    expect(isAllowedOrigin(req(method), APP)).toBe(true);
    expect(isAllowedOrigin(req(method, { origin: 'https://other.test' }), APP)).toBe(true);
  });

  it('honours an explicit mutating flag', () => {
    expect(isAllowedOrigin(req('GET'), APP, true)).toBe(false);
    expect(isAllowedOrigin(req('POST'), APP, false)).toBe(true);
  });

  it('classifies methods', () => {
    expect(isMutatingMethod('post')).toBe(true);
    expect(isMutatingMethod('GET')).toBe(false);
  });
});
