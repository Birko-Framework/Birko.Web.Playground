// Birko TASK-789 — b-tree-menu reordered by a REAL pointer: puppeteer's mouse and touchscreen send trusted input,
// which an in-page smoke cannot (a synthetic PointerEvent has no active pointer, so setPointerCapture throws).
//
//   node build.js && node tree-drag-check.mjs        (exit 1 on any FAIL)
//
// A row dragged by its body before / after / inside another, the drop bar mid-drag, a parent dropped on its own
// child (nothing), a collapsed parent staying closed under the pointer, handleOnly, Escape mid-drag, a click still
// selecting, and touch: a held press drags, a swipe does not. The keyboard cases are in tree-sort-smoke.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mount a sortable tree: a, b[b1, b2] (open), c[c1] (closed), d. Records reorder and select events. */
const mountIn = (page, config = {}, width = 420) => page.evaluate(async (config, width) => {
  document.getElementById('tr-host')?.remove();
  const host = document.createElement('div');
  host.id = 'tr-host';
  host.style.cssText = `position:fixed;left:20px;top:20px;width:${width}px;z-index:99990;padding:8px;background:var(--b-bg)`;
  host.innerHTML = '<b-tree-menu></b-tree-menu>';
  document.body.append(host);
  const tree = host.querySelector('b-tree-menu');
  await new Promise((r) => requestAnimationFrame(r));
  tree.setConfig({
    sortable: true, ...config,
    items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Bravo', expanded: true, children: [{ id: 'b1', label: 'Bravo one' }, { id: 'b2', label: 'Bravo two' }] },
      { id: 'c', label: 'Charlie', children: [{ id: 'c1', label: 'Charlie one' }] },
      { id: 'd', label: 'Delta' },
    ],
  });
  window.__tr = { reorders: [], selects: [], items: tree._items, ids: tree._items.map((i) => i.id).join(',') };
  window.__tr.first = window.__tr.items[0];
  tree.addEventListener('reorder', (e) => window.__tr.reorders.push({ s: e.detail.sourceId, t: e.detail.targetId, p: e.detail.position, own: e.detail.sourceItem === window.__tr.items.find((i) => i.id === e.detail.sourceId) }));
  tree.addEventListener('select', (e) => window.__tr.selects.push(e.detail.id));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, config, width);
