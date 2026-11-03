// Birko TASK-809 — Birko.Web.Testing's runSmoke driven by a REAL Playwright, against pages where a page's text also
// sits earlier in the DOM, hidden, as the category ribbon's ▾ menus keep every page label since v0.4.1:
//
//   node testing-smoke-check.mjs        (exit 1 on any FAIL; no build needed)
//
// runSmoke takes the consumer's `test` and `expect`; here `test` only collects the bodies and runs them with a page,
// and `expect` is Playwright's own. Playwright comes from the Reps ui-e2e suite, as in webkit-check.mjs (set
// BIRKO_PLAYWRIGHT to another `playwright/index.mjs`); `@playwright/test` is resolved beside it.
import http from 'node:http';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { resolveBirkoWeb } from './birko-src.mjs';

const PLAYWRIGHT = resolve(
  process.env.BIRKO_PLAYWRIGHT
    ?? '../../Consumers/WorkoutTracker/Reps.Web/tests/ui-e2e/node_modules/playwright/index.mjs',
);
const PW_TEST = join(dirname(dirname(PLAYWRIGHT)), '@playwright', 'test', 'index.mjs');
if (!existsSync(PLAYWRIGHT) || !existsSync(PW_TEST)) {
  console.error(`Cannot find Playwright (${PLAYWRIGHT}) and @playwright/test beside it. Set BIRKO_PLAYWRIGHT.`);
  process.exit(1);
}
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
const { expect: pwExpect } = await import(pathToFileURL(PW_TEST).href);
const expect = pwExpect.configure({ timeout: 1500 });

// The library's own smoke runner, bundled from the Birko\Web checkout under test.
const out = join(tmpdir(), `birko-testing-smoke-${process.pid}.mjs`);
await build({
  entryPoints: [`${resolveBirkoWeb()}/Birko.Web.Testing/src/playwright/smoke.ts`],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
});
const { runSmoke } = await import(pathToFileURL(out).href);

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;
const PAGES = {
  // A hidden ribbon menu first, the page's heading after it: what Symbio's Communication dashboard renders.
  '/both': page('<nav><div class="ribbon-menu" hidden><span class="ribbon-menu-label">Inquiries</span>'
    + '<span class="pg-title">Menu</span></div></nav><main><h1 class="pg-title">Inquiries</h1></main>'),
  // Only the hidden copy: the page did not render its heading.
  '/hidden': page('<nav><div hidden><span class="ribbon-menu-label">Inquiries</span><h1 class="pg-title">x</h1></div></nav><main></main>'),
};
const server = http.createServer((req, res) => {
  const html = PAGES[req.url];
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html' });
  res.end(html ?? 'nope');
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
runSmoke(test, expect, [
  { label: 'text', path: `${base}/both`, mustSee: ['Inquiries'] },
  { label: 'selector', path: `${base}/both`, expectSelector: '.pg-title' },
  { label: 'text hidden only', path: `${base}/hidden`, mustSee: ['Inquiries'] },
  { label: 'selector hidden only', path: `${base}/hidden`, expectSelector: '.pg-title' },
], { settleMs: 0 });

const browser = await chromium.launch();
const results = {};
for (const t of tests) {
  const p = await browser.newPage();
  try { await t.fn({ page: p }); results[t.name] = 'pass'; } catch (e) { results[t.name] = `fail: ${String(e.message).split('\n')[0]}`; }
  await p.close();
}
await browser.close();
server.close();

let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const r = (label) => Object.entries(results).find(([n]) => n.startsWith(`smoke: ${label}  `))?.[1] ?? 'missing';
check(`mustSee finds the visible text when a hidden copy comes first (${r('text')})`, r('text') === 'pass');
check(`expectSelector finds the visible match when a hidden one comes first (${r('selector')})`, r('selector') === 'pass');
check(`mustSee still fails when the text is only hidden (${r('text hidden only')})`, r('text hidden only').startsWith('fail'));
check(`expectSelector still fails when the only match is hidden (${r('selector hidden only')})`, r('selector hidden only').startsWith('fail'));
console.log(`\ntesting-smoke-check: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
