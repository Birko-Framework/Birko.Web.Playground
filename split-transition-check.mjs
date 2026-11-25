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
  const mount = (transition, master = '1fr', detail = '300px', extra = '', width = 1000) => page.evaluate((transition, master, detail, extra, width) => {
    document.getElementById('st-host')?.remove();
    const host = document.createElement('div');
    host.id = 'st-host';
    host.style.cssText = `position:fixed;inset:0;z-index:99999;background:#fff;padding:20px;width:${width}px`;
    host.innerHTML = `<b-split-panel id="st" resizable master-width="${master}" detail-width="${detail}" gap="20px"
      static-detail ${extra} ${transition ? `style="--b-split-transition:${transition}"` : ''}>
      <div slot="master" style="height:200px;background:#eef">master</div>
      <div slot="detail" style="height:200px;background:#fee">detail</div></b-split-panel>`;
    document.body.appendChild(host);
  }, transition, master, detail, extra, width);
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

  // ── A consumer minimum per column (TASK-981, asked for by DraCode: its chat panel must stay 320px) ───────────
  // The drag and the keys stop at the minimum, so the drop already respects it and nothing animates afterwards.
  const drag = async (dx) => {
    const st = await state();
    await page.mouse.move(st.handle.x, st.handle.y);
    await page.mouse.down();
    await page.mouse.move(st.handle.x + dx, st.handle.y, { steps: 5 });
    await sleep(30);
    const during = await state();
    await page.mouse.up();
    await sleep(30);
    return { during, dropped: await state() };
  };
  await mount('400ms linear', '1fr', '400px', 'detail-min="320px"');
  await sleep(100);
  let mn = await drag(300);
  check(`detail-min: the drag stops the detail at 320px while dragged (${Math.round(mn.during.detailW)}px), panel full`,
    Math.abs(mn.during.detailW - 320) <= 2 && fills(mn.during));
  check(`detail-min: the drop commits ${JSON.stringify(mn.dropped.sizes)}, nothing moves`,
    mn.dropped.sizes.detail === '320px' && Math.abs(mn.dropped.detailW - 320) <= 2);
  await sleep(500);
  s = await state();
  check(`detail-min: still 320px after the transition time (${Math.round(s.detailW)}px)`, Math.abs(s.detailW - 320) <= 2);
  await page.evaluate(() => document.getElementById('st').shadowRoot.querySelector('.resizer').focus());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await sleep(500);
  s = await state();
  check(`detail-min: Right and End stop at it too (${Math.round(s.detailW)}px)`, Math.abs(s.detailW - 320) <= 2);
  const aria = await page.evaluate(() => { const r = document.getElementById('st').shadowRoot.querySelector('.resizer'); return Number(r.getAttribute('aria-valuemax')); });
  check(`detail-min: the separator's aria-valuemax leaves the detail 320px (${aria} = ${Math.round(s.totalW)} - ${s.gap} - 320)`,
    Math.abs(aria - (s.totalW - s.gap - 320)) <= 1);

  // 15rem at the page's root font size (the Playground's is 14px, so 210px).
  const remPx = 15 * await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await mount(null, '300px', '1fr', 'master-min="15rem"');
  await sleep(100);
  mn = await drag(-200);
  check(`master-min in rem: the drag stops the master at 15rem = ${remPx}px (${Math.round(mn.during.masterW)}px), drop ${JSON.stringify(mn.dropped.sizes)}`,
    Math.abs(mn.during.masterW - remPx) <= 2 && mn.dropped.sizes.master === `${Math.round(remPx)}px`);
  await page.evaluate(() => document.getElementById('st').shadowRoot.querySelector('.resizer').focus());
  await page.keyboard.press('Home');
  s = await state();
  check(`master-min: Home goes to it (${Math.round(s.masterW)}px)`, Math.abs(s.masterW - remPx) <= 2);

  // Too narrow for both: the column the separator resizes keeps its minimum, never a negative or NaN width.
  await mount(null, '1fr', '400px', 'detail-min="320px" master-min="200px"', 400);
  await sleep(100);
  mn = await drag(100);
  check(`too narrow, fixed detail: the detail keeps 320px, the master gets the rest (${Math.round(mn.dropped.masterW)} + ${mn.dropped.gap} + ${Math.round(mn.dropped.detailW)}), sizes ${JSON.stringify(mn.dropped.sizes)}`,
    Math.abs(mn.dropped.detailW - 320) <= 2 && mn.dropped.masterW >= 0 && /^\d+px$/.test(mn.dropped.sizes.detail));
  await mount(null, '250px', '1fr', 'detail-min="320px" master-min="200px"', 400);
  await sleep(100);
  mn = await drag(-100);
  check(`too narrow, fixed master: the master keeps 200px (${Math.round(mn.dropped.masterW)}px), sizes ${JSON.stringify(mn.dropped.sizes)}`,
    Math.abs(mn.dropped.masterW - 200) <= 2 && mn.dropped.sizes.master === '200px');

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
