import { describe, expect, it } from 'vitest';
import { NotFound } from '@/platform/errors';
import { draftInputSchema, parseEntryParams } from './schema';

const issueCodes = (value: unknown) =>
  draftInputSchema
    .safeParse(value)
    .error?.issues.map((issue) => [issue.path.join('.'), issue.message]);

describe('draftInputSchema', () => {
  it('trims the title and turns empty strings into null', () => {
    expect(draftInputSchema.parse({ title: '  About us  ', body: 'Hello' })).toEqual({
      title: 'About us',
      body: 'Hello',
    });
    expect(draftInputSchema.parse({ title: '   ', body: '' })).toEqual({ title: null, body: null });
    expect(draftInputSchema.parse({ title: null, body: null })).toEqual({
      title: null,
      body: null,
    });
    expect(draftInputSchema.parse({})).toEqual({});
  });

  it('bounds title and body length', () => {
    expect(draftInputSchema.safeParse({ title: 'x'.repeat(200) }).success).toBe(true);
    expect(issueCodes({ title: 'x'.repeat(201) })).toEqual([['title', 'too_long']]);
    expect(draftInputSchema.safeParse({ body: 'x'.repeat(20000) }).success).toBe(true);
    expect(issueCodes({ body: 'x'.repeat(20001) })).toEqual([['body', 'too_long']]);
  });

  it('normalises CRLF to LF in the body', () => {
    expect(draftInputSchema.parse({ body: 'one\r\ntwo\r\nthree' })).toEqual({
      body: 'one\ntwo\nthree',
    });
  });

  it('stores markup as typed, without escaping or stripping', () => {
    const body = '<script>alert(1)</script>\n**bold** & <b>tag</b>';
    expect(draftInputSchema.parse({ body })).toEqual({ body });
  });

  it('rejects unknown keys and wrong types', () => {
    expect(draftInputSchema.safeParse({ title: 'x', status: 'published' }).success).toBe(false);
    expect(draftInputSchema.safeParse({ title: 5 }).success).toBe(false);
    expect(draftInputSchema.safeParse({ body: ['x'] }).success).toBe(false);
  });
});

describe('parseEntryParams', () => {
  it('accepts known keys and locales', () => {
    expect(parseEntryParams('about', 'en')).toEqual({ key: 'about', locale: 'en' });
    expect(parseEntryParams('get-involved', 'ur')).toEqual({ key: 'get-involved', locale: 'ur' });
  });

  it('throws the shared NotFound for unknown keys or locales', () => {
    expect(() => parseEntryParams('admin', 'en')).toThrow(NotFound);
    expect(() => parseEntryParams('about', 'fr')).toThrow(NotFound);
    expect(() => parseEntryParams('__proto__', 'en')).toThrow(NotFound);
    expect(() => parseEntryParams('about', 'EN')).toThrow(NotFound);
  });
});
