// Keyboard behaviour that only REAL key presses exercise.
//
//   node build.js && node keyboard-check.mjs        (exit 1 on any FAIL)
//
// An in-page smoke suite can dispatch a KeyboardEvent, but an untrusted event performs no default action: it does
// not move focus on Tab and does not move a native radio group's selection on an arrow key. Controls built on native
// behaviour therefore need puppeteer's keyboard, which sends trusted input. TASK-579's b-rating is the first: its
// stars are labels for native radios, so "one tab stop" and "arrow keys move and select" are the browser's doing,
// and only a real key press can show they survived the component around them.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const buf = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });

  /** Mount `<button>before</button>{markup}<button>after</button>` on top of the gallery and wait for b-rating. */
  const mount = (markup) => page.evaluate(async (m) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<button id="kb-before">before</button>${m}<button id="kb-after">after</button>`;
    document.body.prepend(host);
    window.__kbChanges = [];
    host.querySelector('b-rating')?.addEventListener('change', (e) => window.__kbChanges.push(e.detail.value));
    await customElements.whenDefined('b-rating');
    for (let i = 0; i < 50 && !host.querySelector('b-rating').shadowRoot?.querySelector('.stars'); i++) await new Promise((r) => setTimeout(r, 20));
  }, markup);
  /** What has focus, followed into shadow roots: `radio:<value>`, a button id, or a tag name. */
  const focused = () => page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'radio') return `radio:${el.value}`;
    return el?.id || el?.tagName.toLowerCase() || 'none';
  });
  const state = () => page.evaluate(() => ({ value: document.querySelector('#kb-host b-rating').value, changes: window.__kbChanges }));
  const focusBefore = () => page.evaluate(() => document.getElementById('kb-before').focus());

  // ── b-rating, unrated ──
  await mount('<b-rating name="stars" label="Your rating"></b-rating>');
  await focusBefore();
  await page.keyboard.press('Tab');
  check(`Tab enters an unrated rating on its first star (focus ${await focused()})`, (await focused()) === 'radio:1');
  await page.keyboard.press('Tab');
  check(`one tab stop: the next Tab leaves the rating (focus ${await focused()})`, (await focused()) === 'kb-after');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  check(`Shift+Tab comes back to the rating (focus ${await focused()})`, (await focused()).startsWith('radio:'));
  await page.keyboard.press('Space');
  check(`Space picks the focused star (value ${(await state()).value})`, (await state()).value === '1');
  await page.keyboard.press('ArrowRight');
  check(`ArrowRight moves to and picks the next star (value ${(await state()).value}, focus ${await focused()})`,
    (await state()).value === '2' && (await focused()) === 'radio:2');
  await page.keyboard.press('ArrowLeft');
  check(`ArrowLeft moves back (value ${(await state()).value})`, (await state()).value === '1');
  await page.keyboard.press('End');
  check(`End picks the last star (value ${(await state()).value}, focus ${await focused()})`, (await state()).value === '5' && (await focused()) === 'radio:5');
  await page.keyboard.press('Home');
  check(`Home picks the first star (value ${(await state()).value}, focus ${await focused()})`, (await state()).value === '1' && (await focused()) === 'radio:1');
  const { changes } = await state();
  check(`each pick fired one change (${JSON.stringify(changes)})`, JSON.stringify(changes) === JSON.stringify(['1', '2', '1', '5', '1']));

  // ── b-rating, rated: Tab lands on the chosen star ──
  await mount('<b-rating name="stars" value="3"></b-rating>');
  await focusBefore();
  await page.keyboard.press('Tab');
  check(`Tab enters a rated rating on the chosen star (focus ${await focused()})`, (await focused()) === 'radio:3');

  // ── b-rating, readonly: no tab stop ──
  await mount('<b-rating value="3" readonly></b-rating>');
  await focusBefore();
  await page.keyboard.press('Tab');
  check(`readonly has no tab stop: Tab goes straight past it (focus ${await focused()})`, (await focused()) === 'kb-after');

  // ── b-rating, hover (a real pointer, like the keys): previews on the operable group, never on a read-only one ──
  const filledFills = () => page.evaluate(() => [...document.querySelector('#kb-host b-rating').shadowRoot.querySelectorAll('.star svg')]
    .map((s) => getComputedStyle(s).fill !== 'none'));
  const hoverStar = async (n) => {
    const box = await page.evaluateHandle((i) => document.querySelector('#kb-host b-rating').shadowRoot.querySelectorAll('.star')[i], n - 1);
    await box.asElement().hover();
    await new Promise((r) => setTimeout(r, 50));
  };
  await mount('<b-rating value="2"></b-rating>');
  await hoverStar(4);
  check(`hovering star 4 of an operable rating previews four (${JSON.stringify(await filledFills())})`,
    JSON.stringify(await filledFills()) === JSON.stringify([true, true, true, true, false]));
  await mount('<b-rating value="2" readonly></b-rating>');
  await hoverStar(5);
  check(`hovering a read-only rating changes nothing (${JSON.stringify(await filledFills())})`,
    JSON.stringify(await filledFills()) === JSON.stringify([true, true, false, false, false]));
  await page.mouse.move(0, 400);

  // ── b-rating, disabled: no tab stop ──
  await mount('<b-rating value="3" disabled></b-rating>');
  await focusBefore();
  await page.keyboard.press('Tab');
  check(`disabled has no tab stop (focus ${await focused()})`, (await focused()) === 'kb-after');
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nkeyboard-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
