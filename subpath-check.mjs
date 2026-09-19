// Serves the built playground from a SUBPATH and proves it still works there.
//
//   npm run build && node subpath-check.mjs
//
// Why this exists as its own check rather than a note in a commit message: the playground is
// published to a project GitHub Page at https://birko-framework.github.io/Birko.Web.Playground/, and
// everything that makes a subpath deploy fail is invisible when you serve wwwroot/ at the web root
// locally. A root-absolute `/manifest.webmanifest`, a `registerServiceWorker('/sw.js')`, a precache
// list of `/index.html` — all of them work perfectly at the root and 404 one directory down. The
// service worker is the worst of the three: `addAll` rejects, the install step fails, and the app
// silently has no offline shell while looking entirely healthy.
//
// So this serves under a deliberately awkward prefix, loads the page headlessly, and fails on any
// request that 404s or any console error. `verify.mjs` cannot catch these — it serves at the root,
// which is exactly the configuration that hides them.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
// Not '/playground/': the real deploy path has dots in it, which is the shape most likely to trip a
// naive prefix strip or a path-joining assumption.
const PREFIX = '/Birko.Web.Playground';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const served = [];
const server = http.createServer(async (req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  let p = raw;

  // Anything outside the prefix is a 404 here exactly as it would be on GitHub Pages, where the
  // rest of the origin belongs to other repositories. That is the point of the check.
  if (!p.startsWith(PREFIX + '/') && p !== PREFIX) {
    served.push({ url: raw, status: 404 });
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found (outside the project page prefix)');
    return;
  }

  p = p.slice(PREFIX.length) || '/';
  if (p === '/') p = '/index.html';

  try {
    const buf = await readFile(join(ROOT, normalize(p)));
    served.push({ url: raw, status: 200 });
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    served.push({ url: raw, status: 404 });
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}/`;
console.log(`serving wwwroot/ at ${base}`);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle0' });

// Register the worker through the app's own button, so this exercises the path the app actually
// uses rather than a URL this file made up.
const swMessage = await page.evaluate(async () => {
  // The gallery builds each category lazily, on the nav switcher's 'change' — so the card holding
  // the SW button does not exist until its section is populated. verify.mjs forces every section the
  // same way; doing it here too is what lets this check drive the app's own button rather than
  // inventing a URL of its own, which would test this file instead of the app.
  const nav = document.querySelector('#pg-nav');
  const gallery = document.querySelector('#pg-gallery');
  for (const sec of gallery?.querySelectorAll(':scope > .pg-grid') ?? []) {
    nav?.dispatchEvent(new CustomEvent('change', { detail: { value: sec.dataset.cat }, bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 400));

  const btn = document.querySelector('[data-act="sw-on"]');
  if (!btn) return 'NO BUTTON';
  btn.click();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) return 'registered';
  }
  return 'TIMED OUT';
});

// Give the install step time to run addAll(), which is where a wrong precache path surfaces.
await new Promise((r) => setTimeout(r, 1500));

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  if (names.length === 0) return { names, entries: [] };
  const cache = await caches.open(names[0]);
  return { names, entries: (await cache.keys()).map((r) => new URL(r.url).pathname) };
});

await browser.close();
server.close();

const notFound = served.filter((s) => s.status === 404);
const problems = [];
if (notFound.length) problems.push(`${notFound.length} request(s) 404ed: ${notFound.map((n) => n.url).join(', ')}`);
if (consoleErrors.length) problems.push(`${consoleErrors.length} console error(s): ${consoleErrors.join(' | ')}`);
if (swMessage !== 'registered') problems.push(`service worker did not register (${swMessage})`);
if (cached.entries.length === 0) problems.push('the service worker cached nothing — its precache list did not resolve');
for (const entry of cached.entries) {
  if (!entry.startsWith(PREFIX + '/')) problems.push(`cached outside the app: ${entry}`);
}

console.log(`\nrequests served: ${served.length} (${notFound.length} not found)`);
console.log(`service worker:  ${swMessage}`);
console.log(`precached:       ${cached.entries.length} entr(ies)`);
for (const e of cached.entries) console.log(`                 ${e}`);

if (problems.length) {
  console.error('\nFAIL');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nPASS — the app works served from a subpath');
