import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hasLinkWithPrefix, parseHtmlAttrs } from './lib/html-attrs.mjs';

// Live smoke for the public pages against a running server and a private test database.
// Usage: BASE_URL=http://127.0.0.1:3212 DATABASE_URL=postgres://.../shiplens_x_test \
//          node scripts/smoke-public.mjs
// The server under test must read the same DATABASE_URL. The script empties the events
// and content_entries tables first, so it refuses any database whose name does not end
// in _test. It seeds its own rows and removes them again in a finally block.

const base = process.env.BASE_URL;
const databaseUrl = process.env.DATABASE_URL;

/** Last path segment of a connection string, without the query string. */
function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return (url.split('?')[0] ?? '').split('/').pop() ?? '';
  }
}

if (!databaseUrl || !databaseName(databaseUrl).endsWith('_test')) {
  console.error('smoke-public refuses to run: DATABASE_URL must name a database ending in _test');
  process.exit(2);
}
if (!base) {
  console.error('BASE_URL env var is required');
  process.exit(2);
}

const MARK = {
  draft: 'SMOKE-DRAFT-TITLE',
  live: 'SMOKE-LIVE-TITLE',
  newer: 'SMOKE-NEWER-DRAFT',
  activeBranch: 'Smoke Active Branch',
  formingBranch: 'Smoke Forming Branch',
  event: 'Smoke Event',
  draftEvent: 'Smoke Draft Event',
};
const LIVE_BODY = '<script>alert(1)</script> hello';
const PAGES = [
  '',
  '/about',
  '/programs',
  '/branches',
  '/events',
  '/get-involved',
  '/contact',
  '/get-involved/apply',
  '/get-involved/apply/thanks',
];

let failed = false;
function report(ok, label, detail = '') {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail && !ok ? ` (${detail})` : ''}`);
}

async function page(path) {
  const res = await fetch(new URL(path, base), { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const suffix = randomUUID().slice(0, 8);
const slugs = [`smoke-event-${suffix}`, `smoke-draft-event-${suffix}`];

try {
  // Integration runs leave rows behind (about/en, about/ur) that would break the seeding
  // and the Urdu fallback check, so start from empty tables.
  await pool.query('DELETE FROM events');
  await pool.query('DELETE FROM content_entries');

  await pool.query(
    `INSERT INTO branches (code, name, city, status) VALUES
       ($1, $2, 'Smoke City', 'active'), ($3, $4, 'Smoke City', 'forming')`,
    [`SMK-A-${suffix}`, MARK.activeBranch, `SMK-F-${suffix}`, MARK.formingBranch],
  );
  await pool.query(
    `INSERT INTO content_entries (key, locale, title, body, status)
     VALUES ('about', 'en', $1, 'Draft body only.', 'draft')`,
    [MARK.draft],
  );

  let about = await page('/en/about');
  report(about.status === 200, '/en/about status', `got ${about.status}`);
  report(!about.html.includes(MARK.draft), '/en/about hides a draft-only entry');

  await pool.query(
    `UPDATE content_entries
     SET title = $1, body = $2, published_title = $1, published_body = $2,
         status = 'published', published_at = now(), updated_at = now()
     WHERE key = 'about' AND locale = 'en'`,
    [MARK.live, LIVE_BODY],
  );
  about = await page('/en/about');
  report(about.html.includes(MARK.live), '/en/about shows the published title');
  report(!about.html.includes('<script>alert(1)'), '/en/about does not render the injected script');

  await pool.query(
    `UPDATE content_entries SET title = $1, updated_at = now()
     WHERE key = 'about' AND locale = 'en'`,
    [MARK.newer],
  );
  about = await page('/en/about');
  report(about.html.includes(MARK.live), '/en/about keeps the published copy after a new draft');
  report(!about.html.includes(MARK.newer), '/en/about hides the newer draft');

  const urAbout = await page('/ur/about');
  report(urAbout.html.includes(MARK.live), '/ur/about falls back to the English title');
  report(
    /<article\b[^>]*\slang="en"/.test(urAbout.html),
    '/ur/about marks the fallback body lang="en"',
  );

  await pool.query(
    `UPDATE content_entries SET status = 'draft', updated_at = now()
     WHERE key = 'about' AND locale = 'en'`,
  );
  about = await page('/en/about');
  report(!about.html.includes(MARK.live), '/en/about drops the copy after unpublish');

  const branches = await page('/en/branches');
  report(branches.html.includes(MARK.activeBranch), '/en/branches lists the Active branch');
  report(!branches.html.includes(MARK.formingBranch), '/en/branches hides the Forming branch');

  const startsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  await pool.query(
    `INSERT INTO events (slug, title_en, location, starts_at, status, published_at,
                         published_title_en, published_location, published_starts_at)
     VALUES ($1, $2, 'Smoke Hall', $3, 'published', now(), $2, 'Smoke Hall', $3),
            ($4, $5, 'Smoke Hall', $3, 'draft', NULL, NULL, NULL, NULL)`,
    [slugs[0], MARK.event, startsAt, slugs[1], MARK.draftEvent],
  );
  const events = await page('/en/events');
  report(events.html.includes(MARK.event), '/en/events lists the published event');
  report(!events.html.includes(MARK.draftEvent), '/en/events hides the draft event');

  for (const [locale, dir] of [
    ['en', 'ltr'],
    ['ur', 'rtl'],
  ]) {
    for (const path of PAGES) {
      const url = `/${locale}${path}`;
      const { status, html } = await page(url);
      const attrs = parseHtmlAttrs(html);
      report(
        status === 200 && attrs?.lang === locale && attrs?.dir === dir,
        `${url} 200 lang="${locale}" dir="${dir}"`,
        `got ${status} lang=${attrs?.lang} dir=${attrs?.dir}`,
      );
      const other = locale === 'en' ? 'ur' : 'en';
      report(hasLinkWithPrefix(html, `/${other}`), `${url} language switcher links to /${other}`);
    }
  }
} catch (error) {
  report(false, 'smoke run', error instanceof Error ? error.message : String(error));
} finally {
  try {
    // Events reference branches, so they go first.
    await pool.query(`DELETE FROM events WHERE slug = ANY($1) OR title_en IN ($2, $3)`, [
      slugs,
      MARK.event,
      MARK.draftEvent,
    ]);
    await pool.query(`DELETE FROM content_entries WHERE key = 'about'`);
    await pool.query(`DELETE FROM branches WHERE name IN ($1, $2)`, [
      MARK.activeBranch,
      MARK.formingBranch,
    ]);
  } catch (error) {
    report(false, 'cleanup', error instanceof Error ? error.message : String(error));
  }
  await pool.end();
}

process.exit(failed ? 1 : 0);
