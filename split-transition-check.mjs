// Birko TASK-979 (asked for by DraCode TASK-058) — b-split-panel's column change can animate, opt-in. DraCode widens
// its chat panel by setting `sizes` and used to animate its own grid; the grid now lives in the panel's shadow root.
// Checked with a real mouse and Chrome's computed styles:
//   - no animation by default (0s); `--b-split-transition` turns it on, and a `sizes` change then animates;
//   - a pointer drag of the separator is not animated (the column follows the pointer), nor is the drag's end;
//   - `prefers-reduced-motion: reduce` turns it off even when the app set the variable.
//
//   node build.js && node split-transition-check.mjs        (exit 1 on any FAIL)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launchBrowser } from './launch-browser.mjs';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!customElements.get('b-split-panel'));

  /** A fresh panel at the top of the page; `transition` is the app's --b-split-transition, or none. */
  const mount = (transition) => page.evaluate((transition) => {
    document.getElementById('st-host')?.remove();
    const host = document.createElement('div');
    host.id = 'st-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;padding:20px;width:1000px';
    host.innerHTML = `<b-split-panel id="st" resizable master-width="1fr" detail-width="300px" gap="20px"
      static-detail ${transition ? `style="--b-split-transition:${transition}"` : ''}>
      <div slot="master" style="height:200px;background:#eef">master</div>
      <div slot="detail" style="height:200px;background:#fee">detail</div></b-split-panel>`;
    document.body.appendChild(host);
  }, transition);
  const state = () => page.evaluate(() => {
    const el = document.getElementById('st');
    const split = el.shadowRoot.querySelector('.split');
    const cs = getComputedStyle(split);
    const r = el.shadowRoot.querySelector('.resizer').getBoundingClientRect();
    return { duration: cs.transitionDuration, property: cs.transitionProperty, cols: cs.gridTemplateColumns,
      detailW: el.shadowRoot.querySelector('.detail').getBoundingClientRect().width,
      masterW: el.shadowRoot.querySelector('.master').getBoundingClientRect().width,
      handle: { x: r.x + r.width / 2, y: r.y + r.height / 2 } };
  });
  const setSizes = (detail) => page.evaluate((detail) => { document.getElementById('st').sizes = { master: '1fr', detail }; }, detail);

  // ── No animation unless asked for ─────────────────────────────────────────────────────────────────────────
  await mount(null);
  await sleep(100);
  let s = await state();
  check(`default: no transition (${s.duration})`, s.duration === '0s');
  await setSizes('500px');
  s = await state();
  check(`default: a sizes change lands at once (detail ${Math.round(s.detailW)}px)`, Math.round(s.detailW) === 500);

  // ── Opted in: a sizes change animates ─────────────────────────────────────────────────────────────────────
  await mount('400ms linear');
  await sleep(100);
  s = await state();
  check(`opt-in: grid-template-columns transitions for 0.4s (${s.property} ${s.duration})`,
    s.duration === '0.4s' && s.property === 'grid-template-columns');
  await setSizes('500px');
  await sleep(120);
  const mid = (await state()).detailW;
  await sleep(500);
  const end = (await state()).detailW;
  check(`opt-in: a sizes change animates (${Math.round(mid)}px at 120ms, ${Math.round(end)}px after)`,
    mid > 305 && mid < 495 && Math.round(end) === 500);

  // ── A pointer drag is not animated ────────────────────────────────────────────────────────────────────────
  await mount('400ms linear');
  await sleep(100);
  s = await state();
  const before = s.masterW;
  await page.mouse.move(s.handle.x, s.handle.y);
  await page.mouse.down();
  await page.mouse.move(s.handle.x - 150, s.handle.y, { steps: 5 });
  await sleep(30);
  const dragging = await state();
  check(`drag: no transition while the separator is dragged (${dragging.duration})`, dragging.duration === '0s');
  check(`drag: the column follows the pointer at once (master ${Math.round(before)} -> ${Math.round(dragging.masterW)}px)`,
    Math.abs(dragging.masterW - (before - 150)) <= 3);
  await page.mouse.up();
  await sleep(30);
  const dropped = await state();
  check(`drag: its end is not animated either (master ${Math.round(dropped.masterW)}px right after the drop)`,
    Math.abs(dropped.masterW - dragging.masterW) <= 3);
  await sleep(50);
  const after = await state();
  check(`drag: the transition is back after the drop (${after.duration})`, after.duration === '0.4s');

  // ── Reduced motion wins ───────────────────────────────────────────────────────────────────────────────────
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await mount('400ms linear');
  await sleep(100);
  s = await state();
  check(`reduced motion: no transition even when the app set one (${s.duration})`, s.duration === '0s');
  await setSizes('500px');
  s = await state();
  check(`reduced motion: a sizes change lands at once (detail ${Math.round(s.detailW)}px)`, Math.round(s.detailW) === 500);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`split-transition-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
