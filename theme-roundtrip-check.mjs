// Does a theme exported from the playground actually reproduce the previewed look in a REAL consumer?
//
//   npm run build && node theme-roundtrip-check.mjs
//
// This is TASK-038's last open criterion, and the one its own file called "the one criterion a
// headless harness cannot answer, since it needs a second app". That was a claim, not a measurement —
// and a second app is an HTML page, an esbuild invocation and the same alias map. So it is built here.
//
// What the criterion asks, in full: *"Export as a `[data-theme="my-brand"]` block; paste into a
// throwaway consumer + `registerThemes([{id:'my-brand',…}])` + link the file → the consumer matches
// the previewed look."* Every clause is exercised:
//
//   1. tokens are edited in the playground through their REAL controls (not by calling generateCss),
//   2. the *rendered* look is measured — painted properties off components' shadow roots, not just the
//      custom-property values, because "matches the previewed look" is about what a user sees,
//   3. the theme-mode export is read out of the export panel as a user would copy it,
//   4. a throwaway consumer is written, bundled against the same framework sources, and served,
//   5. it links the exported file and calls `registerThemes([{ id: 'my-brand', … }])`,
//   6. the same painted properties are measured there and must MATCH.
//
// ⚠ The control is the half that makes it a test. The consumer is measured TWICE — once without
// `data-theme="my-brand"` and once with it. Without the discriminator, an export that emitted nothing
// at all would pass: both sides would sit on the base tokens and compare equal. The unthemed pass must
// DIFFER from the preview and the themed pass must match it.
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer';
import { resolveBirkoWeb, birkoAliases } from './birko-src.mjs';

const BIRKO_SRC = resolveBirkoWeb();
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

/*
 * The tokens to edit, chosen to span the KINDS the export has to carry rather than three colours: a
 * colour (paints a background), a radius (a length that reaches a border), and a surface colour (a
 * different component's background). A theme that round-trips one colour and drops lengths would pass
 * a colour-only test.
 */
const EDITS = [
  ['--b-color-primary', '#ff00aa'],
  ['--b-radius', '13px'],
  ['--b-bg-secondary', '#0b3d2e'],
];

/*
 * The markup measured on BOTH sides. Identical strings, so any difference in the readings is the
 * theme and not the fixture.
 */
const FIXTURE = `
  <b-button id="rt-btn" variant="primary">Primary</b-button>
  <b-badge id="rt-badge" variant="primary">Badge</b-badge>
  <b-card id="rt-card"><span slot="header">Card</span>Body</b-card>
  <b-input id="rt-input" label="Field" value="x"></b-input>`;

/**
 * Reads the rendered look: painted properties off the elements the components actually draw, reached
 * through their shadow roots. Custom-property values are read too, but they are the weaker half — a
 * token can resolve correctly and still not be used by anything.
 */
const MEASURE = `() => {
  const paint = (sel, inner, props) => {
    const host = document.querySelector(sel);
    if (!host) return { missing: sel };
    const el = inner ? host.shadowRoot?.querySelector(inner) : host;
    if (!el) return { missing: sel + ' >> ' + inner };
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p).trim();
    return out;
  };
  const tokens = {};
  const probe = document.querySelector('#rt-btn');
  for (const t of ${JSON.stringify(EDITS.map(([n]) => n))}) {
    tokens[t] = probe ? getComputedStyle(probe).getPropertyValue(t).trim() : null;
  }
  return {
    tokens,
    button: paint('#rt-btn', 'button', ['background-color', 'border-radius']),
    badge:  paint('#rt-badge', 'span,div', ['background-color', 'border-radius']),
    card:   paint('#rt-card', '.card,div', ['background-color', 'border-radius']),
    input:  paint('#rt-input', 'input', ['border-radius']),
  };
}`;

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };

