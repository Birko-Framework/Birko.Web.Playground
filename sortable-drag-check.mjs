// Birko TASK-787 — b-sortable-list reordered by a REAL pointer: puppeteer's mouse and touchscreen send trusted input,
// which an in-page smoke cannot (a synthetic PointerEvent has no active pointer, so setPointerCapture throws).
//
//   node build.js && node sortable-drag-check.mjs        (exit 1 on any FAIL)
//
// Per layout: drag a row by its body to a new place and assert the order from three sides (the change event,
// getOrder(), the rows on screen). In grid, drag a tile into the row above, and measure the drop bar sitting in the
// gap before its target. Then handle-only, Escape mid-drag, auto-scroll of a capped list, and touch: a held press
// drags, a swipe does not. The keyboard, remove and picker cases are in sortable-smoke.
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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!customElements.get('b-sortable-list'));

  /** Mount a list of `n` rows (ids a, b, c, …) on top of the gallery; record its change events. */
  const mount = (layout, attrs = '', n = 6) => page.evaluate(async (layout, attrs, n) => {
    document.getElementById('sl-host')?.remove();
    const host = document.createElement('div');
    host.id = 'sl-host';
    host.style.cssText = 'position:fixed;left:20px;top:20px;width:640px;z-index:99990;padding:8px;background:var(--b-bg)';
    host.innerHTML = `<b-sortable-list layout="${layout}" ${attrs}></b-sortable-list>`;
    document.body.append(host);
    const list = host.querySelector('b-sortable-list');
    await new Promise((r) => requestAnimationFrame(r));
    list.setItems(Array.from({ length: n }, (_, i) => ({ id: String.fromCharCode(97 + i), label: `Row ${String.fromCharCode(65 + i)}` })));
    window.__slChanges = [];
    list.addEventListener('change', (e) => window.__slChanges.push(e.detail.order.join('')));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, layout, attrs, n);
  /** Each row's box, and its handle's, by id. */
  const boxes = () => page.evaluate(() => {
    const list = document.querySelector('#sl-host b-sortable-list');
    return Object.fromEntries([...list.shadowRoot.querySelectorAll('li.row')].map((li) => {
      const r = li.getBoundingClientRect();
      const h = li.querySelector('.handle').getBoundingClientRect();
      return [li.dataset.id, { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, hx: h.left + h.width / 2, hy: h.top + h.height / 2 }];
    }));
  });
  /** The order from three sides: the last change event, getOrder(), and the rows on screen. */
  const state = () => page.evaluate(() => {
    const list = document.querySelector('#sl-host b-sortable-list');
    return {
      event: window.__slChanges.at(-1) ?? '',
      events: window.__slChanges.length,
      api: list.getOrder().join(''),
      shown: [...list.shadowRoot.querySelectorAll('li.row')].map((li) => li.dataset.id).join(''),
    };
  });
  const orderIs = (s, want) => s.event === want && s.api === want && s.shown === want;
  /** Press at `from`, move in steps to `to`, optionally look at the page mid-drag, release. */
  const drag = async (from, to, { during } = {}) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await sleep(50);
    const seen = during ? await page.evaluate(during) : undefined;
    await page.mouse.up();
    await sleep(80);
    return seen;
  };

  // ── list: drag Row A by its body to below Row D ──
  await mount('list');
  {
    const b = await boxes();
    await drag({ x: b.a.cx, y: b.a.cy }, { x: b.d.cx, y: b.d.y + b.d.h * 0.75 });
    const s = await state();
    check(`list: a row dragged by its body below Row D lands there (event ${s.event}, api ${s.api}, shown ${s.shown})`, orderIs(s, 'bcdaef') && s.events === 1);
  }

  // ── grid: a tile dragged into the row above, before Row B; the bar sits in the gap before it ──
  await mount('grid');
  {
    const b = await boxes();
    const cols = Object.values(b).filter((r) => Math.round(r.y) === Math.round(b.a.y)).length;
    check(`grid: precondition, the tiles wrap (${cols} columns, Row F on the second row)`, cols >= 2 && cols < 6 && b.f.y > b.a.y + 10);
    const bar = await drag({ x: b.f.cx, y: b.f.cy }, { x: b.b.x + b.b.w * 0.25, y: b.b.cy }, {
      during: () => {
        const list = document.querySelector('#sl-host b-sortable-list');
        const el = list.shadowRoot.querySelector('.drop');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cls: el.className, cx: r.left + r.width / 2, top: r.top, bottom: r.bottom };
      },
    });
    const s = await state();
    check(`grid: Row F dragged up a row, before Row B, lands there (event ${s.event}, api ${s.api}, shown ${s.shown})`, orderIs(s, 'afbcde'));
    check(`grid: mid-drag the bar is vertical, in the gap left of Row B (${bar ? `${bar.cls} at x ${bar.cx.toFixed(1)}, Row B starts at ${b.b.x.toFixed(1)}` : 'no bar'})`,
      !!bar && bar.cls === 'drop v' && bar.cx < b.b.x && bar.cx > b.a.x + b.a.w - 1 && bar.top <= b.b.y + 1 && bar.bottom >= b.b.y + b.b.h - 1);
  }

  // ── inline: a chip dragged to after Row C ──
  await mount('inline');
  {
    const b = await boxes();
    await drag({ x: b.a.cx, y: b.a.cy }, { x: b.c.x + b.c.w * 0.8, y: b.c.cy });
    const s = await state();
    check(`inline: a chip dragged to after Row C lands there (event ${s.event}, api ${s.api}, shown ${s.shown})`, orderIs(s, 'bcadef'));
  }

  // ── handle-only: the body does not drag, the handle does ──
  await mount('list', 'handle-only');
  {
    const b = await boxes();
    await drag({ x: b.a.cx, y: b.a.cy }, { x: b.c.cx, y: b.c.y + b.c.h * 0.75 });
    let s = await state();
    check(`handle-only: a drag by the body moves nothing (${s.shown}, ${s.events} events)`, s.shown === 'abcdef' && s.events === 0);
    await drag({ x: b.a.hx, y: b.a.hy }, { x: b.c.hx, y: b.c.y + b.c.h * 0.75 });
    s = await state();
    check(`handle-only: a drag by the handle moves it (event ${s.event}, shown ${s.shown})`, orderIs(s, 'bcadef'));
  }

  // ── Escape mid-drag cancels ──
  await mount('list');
  {
    const b = await boxes();
    await page.mouse.move(b.a.cx, b.a.cy);
    await page.mouse.down();
    await page.mouse.move(b.d.cx, b.d.y + b.d.h * 0.75, { steps: 10 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await sleep(80);
    const s = await state();
    check(`Escape mid-drag puts the row back (${s.shown}, ${s.events} events)`, s.shown === 'abcdef' && s.events === 0);
  }

  // ── auto-scroll: a capped list scrolls while a row is held near its bottom edge ──
  await mount('list', 'max-height="180px"', 24);
  {
    const b = await boxes();
    const sc = await page.evaluate(() => {
      const s = document.querySelector('#sl-host b-sortable-list').shadowRoot.querySelector('.scroll');
      const r = s.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scrollable: s.scrollHeight > s.clientHeight };
    });
    check('auto-scroll: precondition, the capped list scrolls', sc.scrollable);
    await page.mouse.move(b.a.cx, b.a.cy);
    await page.mouse.down();
    await page.mouse.move(b.a.cx, sc.bottom - 8, { steps: 10 });
    await sleep(700);
    const scrolled = await page.evaluate(() => document.querySelector('#sl-host b-sortable-list').shadowRoot.querySelector('.scroll').scrollTop);
    await page.mouse.up();
    await sleep(80);
    const s = await state();
    const at = s.api.indexOf('a');
    check(`auto-scroll: held at the bottom edge the list scrolls (scrollTop ${scrolled})`, scrolled > 100);
    check(`auto-scroll: the row drops where the list scrolled to (position ${at + 1} of 24)`, at > 6 && s.event === s.api && s.shown === s.api);
  }

  // ── touch: a held press drags the row; a swipe does not ──
  const touchPage = await browser.newPage();
  await touchPage.emulate({ viewport: { width: 400, height: 700, hasTouch: true, isMobile: true }, userAgent: '' });
  await touchPage.goto(url, { waitUntil: 'networkidle0' });
  await touchPage.waitForFunction(() => !!customElements.get('b-sortable-list'));
  {
    const p = touchPage;
    await p.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'sl-host';
      host.style.cssText = 'position:fixed;left:10px;top:20px;width:360px;z-index:99990;background:var(--b-bg)';
      host.innerHTML = '<b-sortable-list></b-sortable-list>';
      document.body.append(host);
      const list = host.querySelector('b-sortable-list');
      await new Promise((r) => requestAnimationFrame(r));
      list.setItems(['a', 'b', 'c', 'd'].map((id) => ({ id, label: `Row ${id.toUpperCase()}` })));
      window.__slChanges = [];
      list.addEventListener('change', (e) => window.__slChanges.push(e.detail.order.join('')));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const b = await p.evaluate(() => Object.fromEntries([...document.querySelector('#sl-host b-sortable-list').shadowRoot.querySelectorAll('li.row')]
      .map((li) => { const r = li.getBoundingClientRect(); return [li.dataset.id, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, y: r.top, h: r.height }]; })));
    const order = () => p.evaluate(() => ({ api: document.querySelector('#sl-host b-sortable-list').getOrder().join(''), events: window.__slChanges.length }));
    const swipe = async (hold) => {
      await p.touchscreen.touchStart(b.a.cx, b.a.cy);
      if (hold) await sleep(450);
      for (let i = 1; i <= 10; i++) { await p.touchscreen.touchMove(b.a.cx, b.a.cy + (b.c.y + b.c.h * 0.75 - b.a.cy) * i / 10); await sleep(16); }
      await p.touchscreen.touchEnd();
      await sleep(100);
    };
    await swipe(false);
    let o = await order();
    check(`touch: a quick swipe over a row does not drag it (${o.api}, ${o.events} events)`, o.api === 'abcd' && o.events === 0);
    await swipe(true);
    o = await order();
    check(`touch: a held press then a move drags it (${o.api})`, o.api === 'bcad' && o.events === 1);
  }
  await touchPage.close();
} catch (e) {
  check(`unexpected throw: ${e.message}`, false);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nsortable-drag-check: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
