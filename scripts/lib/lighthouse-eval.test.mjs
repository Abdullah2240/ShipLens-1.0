import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  PAGES,
  LOCALES,
  buildTargets,
  evaluate,
  parseLighthouseArgs,
  summarise,
} from './lighthouse-eval.mjs';

function audit(id, score, extra = {}) {
  return { id, title: `Title of ${id}`, score, scoreDisplayMode: 'binary', ...extra };
}

/** A trimmed Lighthouse result with the fields the evaluator reads. */
function fixtureLhr() {
  return {
    finalDisplayedUrl: 'http://localhost:60320/en/about',
    categories: {
      performance: {
        score: 0.95,
        auditRefs: [
          { id: 'largest-contentful-paint', weight: 25 },
          { id: 'total-blocking-time', weight: 30 },
        ],
      },
      accessibility: {
        score: 0.89,
        auditRefs: [
          { id: 'color-contrast', weight: 7 },
          { id: 'link-name', weight: 7 },
          { id: 'heading-order', weight: 3 },
          { id: 'html-has-lang', weight: 7 },
        ],
      },
      'best-practices': { score: 1, auditRefs: [{ id: 'errors-in-console', weight: 1 }] },
      seo: { score: 0.92, auditRefs: [{ id: 'canonical', weight: 1 }] },
    },
    audits: {
      'largest-contentful-paint': audit('largest-contentful-paint', 0.5, {
        scoreDisplayMode: 'numeric',
      }),
      'total-blocking-time': audit('total-blocking-time', 1, { scoreDisplayMode: 'numeric' }),
      'color-contrast': audit('color-contrast', 0),
      'link-name': audit('link-name', 1),
      'heading-order': audit('heading-order', 0),
      'html-has-lang': audit('html-has-lang', null, { scoreDisplayMode: 'notApplicable' }),
      'errors-in-console': audit('errors-in-console', 1),
      canonical: audit('canonical', 0),
    },
  };
}

describe('evaluate', () => {
  it('lists the four categories in a fixed order', () => {
    expect(CATEGORIES).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);
  });

  it('fails a result with one category under the floor and names it', () => {
    const result = evaluate(fixtureLhr());
    expect(result.url).toBe('http://localhost:60320/en/about');
    expect(result.scores).toEqual({
      performance: 0.95,
      accessibility: 0.89,
      'best-practices': 1,
      seo: 0.92,
    });
    expect(result.pass).toBe(false);
    expect(result.failing).toEqual(['accessibility']);
  });

  it('lists audits under 0.9 by weight, skipping passed and not applicable ones', () => {
    const { topAudits } = evaluate(fixtureLhr());
    expect(topAudits.map((a) => a.id)).toEqual([
      'largest-contentful-paint',
      'color-contrast',
      'heading-order',
      'canonical',
    ]);
    expect(topAudits[1]).toEqual({
      id: 'color-contrast',
      title: 'Title of color-contrast',
      score: 0,
    });
  });

  it('passes when every category meets the floor, and honours a custom floor', () => {
    const lhr = fixtureLhr();
    lhr.categories.accessibility.score = 0.9;
    expect(evaluate(lhr).pass).toBe(true);
    expect(evaluate(lhr, 0.93)).toMatchObject({ pass: false, failing: ['accessibility', 'seo'] });
  });

  it('treats a missing or null category score as a failure', () => {
    const lhr = fixtureLhr();
    delete lhr.categories.seo;
    lhr.categories.performance.score = null;
    const result = evaluate(lhr);
    expect(result.scores.seo).toBe(0);
    expect(result.scores.performance).toBe(0);
    expect(result.failing).toEqual(['performance', 'accessibility', 'seo']);
  });

  it('falls back to finalUrl and requestedUrl for older results', () => {
    const lhr = fixtureLhr();
    delete lhr.finalDisplayedUrl;
    expect(evaluate({ ...lhr, finalUrl: 'http://x/en' }).url).toBe('http://x/en');
    expect(evaluate({ ...lhr, requestedUrl: 'http://y/ur' }).url).toBe('http://y/ur');
  });
});

describe('summarise', () => {
  it('renders a stable markdown table with whole-number scores', () => {
    const rows = [
      {
        page: '',
        locale: 'en',
        scores: { performance: 0.95, accessibility: 1, 'best-practices': 1, seo: 1 },
        pass: true,
      },
      {
        page: 'get-involved/apply',
        locale: 'ur',
        scores: { performance: 0.876, accessibility: 0.9, 'best-practices': 1, seo: 0.92 },
        pass: false,
      },
    ];
    expect(summarise(rows)).toBe(
      [
        '| Page | Locale | Performance | Accessibility | Best practices | SEO | Pass |',
        '| --- | --- | ---: | ---: | ---: | ---: | --- |',
        '| / | en | 95 | 100 | 100 | 100 | yes |',
        '| /get-involved/apply | ur | 88 | 90 | 100 | 92 | NO |',
      ].join('\n'),
    );
    expect(summarise(rows)).toBe(summarise(rows));
  });
});

describe('targets and arguments', () => {
  it('builds 18 urls, nine pages in each locale', () => {
    expect(PAGES).toEqual([
      '',
      'about',
      'programs',
      'branches',
      'events',
      'get-involved',
      'get-involved/apply',
      'contact',
      'impact',
    ]);
    expect(LOCALES).toEqual(['en', 'ur']);
    const targets = buildTargets('http://localhost:60320/');
    expect(targets).toHaveLength(18);
    expect(targets[0]).toEqual({ locale: 'en', page: '', url: 'http://localhost:60320/en' });
    expect(targets.at(-1)).toEqual({
      locale: 'ur',
      page: 'impact',
      url: 'http://localhost:60320/ur/impact',
    });
  });

  it('narrows to one path with --only', () => {
    expect(buildTargets('http://h', '/en/impact')).toEqual([
      { locale: 'en', page: 'impact', url: 'http://h/en/impact' },
    ]);
    expect(buildTargets('http://h', '/ur')).toEqual([
      { locale: 'ur', page: '', url: 'http://h/ur' },
    ]);
    expect(() => buildTargets('http://h', '/en/nope')).toThrow(/--only/);
  });

  it('parses the command line', () => {
    expect(parseLighthouseArgs(['--base-url', 'http://localhost:60320'])).toEqual({
      baseUrl: 'http://localhost:60320',
      only: undefined,
      formFactor: 'mobile',
    });
    expect(
      parseLighthouseArgs([
        '--base-url=http://h/',
        '--only',
        '/ur/events',
        '--form-factor',
        'desktop',
      ]),
    ).toEqual({ baseUrl: 'http://h', only: '/ur/events', formFactor: 'desktop' });
    expect(() => parseLighthouseArgs([])).toThrow(/--base-url/);
    expect(() => parseLighthouseArgs(['--base-url', 'http://h', '--form-factor', 'tv'])).toThrow(
      /form-factor/,
    );
  });
});
