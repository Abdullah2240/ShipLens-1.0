// Lighthouse over every public page in English and Urdu, one page at a time, with a
// 0.90 floor in performance, accessibility, best practices and SEO.
//
//   node scripts/lighthouse.mjs --base-url http://localhost:60320
//   node scripts/lighthouse.mjs --base-url <url> --only /en/impact
//   node scripts/lighthouse.mjs --base-url <url> --form-factor desktop
//
// Point it at the production build (the E2E Docker stack), never at `next dev`.
// Lighthouse is not a project dependency: it runs through a pinned `npx` call and
// drives the Chromium that the Playwright install already provides. Mobile results go
// to test-results/lighthouse/<locale>-<page>.json, desktop results to
// test-results/lighthouse/desktop/, each with a summary.md. Exits 1 when any category
// of any page scores under the floor.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildTargets,
  CATEGORIES,
  DEFAULT_FLOOR,
  evaluate,
  parseLighthouseArgs,
  summarise,
} from './lib/lighthouse-eval.mjs';

export const LIGHTHOUSE_VERSION = '13.6.0';
const OUT_DIR = path.join('test-results', 'lighthouse');

/** Quotes one argument for the platform shell that runs `npx`. */
function shellQuote(arg) {
  if (process.platform === 'win32')
    return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function lighthouseArgs(url, formFactor) {
  return [
    '-y',
    `lighthouse@${LIGHTHOUSE_VERSION}`,
    url,
    '--quiet',
    '--output=json',
    '--output-path=stdout',
    `--only-categories=${CATEGORIES.join(',')}`,
    '--chrome-flags=--headless=new --no-sandbox',
    ...(formFactor === 'desktop' ? ['--preset=desktop'] : []),
  ];
}

/** Runs one Lighthouse audit and resolves with the parsed result. */
function runLighthouse(url, formFactor, chromePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', lighthouseArgs(url, formFactor).map(shellQuote), {
      shell: true,
      env: { ...process.env, CHROME_PATH: chromePath },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (code !== 0) return reject(new Error(`lighthouse exited with ${code} for ${url}`));
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`lighthouse printed no JSON for ${url}: ${error.message}`));
      }
    });
  });
}

const slug = (page) => (page ? page.replace(/\//g, '-') : 'home');

async function main(argv) {
  const { baseUrl, only, formFactor } = parseLighthouseArgs(argv);
  const targets = buildTargets(baseUrl, only);
  const { chromium } = await import('@playwright/test');
  const chromePath = chromium.executablePath();
  const outDir = formFactor === 'desktop' ? path.join(OUT_DIR, 'desktop') : OUT_DIR;
  mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const target of targets) {
    console.log(`lighthouse ${formFactor} ${target.url}`);
    let row;
    try {
      const lhr = await runLighthouse(target.url, formFactor, chromePath);
      writeFileSync(
        path.join(outDir, `${target.locale}-${slug(target.page)}.json`),
        JSON.stringify(lhr),
      );
      row = { ...target, ...evaluate(lhr, DEFAULT_FLOOR) };
    } catch (error) {
      console.error(error.message);
      row = {
        ...target,
        scores: Object.fromEntries(CATEGORIES.map((id) => [id, 0])),
        pass: false,
        failing: [...CATEGORIES],
        topAudits: [],
      };
    }
    results.push(row);
    const scores = CATEGORIES.map((id) => `${id} ${Math.round(row.scores[id] * 100)}`).join(', ');
    console.log(`  ${row.pass ? 'pass' : 'FAIL'}: ${scores}`);
    for (const audit of row.pass ? [] : row.topAudits.slice(0, 8)) {
      console.log(`    - ${audit.id} (${audit.score}): ${audit.title}`);
    }
  }

  const table = summarise(results);
  writeFileSync(
    path.join(outDir, 'summary.md'),
    `# Lighthouse ${LIGHTHOUSE_VERSION} (${formFactor}) against ${baseUrl}\n\n${table}\n`,
  );
  console.log(`\n${table}`);
  return results.every((r) => r.pass) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
}
