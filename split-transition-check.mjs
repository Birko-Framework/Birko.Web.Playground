// Birko TASK-979 (asked for by DraCode TASK-058; the fixed-detail drag found by DraCode's test of it) — b-split-panel's column change can animate, opt-in. DraCode widens
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
  const mount = (transition, master = '1fr', detail = '300px') => page.evaluate((transition, master, detail) => {
    document.getElementById('st-host')?.remove();
    const host = document.createElement('div');
    host.id = 'st-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;padding:20px;width:1000px';
    host.innerHTML = `<b-split-panel id="st" resizable master-width="${master}" detail-width="${detail}" gap="20px"
      static-detail ${transition ? `style="--b-split-transition:${transition}"` : ''}>
      <div slot="master" style="height:200px;background:#eef">master</div>
      <div slot="detail" style="height:200px;background:#fee">detail</div></b-split-panel>`;
    document.body.appendChild(host);
  }, transition, master, detail);
  const state = () => page.evaluate(() => {
    const el = document.getElementById('st');
    const split = el.shadowRoot.querySelector('.split');
    const cs = getComputedStyle(split);
    const r = el.shadowRoot.querySelector('.resizer').getBoundingClientRect();
    return { duration: cs.transitionDuration, property: cs.transitionProperty, cols: cs.gridTemplateColumns,
      detailW: el.shadowRoot.querySelector('.detail').getBoundingClientRect().width,
      masterW: el.shadowRoot.querySelector('.master').getBoundingClientRect().width,
      totalW: split.getBoundingClientRect().width, gap: parseFloat(cs.columnGap) || 0, sizes: el.sizes,
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

  // ── A fixed-length detail (DraCode's shape: master 1fr, detail px) ─────────────────────────────────────────
  // The drag must resize the DETAIL, or the master moves while the detail keeps its width and a strip opens beside
  // it; the drop then commits {1fr, Npx}, so a consumer that re-sets those sizes on split-resize changes nothing.
  const fills = (st) => Math.abs(st.masterW + st.gap + st.detailW - st.totalW) <= 2;
  await mount('400ms linear');
  await page.evaluate(() => {
    const el = document.getElementById('st');
    el.addEventListener('split-resize', (e) => { el.sizes = { master: '1fr', detail: e.detail.sizes.detail }; });
  });
  await sleep(100);
  s = await state();
  await page.mouse.move(s.handle.x, s.handle.y);
  await page.mouse.down();
  await page.mouse.move(s.handle.x - 150, s.handle.y, { steps: 5 });
  await sleep(30);
  const fd = await state();
  check(`fixed detail: while dragged the columns fill the panel, no strip (master ${Math.round(fd.masterW)} + gap ${fd.gap} + detail ${Math.round(fd.detailW)} = ${Math.round(fd.totalW)})`,
    fills(fd) && Math.abs(fd.detailW - 450) <= 3);
  await page.mouse.up();
  await sleep(30);
  const fdrop = await state();
  check(`fixed detail: the drop commits ${JSON.stringify(fdrop.sizes)} and nothing moves (detail ${Math.round(fdrop.detailW)}px, panel full)`,
    fdrop.sizes.master === '1fr' && /^\d+px$/.test(fdrop.sizes.detail) && Math.abs(fdrop.detailW - fd.detailW) <= 3 && fills(fdrop));
  await sleep(500);
  const fsettled = await state();
  check(`fixed detail: still there after the transition time (detail ${Math.round(fsettled.detailW)}px)`,
    Math.abs(fsettled.detailW - fd.detailW) <= 3 && fills(fsettled));
  // The keyboard takes the same path: Left widens the detail by one step, the master keeps filling.
  await page.evaluate(() => document.getElementById('st').shadowRoot.querySelector('.resizer').focus());
  await page.keyboard.press('ArrowLeft');
  await sleep(500);
  const fk = await state();
  check(`fixed detail: Left arrow widens the detail by 16px and the panel stays full (${Math.round(fsettled.detailW)} -> ${Math.round(fk.detailW)}px)`,
    Math.abs(fk.detailW - fsettled.detailW - 16) <= 2 && fills(fk));

  // ── The classic shape (fixed master, flexible detail) still drags the master ─────────────────────────────
  await mount(null, '300px', '1fr');
  await sleep(100);
  s = await state();
  await page.mouse.move(s.handle.x, s.handle.y);
  await page.mouse.down();
  await page.mouse.move(s.handle.x + 100, s.handle.y, { steps: 5 });
  await page.mouse.up();
  await sleep(30);
  const classic = await state();
  check(`fixed master: the drag moves the master (${JSON.stringify(classic.sizes)}, master ${Math.round(classic.masterW)}px), panel full`,
    classic.sizes.detail === '1fr' && Math.abs(classic.masterW - 400) <= 3 && fills(classic));

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
