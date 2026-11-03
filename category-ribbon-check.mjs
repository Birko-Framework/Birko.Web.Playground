// Birko TASK-803 — the Shell's category ribbon driven by a REAL mouse and keyboard (an in-page smoke cannot open a
// popover without closing every other one, see ribbon-menu-smoke):
//
//   node build.js && node category-ribbon-check.mjs        (exit 1 on any FAIL)
//
// The split part goes to a module's first page; ▾ and a pick go to any page, the module becomes active and a pinned
// ribbon stays open; Alt+↓ opens the menu from the keyboard, Enter and Space follow a page; an action choice only
// emits item-click; a middle-click on the split part or a choice opens a new tab.
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

const browser = await launchBrowser({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__pgCategoryRibbon && !!customElements.get('b-ribbon'));

/** A pinned category ribbon on top of the page, fed from the hash as an app shell does. */
await page.evaluate(async () => {
  history.replaceState(null, '', location.pathname);
  const host = document.createElement('div');
  host.id = 'cr-host';
  host.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:99990;background:var(--b-bg)';
  host.innerHTML = '<b-ribbon expanded pinned active="business"></b-ribbon>';
  document.body.append(host);
  await new Promise((r) => requestAnimationFrame(r));
  window.__cr = window.__pgCategoryRibbon.mountCategoryRibbon(host.querySelector('b-ribbon'));
  await new Promise((r) => setTimeout(r, 200));
});

const state = () => page.evaluate(() => {
  const el = document.querySelector('#cr-host b-ribbon');
  const sr = el.shadowRoot;
  const open = [...sr.querySelectorAll('.ribbon-menu')].filter((m) => m.matches(':popover-open')).map((m) => m.getAttribute('aria-label'));
  const f = sr.activeElement;
  return {
    hash: location.hash,
    open,
    focus: !f ? 'outside' : f.dataset.menuItem ? `menu:${f.dataset.menuItem}` : f.dataset.arrow ? `arrow:${f.dataset.arrow}` : f.dataset.item ?? f.tagName,
    pinned: el.hasAttribute('pinned'),
    expanded: el.hasAttribute('expanded') && !!sr.querySelector('.ribbon-panel:not([hidden]) .ribbon-group'),
    pagesGroup: [...sr.querySelectorAll('.ribbon-panel .ribbon-group')].map((g) => g.dataset.group ?? g.getAttribute('data-group-id') ?? '').filter(Boolean),
    activeModule: sr.querySelector('.ribbon-panel .ribbon-item.active[data-group="_modules"]')?.dataset.item ?? null,
    clicks: window.__cr.clicks.map((c) => `${c.parentId ?? ''}>${c.itemId}`),
  };
});
const waitFor = async (pred, ms = 1500) => { for (let t = 0; t < ms; t += 50) { const s = await state(); if (pred(s)) return s; await sleep(50); } return state(); };
/**
 * Clicks the element under `sel` (in the ribbon's shadow root) where it is now: the ribbon re-renders on navigation,
 * sometimes twice (setTabs, then a layout pass), so it first waits for the shadow root to stay unchanged for 150 ms. A
 * click landing mid-render hit the old DOM: measured 2026-11-03, the ▾ after a navigation opened no menu, 2 runs of 6
 * on a busy machine.
 */
const clickIn = async (sel, opts = {}) => {
  await page.evaluate(() => new Promise((resolve) => {
    const sr = document.querySelector('#cr-host b-ribbon').shadowRoot;
    let quiet = setTimeout(done, 150);
    const mo = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, 150); });
    const give = setTimeout(done, 2000);
    function done() { mo.disconnect(); clearTimeout(quiet); clearTimeout(give); resolve(); }
    mo.observe(sr, { childList: true, subtree: true, attributes: true });
  }));
  const box = await page.evaluate((sel) => {
    const r = document.querySelector('#cr-host b-ribbon').shadowRoot.querySelector(sel)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, sel);
  if (!box) throw new Error(`not found: ${sel}`);
  await page.mouse.click(box.x, box.y, opts);
};

