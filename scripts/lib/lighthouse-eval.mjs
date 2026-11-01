// Pure helpers for scripts/lighthouse.mjs: which pages to measure, how to read one
// Lighthouse JSON result against a score floor, and how to print the summary table.

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
export const LOCALES = ['en', 'ur'];
export const PAGES = [
  '',
  'about',
  'programs',
  'branches',
  'events',
  'get-involved',
  'get-involved/apply',
  'contact',
  'impact',
];
export const FORM_FACTORS = ['mobile', 'desktop'];
export const DEFAULT_FLOOR = 0.9;

const LABELS = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best practices',
  seo: 'SEO',
};
const SKIPPED_MODES = new Set(['notApplicable', 'informative', 'manual', 'error']);

/**
 * Reads one Lighthouse result (LHR) against a floor.
 * @param {any} lhr
 * @param {number} [floor]
 * @returns {{ url: string, scores: Record<string, number>, pass: boolean, failing: string[], topAudits: { id: string, title: string, score: number }[] }}
 */
export function evaluate(lhr, floor = DEFAULT_FLOOR) {
  const url = lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl ?? '';
  const scores = {};
  for (const id of CATEGORIES) {
    const score = lhr.categories?.[id]?.score;
    scores[id] = typeof score === 'number' ? score : 0;
  }
  const failing = CATEGORIES.filter((id) => scores[id] < floor);

  // Highest weight across categories, so a shared audit is listed once.
  const weights = new Map();
  for (const id of CATEGORIES) {
    for (const ref of lhr.categories?.[id]?.auditRefs ?? []) {
      weights.set(ref.id, Math.max(weights.get(ref.id) ?? 0, ref.weight ?? 0));
    }
  }
  const topAudits = [...weights.entries()]
    .map(([id, weight]) => ({ audit: lhr.audits?.[id], weight }))
    .filter(
      ({ audit }) =>
        audit &&
        !SKIPPED_MODES.has(audit.scoreDisplayMode) &&
        typeof audit.score === 'number' &&
        audit.score < 0.9,
    )
    .sort((a, b) => b.weight - a.weight)
    .map(({ audit }) => ({ id: audit.id, title: audit.title, score: audit.score }));

  return { url, scores, pass: failing.length === 0, failing, topAudits };
}

/**
 * Markdown table, one row per measured page, in the order given.
 * @param {{ page: string, locale: string, scores: Record<string, number>, pass: boolean }[]} results
 */
export function summarise(results) {
  const header = `| Page | Locale | ${CATEGORIES.map((id) => LABELS[id]).join(' | ')} | Pass |`;
  const rule = `| --- | --- | ${CATEGORIES.map(() => '---:').join(' | ')} | --- |`;
  const rows = results.map(
    (r) =>
      `| /${r.page} | ${r.locale} | ${CATEGORIES.map((id) => Math.round((r.scores[id] ?? 0) * 100)).join(' | ')} | ${r.pass ? 'yes' : 'NO'} |`,
  );
  return [header, rule, ...rows].join('\n');
}

/**
 * Every page in every locale, or the one path named by `only` (for example `/en/impact`).
 * @param {string} baseUrl
 * @param {string} [only]
 */
export function buildTargets(baseUrl, only) {
  const base = baseUrl.replace(/\/+$/, '');
  const all = LOCALES.flatMap((locale) =>
    PAGES.map((page) => ({ locale, page, url: `${base}/${locale}${page ? `/${page}` : ''}` })),
  );
  if (only === undefined) return all;
  const wanted = `/${only.replace(/^\/+|\/+$/g, '')}`;
  const match = all.filter((t) => `/${t.locale}${t.page ? `/${t.page}` : ''}` === wanted);
  if (match.length === 0) throw new Error(`--only ${only} is not a measured public page`);
  return match;
}

/** @param {string[]} argv */
export function parseLighthouseArgs(argv) {
  let baseUrl;
  let only;
  let formFactor = 'mobile';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [name, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? argv[(i += 1)];
    if (name === '--base-url') baseUrl = value();
    else if (name === '--only') only = value();
    else if (name === '--form-factor') formFactor = value();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!baseUrl || !/^https?:\/\/[^/\s]+/.test(baseUrl)) {
    throw new Error('--base-url needs an http(s) URL');
  }
  if (!FORM_FACTORS.includes(formFactor)) {
    throw new Error('--form-factor must be mobile or desktop');
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), only, formFactor };
}