/** Each visible row's box and its grip's, by id. */
const boxesIn = (page) => page.evaluate(() => {
  const tree = document.querySelector('#tr-host b-tree-menu');
  return Object.fromEntries([...tree.shadowRoot.querySelectorAll('.node-row')].filter((r) => r.getClientRects().length).map((row) => {
    const r = row.getBoundingClientRect();
    const g = row.querySelector('.grip').getBoundingClientRect();
    return [row.dataset.item, { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, gx: g.left + g.width / 2, gy: g.top + g.height / 2 }];
  }));
});
/** The tree on screen (ids, a child list in brackets) and the events so far. */
const stateIn = (page) => page.evaluate(() => {
  const tree = document.querySelector('#tr-host b-tree-menu');
  const level = (ul) => [...(ul?.children ?? [])].map((li) => {
    const kids = li.querySelector(':scope > ul');
    return li.dataset.id + (kids ? `[${level(kids)}]` : '');
  }).join(',');
  return { shown: level(tree.shadowRoot.querySelector('.tree')), reorders: window.__tr.reorders, selects: window.__tr.selects, consumer: window.__tr.items.map((i) => i.id).join(',') };
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!customElements.get('b-tree-menu'));
  const mount = (config) => mountIn(page, config);
  const boxes = () => boxesIn(page);
  const state = () => stateIn(page);
  /** Press at `from`, move in steps to `to`, optionally look at the page mid-drag (after `hold` ms), release. */
  const drag = async (from, to, { during, hold = 50 } = {}) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await sleep(hold);
    const seen = during ? await page.evaluate(during) : undefined;
    await page.mouse.up();
    await sleep(80);
    return seen;
  };
  const barNow = () => {
    const el = document.querySelector('#tr-host b-tree-menu').shadowRoot.querySelector('.drop');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width };
  };

  // ── after: Alpha by its body to the bottom of Delta; the bar sits under Delta mid-drag ──
  await mount();
  {
    const b = await boxes();
    const bar = await drag({ x: b.a.cx, y: b.a.cy }, { x: b.d.cx, y: b.d.y + b.d.h * 0.9 }, { during: barNow });
    const s = await state();
    check(`after: Alpha dragged by its body below Delta lands there (${s.shown}, ${JSON.stringify(s.reorders)})`,
      s.shown === 'b[b1,b2],c[c1],d,a' && s.reorders.length === 1 && s.reorders[0].s === 'a' && s.reorders[0].t === 'd' && s.reorders[0].p === 'after');
    check(`after: mid-drag the bar is at Delta's bottom edge, as wide as its row (${bar ? `top ${bar.top.toFixed(1)}, Delta ends ${(b.d.y + b.d.h).toFixed(1)}` : 'no bar'})`,
      !!bar && Math.abs(bar.top + 1.5 - (b.d.y + b.d.h)) < 2 && Math.abs(bar.left - b.d.x) < 1 && Math.abs(bar.width - b.d.w) < 1);
    check(`after: the drag did not also select a row (${s.selects.join(',') || 'none'})`, s.selects.length === 0);
    check(`after: the consumer's array is not reordered, and reorder reports its objects (${s.consumer}, own ${s.reorders[0]?.own})`, s.consumer === 'a,b,c,d' && s.reorders[0]?.own === true);
  }

  // ── before: Delta to the top of Bravo two (into Bravo's children) ──
  await mount();
  {
    const b = await boxes();
    await drag({ x: b.d.cx, y: b.d.cy }, { x: b.b2.cx, y: b.b2.y + b.b2.h * 0.1 });
    const s = await state();
    check(`before: Delta dragged to the top of Bravo two joins Bravo before it (${s.shown})`,
      s.shown === 'a,b[b1,d,b2],c[c1]' && s.reorders.length === 1 && s.reorders[0].t === 'b2' && s.reorders[0].p === 'before');
  }

  // ── inside: Delta to the middle of Alpha, a leaf ──
  await mount();
  {
    const b = await boxes();
    const lit = await drag({ x: b.d.cx, y: b.d.cy }, { x: b.a.cx, y: b.a.cy }, {
      during: () => !!document.querySelector('#tr-host b-tree-menu').shadowRoot.querySelector('[data-item="a"].drop-inside'),
    });
    const s = await state();
    check(`inside: mid-drag Alpha is outlined as the target (${lit})`, lit === true);
    check(`inside: Delta dropped on Alpha's middle becomes its child (${s.shown}, ${JSON.stringify(s.reorders)})`,
      s.shown === 'a[d],b[b1,b2],c[c1]' && s.reorders.length === 1 && s.reorders[0].t === 'a' && s.reorders[0].p === 'inside');
  }

  // ── a parent on its own child: nothing ──
  await mount();
  {
    const b = await boxes();
    await drag({ x: b.b.cx, y: b.b.cy }, { x: b.b1.cx, y: b.b1.cy });
    const s = await state();
    check(`a parent dropped on its own child moves nothing (${s.shown}, ${s.reorders.length} reorders)`, s.shown === 'a,b[b1,b2],c[c1],d' && s.reorders.length === 0);
  }

  // ── a collapsed parent stays closed under the pointer, and takes the drop ──
  await mount();
  {
    const b = await boxes();
    const open = await drag({ x: b.a.cx, y: b.a.cy }, { x: b.c.cx, y: b.c.cy }, {
      hold: 1200,
      during: () => !document.querySelector('#tr-host b-tree-menu').shadowRoot.querySelector('li[data-id="c"] > ul.children').classList.contains('collapsed'),
    });
    const s = await state();
    check(`a collapsed parent held under the pointer for 1.2 s stays closed (open: ${open})`, open === false);
    check(`and the drop goes inside it (${s.shown}, ${JSON.stringify(s.reorders)})`,
      s.shown === 'b[b1,b2],c[c1,a],d' && s.reorders.length === 1 && s.reorders[0].t === 'c' && s.reorders[0].p === 'inside');
  }

  // ── handleOnly: the body does not drag, the grip does ──
  await mount({ handleOnly: true });
  {
    const b = await boxes();
    await drag({ x: b.a.cx, y: b.a.cy }, { x: b.d.cx, y: b.d.y + b.d.h * 0.9 });
    let s = await state();
    check(`handleOnly: a drag by the body moves nothing (${s.shown}, ${s.reorders.length} reorders)`, s.shown === 'a,b[b1,b2],c[c1],d' && s.reorders.length === 0);
    await drag({ x: b.a.gx, y: b.a.gy }, { x: b.d.gx, y: b.d.y + b.d.h * 0.9 });
    s = await state();
    check(`handleOnly: a drag by the grip moves it (${s.shown})`, s.shown === 'b[b1,b2],c[c1],d,a' && s.reorders.length === 1);
  }

  // ── Escape mid-drag cancels; a plain click still selects ──
  await mount();
  {
    const b = await boxes();
    await page.mouse.move(b.a.cx, b.a.cy);
    await page.mouse.down();
    await page.mouse.move(b.d.cx, b.d.y + b.d.h * 0.9, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await sleep(80);
    let s = await state();
    check(`Escape mid-drag moves nothing (${s.shown}, ${s.reorders.length} reorders)`, s.shown === 'a,b[b1,b2],c[c1],d' && s.reorders.length === 0);
    await page.mouse.click(b.d.cx, b.d.cy);
    await sleep(50);
    s = await state();
    check(`a click with no drag still selects the row (${s.selects.join(',')})`, s.selects.join(',') === 'd');
  }

  check(`no page errors while dragging (${pageErrors.join(' | ') || 'none'})`, pageErrors.length === 0);

  // ── touch: a held press drags; a swipe does not ──
  const touchPage = await browser.newPage();
  await touchPage.emulate({ viewport: { width: 400, height: 700, hasTouch: true, isMobile: true }, userAgent: '' });
  await touchPage.goto(url, { waitUntil: 'networkidle0' });
  await touchPage.waitForFunction(() => !!customElements.get('b-tree-menu'));
  {
    const p = touchPage;
    await mountIn(p, {}, 340);
    const b = await boxesIn(p);
    const press = async (hold) => {
      await p.touchscreen.touchStart(b.a.cx, b.a.cy);
      if (hold) await sleep(500);
      await p.touchscreen.touchMove(b.a.cx, b.a.cy + 20);
      await p.touchscreen.touchMove(b.d.cx, b.d.y + b.d.h * 0.9);
      await sleep(60);
      await p.touchscreen.touchEnd();
      await sleep(120);
    };
    await press(false);
    let s = await stateIn(p);
    check(`touch: a quick swipe over a row does not drag it (${s.shown}, ${s.reorders.length} reorders)`, s.shown === 'a,b[b1,b2],c[c1],d' && s.reorders.length === 0);
    await press(true);
    s = await stateIn(p);
    check(`touch: a held press then a move drags it (${s.shown})`, s.shown === 'b[b1,b2],c[c1],d,a' && s.reorders.length === 1);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\ntree-drag-check: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
