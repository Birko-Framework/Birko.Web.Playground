// Birko TASK-819 — Escape in an open select list inside a modal closes the LIST, not the modal. Found by Symbio TASK-1068:
// a multiple country pick in a b-modal form pressed Escape to close its list, and the <dialog> took the same keydown as
// `cancel` and closed, discarding the form. A real Playwright, real b-modal (showModal), one row per place focus can be:
//
//   node escape-in-modal-check.mjs        (exit 1 on any FAIL; no build needed)
//
// Playwright comes from the Reps ui-e2e suite, as in testing-smoke-check.mjs (BIRKO_PLAYWRIGHT overrides). Components and
// CountrySelectPO are bundled from the Birko\Web checkout under test (BIRKO_SRC overrides).
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
const dir = mkdtempSync(join(tmpdir(), 'birko-escape-modal-'));
const poOut = join(dir, 'po.mjs');
await build({
  entryPoints: [`${src}/Birko.Web.Testing/src/playwright/page-objects/country-select.ts`],
  bundle: true, format: 'esm', platform: 'node', outfile: poOut, logLevel: 'silent',
});
const { CountrySelectPO } = await import(pathToFileURL(poOut).href);

writeFileSync(join(dir, 'page.ts'), `
import 'birko-web-components';
const opts = ['Alpha', 'Beta', 'Gamma'].map((l) => ({ value: l.toLowerCase(), label: l }));
(document.querySelector('#single') as any).setOptions(opts);
(document.querySelector('#multi') as any).setOptions(opts);
(window as any).ready = true;
`);
const jsOut = join(dir, 'page.js');
await build({
  entryPoints: [join(dir, 'page.ts')], bundle: true, format: 'esm', platform: 'browser', outfile: jsOut,
  alias: birkoAliases(src), loader: { '.ts': 'ts', '.css': 'text' }, logLevel: 'silent',
});
const js = readFileSync(jsOut, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>
<button id="opener">open</button>
<b-modal id="m" title="Form">
  <b-select id="single" searchable label="Single"></b-select>
  <b-multi-select id="multi" searchable label="Multi"></b-multi-select>
  <b-country-select id="country" multiple label="Countries"></b-country-select>
</b-modal>
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

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => window.ready === true);

const modalOpen = () => page.evaluate(() => !!document.querySelector('#m').shadowRoot.querySelector('dialog')?.open);
const openModal = async () => {
  if (!(await modalOpen())) await page.evaluate(() => document.querySelector('#m').open());
  await page.waitForFunction(() => document.querySelector('#m').shadowRoot.querySelector('dialog')?.open);
};
const expanded = (sel) => page.locator(sel).getAttribute('aria-expanded');
const settle = () => page.waitForTimeout(250); // Chromium fires `close` ~150 ms after `cancel`

// One row per place an Escape can come from while a list is open.
const cases = [
  {
    name: 'b-select: Escape in the search box',
    open: () => page.locator('#single .combo').click(),
    isOpen: async () => (await expanded('#single .combo-input')) === 'true',
    press: () => page.locator('#single .combo-input').press('Escape'),
  },
  {
    name: 'b-multi-select: Escape on its box',
    open: () => page.locator('#multi .container').click(),
    isOpen: async () => (await expanded('#multi .container')) === 'true',
    press: () => page.locator('#multi .container').press('Escape'),
  },
  {
    name: 'b-multi-select: Escape in its search box',
    open: () => page.locator('#multi .container').click(),
    isOpen: async () => (await expanded('#multi .container')) === 'true',
    press: () => page.locator('#multi .dd-search').press('Escape'),
  },
  {
    name: 'b-multi-select: Escape on an option',
    open: () => page.locator('#multi .container').click(),
    isOpen: async () => (await expanded('#multi .container')) === 'true',
    press: () => page.locator('#multi label.option input[value="beta"]').press('Escape'),
  },
];

for (const c of cases) {
  await openModal();
  await c.open();
  const wasOpen = await c.isOpen();
  await c.press();
  await settle();
  check(`${c.name}: the list closes`, wasOpen && !(await c.isOpen()), `opened=${wasOpen}`);
  check(`${c.name}: the modal stays open`, await modalOpen());
}

// A closed list lets Escape through: the modal's own Escape still works.
await openModal();
await page.locator('#single .combo-input').focus();
await page.keyboard.press('Escape');
await settle();
check('with no list open, Escape still closes the modal', !(await modalOpen()));

// What Symbio's spec does: a multiple country pick inside the modal, then the form is still there.
await openModal();
const country = new CountrySelectPO(page);
let err = '';
try { await country.pick(page.locator('#country'), 'AQ', 'SK'); } catch (e) { err = String(e.message).split('\n')[0]; }
await settle();
check('CountrySelectPO: a multiple pick inside a modal resolves', err === '', err);
check('CountrySelectPO: the modal is still open after it', await modalOpen());
check('CountrySelectPO: the list is closed after it',
  (await page.locator('#country .country-control .container').getAttribute('aria-expanded')) === 'false');

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
server.close();
console.log(`\nescape-in-modal-check: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