try {
  // ── 1. The split part: a module's first page ──
  await clickIn('.ribbon-split-main[data-item="sales"]');
  let st = await waitFor((s) => s.hash === '#/demo/sales/orders' && s.activeModule === 'sales');
  check(`clicking Sales goes to its first page and makes it active (${st.hash}, ${st.activeModule})`, st.hash === '#/demo/sales/orders' && st.activeModule === 'sales');

  // ── 2. ▾ and a pick: another module's third page, in one go ──
  await clickIn('.ribbon-split-arrow[data-arrow="sales"]');
  st = await waitFor((s) => s.open.length === 1);
  check(`▾ opens the module's menu and navigates nowhere (${st.open}, ${st.hash})`, JSON.stringify(st.open) === '["Sales"]' && st.hash === '#/demo/sales/orders');
  await clickIn('.ribbon-menu-item[data-menu-item="sales:quotes"]');
  st = await waitFor((s) => s.hash === '#/demo/sales/quotes');
  check(`picking its third page opens it (${st.hash})`, st.hash === '#/demo/sales/quotes');
  check(`the menu closes, the pinned ribbon stays open (${st.open}, pinned ${st.pinned}, expanded ${st.expanded})`, st.open.length === 0 && st.pinned && st.expanded);
  await clickIn('.ribbon-split-arrow[data-arrow="catalogue"]');
  await waitFor((s) => s.open.length === 1);
  await clickIn('.ribbon-menu-item[data-menu-item="catalogue:categories"]');
  st = await waitFor((s) => s.hash === '#/demo/catalogue/categories' && s.activeModule === 'catalogue');
  check(`a page of another module: one pick, and that module becomes active (${st.hash}, ${st.activeModule})`, st.hash === '#/demo/catalogue/categories' && st.activeModule === 'catalogue');
  check(`item-click carries the module as parentId (${st.clicks.join(' ')})`, st.clicks.includes('sales>sales:quotes') && st.clicks.includes('catalogue>catalogue:categories'));

  // ── 3. Keyboard: Alt+↓ opens, arrows move, Enter follows ──
  await page.evaluate(() => document.querySelector('#cr-host b-ribbon').shadowRoot.querySelector('.ribbon-split-arrow[data-arrow="sales"]').focus());
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt');
  st = await waitFor((s) => s.open.length === 1 && s.focus.startsWith('menu:'));
  check(`Alt+↓ on ▾ opens the menu at its first page (${st.open}, ${st.focus})`, JSON.stringify(st.open) === '["Sales"]' && st.focus === 'menu:sales:orders');
  await page.keyboard.press('ArrowDown');
  st = await state();
  check(`↓ moves to the next page (${st.focus})`, st.focus === 'menu:sales:invoices');
  await page.keyboard.press('Enter');
  st = await waitFor((s) => s.hash === '#/demo/sales/invoices');
  check(`Enter follows the page (${st.hash}, menu ${st.open.length ? 'open' : 'closed'})`, st.hash === '#/demo/sales/invoices' && st.open.length === 0);

  // Space follows a page too (a link does not take Space by itself)
  await page.evaluate(() => document.querySelector('#cr-host b-ribbon').shadowRoot.querySelector('.ribbon-split-arrow[data-arrow="sales"]').focus());
  await page.keyboard.press('Enter');
  await waitFor((s) => s.focus === 'menu:sales:orders');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  st = await waitFor((s) => s.hash === '#/demo/sales/quotes');
  check(`Space follows a page (${st.hash})`, st.hash === '#/demo/sales/quotes');

  // An action choice: item-click only
  await page.evaluate(() => document.querySelector('#cr-host b-ribbon').shadowRoot.querySelector('.ribbon-split-arrow[data-arrow="sales"]').focus());
  await page.keyboard.press('Enter');
  await waitFor((s) => s.focus === 'menu:sales:orders');
  await page.keyboard.press('End');
  const before = (await state()).clicks.length;
  await page.keyboard.press('Enter');
  st = await waitFor((s) => s.clicks.length > before);
  check(`an action choice emits item-click and navigates nowhere (${st.clicks.at(-1)}, ${st.hash})`, st.clicks.at(-1) === 'sales>sales:export' && st.hash === '#/demo/sales/quotes');

  // ── 4. Middle-click opens a new tab: on the split part, and on a page choice ──
  const newTab = async (click) => {
    const created = new Promise((r) => { browser.once('targetcreated', (t) => r(t.url())); setTimeout(() => r(null), 2000); });
    await click();
    return created;
  };
  let opened = await newTab(async () => clickIn('.ribbon-split-main[data-item="catalogue"]', { button: 'middle' }));
  check(`a middle-click on the split part opens its page in a new tab (${opened})`, !!opened && opened.endsWith('#/demo/catalogue/products'));
  await clickIn('.ribbon-split-arrow[data-arrow="catalogue"]');
  await waitFor((s) => s.open.length === 1);
  opened = await newTab(async () => clickIn('.ribbon-menu-item[data-menu-item="catalogue:categories"]', { button: 'middle' }));
  check(`a middle-click on a page choice opens it in a new tab (${opened})`, !!opened && opened.endsWith('#/demo/catalogue/categories'));
  await page.keyboard.press('Escape');

  check(`no page errors (${errors.join(' | ')})`, errors.length === 0);
} catch (e) {
  check(`unexpected throw: ${e.message}`, false);
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\ncategory-ribbon-check: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
