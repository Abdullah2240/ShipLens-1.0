import { hasLinkWithPrefix, parseHtmlAttrs } from './lib/html-attrs.mjs';

// Usage: BASE_URL=http://127.0.0.1:3000 node scripts/check-page.mjs <path:lang:dir[:status]>... [--switcher] [--root-redirect]

const base = process.env.BASE_URL;
if (!base) {
  console.error('BASE_URL env var is required');
  process.exit(2);
}

const args = process.argv.slice(2);
const switcher = args.includes('--switcher');
const rootRedirect = args.includes('--root-redirect');
const specs = args.filter((a) => !a.startsWith('--'));

let failed = false;
function report(ok, label, detail = '') {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
}

for (const spec of specs) {
  const [path, lang, dir, status = '200'] = spec.split(':');
  const res = await fetch(new URL(path, base), { redirect: 'manual' });
  report(String(res.status) === status, `${path} status`, `got ${res.status}, want ${status}`);
  const html = await res.text();
  const attrs = parseHtmlAttrs(html);
  report(attrs?.lang === lang, `${path} lang`, `got ${attrs?.lang}, want ${lang}`);
  report(attrs?.dir === dir, `${path} dir`, `got ${attrs?.dir}, want ${dir}`);
  if (switcher) {
    const other = lang === 'en' ? 'ur' : 'en';
    report(hasLinkWithPrefix(html, `/${other}`), `${path} switcher link to /${other}`);
  }
}

if (rootRedirect) {
  const res = await fetch(new URL('/', base), { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  const path = location.startsWith('http') ? new URL(location).pathname : location;
  const ok =
    res.status >= 300 && res.status < 400 && (path.startsWith('/en') || path.startsWith('/ur'));
  report(ok, '/ redirects to a locale', `status ${res.status}, location ${location}`);
}

process.exit(failed ? 1 : 0);