/** Serves a directory on a random port; returns { base, close }. */
async function serve(root) {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    try {
      const buf = readFileSync(join(root, normalize(p)));
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

// ── 1. Edit tokens in the playground and read the previewed look ────────────────────────────────
const pg = await serve('wwwroot');
const pgPage = await browser.newPage();
const pgErrors = [];
pgPage.on('pageerror', (e) => pgErrors.push(String(e)));
await pgPage.goto(pg.base, { waitUntil: 'networkidle0', timeout: 90_000 });

const preview = await pgPage.evaluate(async ({ edits, fixture, measureSrc }) => {
  // Build the fixture on-screen, in the page's own document, so it inherits exactly the token layer
  // the playground is previewing.
  const host = document.createElement('div');
  host.id = 'rt-probe';
  host.style.cssText = 'position:fixed;top:0;left:0;width:480px;z-index:99999';
  host.innerHTML = fixture;
  document.body.appendChild(host);
  await new Promise((r) => setTimeout(r, 500));

  const measure = eval(`(${measureSrc})`);
  const before = measure();

  // Drive the real controls, not the model: the wiring is the half that has broken here before.
  document.querySelector('#open-tokens')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const applied = [];
  for (const [name, value] of edits) {
    const row = [...document.querySelectorAll('#token-list .pg-token')].find((r) => r.dataset.name === name);
    if (!row) { applied.push({ name, found: false }); continue; }
    const input = row.querySelector('b-color-picker, b-input, b-select');
    input?.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true }));
    applied.push({ name, found: true });
  }
  await new Promise((r) => setTimeout(r, 400));
  const after = measure();

  // Export, theme shape, straight out of the panel the user copies from.
  const mode = document.querySelector('#export-mode');
  mode?.dispatchEvent(new CustomEvent('change', { detail: { value: 'theme' }, bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  document.querySelector('#export-btn')?.click();
  await new Promise((r) => setTimeout(r, 120));
  const css = document.querySelector('#export-out')?.textContent ?? '';

  document.querySelector('#rt-probe')?.remove();
  return { before, after, css, applied };
}, { edits: EDITS, fixture: FIXTURE, measureSrc: MEASURE });

await pgPage.close();
pg.close();

check('every token under test exists in the editor', preview.applied.every((a) => a.found),
  preview.applied.filter((a) => !a.found).map((a) => a.name).join(', ') || 'all found');
check('editing the tokens changes the previewed look',
  JSON.stringify(preview.before) !== JSON.stringify(preview.after),
  'the edits must actually repaint something, or the comparison below is vacuous');
check('the export is a [data-theme="my-brand"] block', preview.css.includes('[data-theme="my-brand"]'));
check('the export carries every edited token',
  EDITS.every(([n, v]) => preview.css.includes(n) && preview.css.includes(v)),
  EDITS.map(([n]) => `${n}${preview.css.includes(n) ? '' : ' MISSING'}`).join(' '));
check('no page errors in the playground', pgErrors.length === 0, pgErrors.join(' | '));

// ── 2. Build a throwaway consumer around that exported file ──────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'birko-theme-rt-'));
try {
  mkdirSync(join(dir, 'css'), { recursive: true });
  copyFileSync(`${BIRKO_SRC}/Birko.Web.Components/css/tokens.css`, join(dir, 'css/tokens.css'));
  copyFileSync(`${BIRKO_SRC}/Birko.Web.Components/css/reset.css`, join(dir, 'css/reset.css'));

  // The exported file, byte for byte as the panel produced it. Pasting it is the criterion.
  writeFileSync(join(dir, 'css/my-brand.theme.css'), preview.css);

  // A consumer bootstrap: import the components, register the theme, select it. Nothing
  // playground-specific — this is the snippet the export's own header comment tells a consumer to write.
  writeFileSync(join(dir, 'consumer.ts'), [
    "import 'birko-web-components';",
    "import { registerThemes, getRegisteredThemes } from 'birko-web-shell';",
    '',
    "registerThemes([{ id: 'my-brand', label: 'My Brand', icon: '\\u{1F3A8}' }]);",
    '',
    '// Exposed so the check can assert the registry actually took it — the criterion names',
    '// registerThemes() specifically, and a theme that paints but never appears in the switcher has',
    '// only half-arrived.',
    '(window as unknown as { __themes: () => unknown }).__themes = () => getRegisteredThemes();',
    '',
    "// The theme is applied only when asked for, so the unthemed control pass below is a real control.",
    "if (new URLSearchParams(location.search).has('themed')) {",
    "  document.documentElement.setAttribute('data-theme', 'my-brand');",
    '}',
    "document.documentElement.setAttribute('data-consumer-ready', '');",
  ].join('\n'));

  writeFileSync(join(dir, 'index.html'), [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Throwaway consumer</title>',
    '<link rel="stylesheet" href="css/reset.css">',
    '<link rel="stylesheet" href="css/tokens.css">',
    '<link rel="stylesheet" href="css/my-brand.theme.css">',
    '<script type="module" src="consumer.js"></script>',
    '</head><body>',
    FIXTURE,
    '</body></html>',
  ].join('\n'));

  await esbuild.build({
    entryPoints: [join(dir, 'consumer.ts')],
    bundle: true,
    outfile: join(dir, 'consumer.js'),
    format: 'esm',
    target: 'es2022',
    alias: birkoAliases(BIRKO_SRC),
    loader: { '.ts': 'ts', '.css': 'text' },
    logLevel: 'warning',
  });
  check('the throwaway consumer builds against the framework sources', true);

  // ── 3. Measure it, unthemed (the control) and themed (the criterion) ──────────────────────────
  const cs = await serve(dir);
  const readConsumer = async (themed) => {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${cs.base}${themed ? '?themed' : ''}`, { waitUntil: 'networkidle0', timeout: 90_000 });
    await page.waitForFunction('document.documentElement.hasAttribute("data-consumer-ready")', { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 500));
    const look = await page.evaluate(`(${MEASURE})()`);
    const themes = await page.evaluate('window.__themes ? window.__themes() : null');
    await page.close();
    return { look, themes, errs };
  };

  const plain = await readConsumer(false);
  const themedRun = await readConsumer(true);
  cs.close();

  check('the consumer has no page errors', plain.errs.length === 0 && themedRun.errs.length === 0,
    [...plain.errs, ...themedRun.errs].join(' | '));
  check('registerThemes() put my-brand in the registry',
    Array.isArray(themedRun.themes) && themedRun.themes.some((t) => t && t.id === 'my-brand'),
    JSON.stringify(themedRun.themes));
  check('light is still the base theme in the registry',
    Array.isArray(themedRun.themes) && themedRun.themes[0]?.id === 'light');

  // The control: linking the file is not enough — the block is scoped, so an unthemed consumer must
  // still look like the base. If this ever matches the preview, the export is leaking into :root.
  check('WITHOUT data-theme the consumer does NOT look like the preview (the block is scoped)',
    JSON.stringify(plain.look) !== JSON.stringify(preview.after),
    'if these matched, an empty export would pass the criterion below');

  // …and the criterion itself.
  const a = JSON.stringify(preview.after, null, 1);
  const b = JSON.stringify(themedRun.look, null, 1);
  check('WITH data-theme="my-brand" the consumer matches the previewed look', a === b);
  if (a !== b) {
    console.log('\n  preview:  ', JSON.stringify(preview.after));
    console.log('  consumer: ', JSON.stringify(themedRun.look));
  }

  // Say what moved, so a pass is readable rather than merely green.
  console.log('\n  edited tokens, as rendered in the consumer:');
  for (const [n] of EDITS) {
    console.log(`    ${n.padEnd(20)} base=${(plain.look.tokens[n] || '(unset)').padEnd(10)} themed=${themedRun.look.tokens[n]}`);
  }
  console.log(`    b-button background  base=${plain.look.button['background-color']}  themed=${themedRun.look.button['background-color']}`);
  console.log(`    b-button radius      base=${plain.look.button['border-radius']}  themed=${themedRun.look.button['border-radius']}`);
} finally {
  await browser.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leaked temp dir is not a failure */ }
}

console.log('');
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
console.log(failed
  ? `\nFAIL — ${failed} of ${checks.length}`
  : `\nPASS — ${checks.length}/${checks.length}: a theme exported from the playground reproduces the previewed look in a separate consumer app`);
process.exit(failed ? 1 : 0);
