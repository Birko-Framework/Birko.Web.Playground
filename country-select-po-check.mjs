// Birko TASK-818 — Birko.Web.Testing's CountrySelectPO driven by a REAL Playwright against a real b-country-select,
// single and `multiple`, inside a b-form (picked by its field path) and on its own (picked by a locator):
//
//   node country-select-po-check.mjs        (exit 1 on any FAIL; no build needed)
//
// Playwright comes from the Reps ui-e2e suite, as in testing-smoke-check.mjs (set BIRKO_PLAYWRIGHT to another
// `playwright/index.mjs`). The page object and the components are bundled from the Birko\Web checkout under test.
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { resolveBirkoWeb, birkoAliases } from './birko-src.mjs';

const PLAYWRIGHT = resolve(
  process.env.BIRKO_PLAYWRIGHT
    ?? '../../Consumers/WorkoutTracker/Reps.Web/tests/ui-e2e/node_modules/playwright/index.mjs',
);
if (!existsSync(PLAYWRIGHT)) {
  console.error(`Cannot find Playwright (${PLAYWRIGHT}). Set BIRKO_PLAYWRIGHT.`);
  process.exit(1);
}
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);

const src = resolveBirkoWeb();
const dir = mkdtempSync(join(tmpdir(), 'birko-country-po-'));

// The page object, for node. Only its type import names @playwright/test, which esbuild drops.
const poOut = join(dir, 'po.mjs');
await build({
  entryPoints: [`${src}/Birko.Web.Testing/src/playwright/page-objects/country-select.ts`],
  bundle: true, format: 'esm', platform: 'node', outfile: poOut, logLevel: 'silent',
});
const { CountrySelectPO } = await import(pathToFileURL(poOut).href);

// The components, for the browser: a b-form with a single and a multiple country field, and a picker on its own.
writeFileSync(join(dir, 'page.ts'), `
import 'birko-web-components';
const form = document.querySelector('b-form') as any;
form.setSchema({ name: 'root', children: [
  { name: 'address', children: [{ name: 'country', type: 'country', label: 'Country' }] },
  { name: 'availability', children: [{ name: 'allowedCountries', type: 'country', multiple: true, label: 'Allowed' }] },
]});
(window as any).ready = true;
`);
const jsOut = join(dir, 'page.js');
await build({
  entryPoints: [join(dir, 'page.ts')], bundle: true, format: 'esm', platform: 'browser', outfile: jsOut,
  alias: birkoAliases(src), loader: { '.ts': 'ts', '.css': 'text' }, logLevel: 'silent',
});
const js = readFileSync(jsOut, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>
<b-form></b-form>
<b-country-select id="standalone" multiple countries="SK,CZ,AT"></b-country-select>
<script type="module" src="/page.js"></script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/page.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(js); return; }
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const errorOf = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message).split('\n')[0]; } };

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.goto(base);
await page.waitForFunction(() => window.ready === true, null, { timeout: 5000 });
const country = new CountrySelectPO(page);

// 1. Single, by field path — what Symbio's customers specs call.
let err = await errorOf(() => country.pick('address.country', 'SK'));
check('single: pick("address.country", "SK") resolves', err === '', err);
check('single: the picker holds SK', (await country.value('address.country')) === 'SK');
check('single: the form collects it', await page.evaluate(() =>
  document.querySelector('b-form').getValues().address?.country === 'SK'));

// 2. Single again: a second pick replaces the first (lower case accepted).
err = await errorOf(() => country.pick('address.country', 'cz'));
check('single: a second pick replaces the first', err === '' && (await country.value('address.country')) === 'CZ', err);

// 3. Multiple, by field path — Symbio's shipping-methods spec picks AQ.
err = await errorOf(() => country.pick('availability.allowedCountries', 'AQ'));
check('multiple: pick("availability.allowedCountries", "AQ") resolves', err === '', err);
err = await errorOf(() => country.pick('availability.allowedCountries', 'SK', 'AT'));
const multi = (await country.value('availability.allowedCountries')).split(',').sort().join(',');
check('multiple: further picks add to the selection', err === '' && multi === 'AQ,AT,SK', err || multi);
check('multiple: the form collects all three', await page.evaluate(() => {
  const v = document.querySelector('b-form').getValues().availability?.allowedCountries;
  return Array.isArray(v) ? [...v].sort().join(',') === 'AQ,AT,SK' : String(v).split(',').sort().join(',') === 'AQ,AT,SK';
}));
check('multiple: the dropdown is closed after the pick (nothing covers the next control)', await page.locator(
  'b-form [data-field="availability.allowedCountries"] b-country-select .country-control .container').first()
  .getAttribute('aria-expanded') === 'false');
err = await errorOf(() => country.pick('availability.allowedCountries', 'SK'));
check('multiple: picking a selected code keeps it (does not toggle it off)', err === ''
  && (await country.value('availability.allowedCountries')).split(',').includes('SK'), err);

// 4. By locator, with a restricted list.
const standalone = page.locator('#standalone');
err = await errorOf(() => country.pick(standalone, 'CZ'));
check('locator: a picker on its own is picked through its locator', err === '' && (await country.value(standalone)) === 'CZ', err);

// 5. Loud failures, fast.
let t0 = Date.now();
err = await errorOf(() => country.pick(standalone, 'DE'));
check('a code outside `countries` fails with "does not offer"', err.includes('does not offer "DE"'), `${err}, ${Date.now() - t0} ms`);
t0 = Date.now();
err = await errorOf(() => country.pick('address.country', 'XB'));
check('a non-ISO code fails with "does not offer"', err.includes('does not offer "XB"'), `${err}, ${Date.now() - t0} ms`);
err = await errorOf(() => country.pick('address.country', 'SK', 'CZ'));
check('two codes for a single picker are refused', err.includes('for a single picker'), err);
err = await errorOf(() => country.pick('address.country'));
check('no code is refused', err.includes('no country code'), err);

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();
console.log(`\ncountry-select-po-check: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
