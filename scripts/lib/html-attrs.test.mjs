import { describe, expect, it } from 'vitest';
import { hasLinkWithPrefix, parseHtmlAttrs } from './html-attrs.mjs';

describe('parseHtmlAttrs', () => {
  it('reads attributes in any order', () => {
    expect(parseHtmlAttrs('<!DOCTYPE html><html dir="rtl" class="x" lang="ur"><head>')).toEqual({
      dir: 'rtl',
      class: 'x',
      lang: 'ur',
    });
  });

  it('accepts single quotes', () => {
    const attrs = parseHtmlAttrs("<html lang='en' dir='ltr'>");
    expect(attrs?.lang).toBe('en');
    expect(attrs?.dir).toBe('ltr');
  });

  it('returns null when there is no html tag', () => {
    expect(parseHtmlAttrs('<div lang="en"></div>')).toBeNull();
  });

  it('does not match <htmlx>', () => {
    expect(parseHtmlAttrs('<htmlx lang="en">')).toBeNull();
  });
});

describe('hasLinkWithPrefix', () => {
  const html = '<a href="/ur">u</a><a href="/ur/a?b=1">v</a><a href="/urdu">w</a>';

  it('matches the prefix itself and nested paths or queries', () => {
    expect(hasLinkWithPrefix('<a href="/ur">x</a>', '/ur')).toBe(true);
    expect(hasLinkWithPrefix('<a href="/ur/a?b=1">x</a>', '/ur')).toBe(true);
    expect(hasLinkWithPrefix('<a href="/ur?x=1">x</a>', '/ur')).toBe(true);
    expect(hasLinkWithPrefix(html, '/ur')).toBe(true);
  });

  it('does not match a longer segment', () => {
    expect(hasLinkWithPrefix('<a href="/urdu">x</a>', '/ur')).toBe(false);
  });
});
