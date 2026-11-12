// Birko TASK-804 — the Playground's "Contextual tab (Shell)" card driven by a REAL mouse: a row click raises the
// page's contextual tab and opens it, a command reaches the page and what is enabled follows the record, a normal
// tab and back keeps it, closing the detail removes it and returns to the tab you were on. No page errors.
// TASK-921 (Symbio TASK-1051): on an UNPINNED ribbon the pointer leaving the panel to click in the page collapses it;
// refreshContextualRibbon({ open: true }) for the same record opens it again, also when it lands inside the 300 ms the
// collapse waits, while refreshContextualRibbon() leaves it collapsed.
//
//   node build.js && node contextual-ribbon-check.mjs        (exit 1 on any FAIL)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launchBrowser } from './launch-browser.mjs';
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (!p) p = 'index.html';
  try { const b = await readFile(join('wwwroot', p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.querySelector('#pg-ribbon').dispatchEvent(new CustomEvent('item-click', { detail: { itemId: 'cat:nav' }, bubbles: true })));
await new Promise((r) => setTimeout(r, 800));
const shellSel = 'pg-ctx-shell';
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), shellSel);
await new Promise((r) => setTimeout(r, 600));
const st = () => page.evaluate(() => {
  const shell = document.querySelector('pg-ctx-shell');
  const rb = shell.shadowRoot.querySelector('#ribbon');
  const sr = rb.shadowRoot;
  const tabs = [...sr.querySelectorAll('.ribbon-tab')].map((t) => t.dataset.tab);
  const items = [...sr.querySelectorAll('.ribbon-panel .ribbon-item')].map((i) => `${i.dataset.item}${i.hasAttribute('disabled') || i.getAttribute('aria-disabled') === 'true' ? '(off)' : ''}`);
  return { active: rb.getAttribute('active'), tabs, items };
});
let s = await st();
check(`the shell starts on its module tab, no contextual tab (${JSON.stringify(s)})`, s.active === 'sales' && !s.tabs.includes('order-tools'));
// a row of the table, in the page inside the shell
const rowBox = await page.evaluate(() => {
  const deep = (root, out = []) => { for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) deep(el.shadowRoot, out); } return out; };
  const cell = deep(document.querySelector('pg-ctx-orders').shadowRoot).find((el) => el.tagName === 'TD' && el.textContent.trim() === 'Order 1001');
  if (!cell) return null;
  const r = cell.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (!rowBox) throw new Error('no Order 1001 row');
if (rowBox) { await page.mouse.click(rowBox.x, rowBox.y); await new Promise((r) => setTimeout(r, 800)); }
s = await st();
check(`a row click raises the Order tab and opens it, commands by status (${JSON.stringify(s)})`, s.active === 'order-tools' && JSON.stringify(s.items) === '["confirm","ship(off)","cancel"]');
const clickRibbon = async (sel) => {
  const b = await page.evaluate((sel) => { const el = document.querySelector('pg-ctx-shell').shadowRoot.querySelector('#ribbon').shadowRoot.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  if (b) await page.mouse.click(b.x, b.y); return !!b;
};
await clickRibbon('.ribbon-item[data-item="confirm"]');
await new Promise((r) => setTimeout(r, 800));
s = await st();
check(`Confirm reaches the page: the order is confirmed, Ship now enabled (${JSON.stringify(s.items)})`, s.active === 'order-tools' && JSON.stringify(s.items) === '["confirm(off)","ship","cancel"]');
await clickRibbon('.ribbon-tab[data-tab="stock"]');
await new Promise((r) => setTimeout(r, 400));
s = await st();
check(`another tab opens, the contextual tab stays (${JSON.stringify(s)})`, s.active === 'stock' && s.tabs.includes('order-tools'));
await clickRibbon('.ribbon-tab[data-tab="order-tools"]');
await new Promise((r) => setTimeout(r, 400));
s = await st();
check(`and back on it, the same commands (${JSON.stringify(s)})`, s.active === 'order-tools' && JSON.stringify(s.items) === '["confirm(off)","ship","cancel"]');
const closed = await page.evaluate(() => { const b = document.querySelector('pg-ctx-orders').shadowRoot.querySelector('#btn-close-detail'); if (!b) return false; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
if (closed) { await page.mouse.click(closed.x, closed.y); await new Promise((r) => setTimeout(r, 600)); }
s = await st();
check(`closing the detail removes it, back on the tab you were on (${JSON.stringify(s)})`, !!closed && s.active === 'stock' && !s.tabs.includes('order-tools'));

// ── TASK-921: unpinned ──
const ribbonBox = (sel) => page.evaluate((sel) => { const el = document.querySelector('pg-ctx-shell').shadowRoot.querySelector('#ribbon').shadowRoot.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; }, sel);
const ribbonState = () => page.evaluate(() => { const rb = document.querySelector('pg-ctx-shell').shadowRoot.querySelector('#ribbon'); const p = rb.shadowRoot.querySelector('.ribbon-panel'); return { pinned: rb.hasAttribute('pinned'), expanded: rb.hasAttribute('expanded'), active: rb.getAttribute('active'), panelH: p ? Math.round(p.getBoundingClientRect().height) : 0 }; });
const detailBox = () => page.evaluate(() => { const deep = (root, out = []) => { for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) deep(el.shadowRoot, out); } return out; }; const p = deep(document.querySelector('pg-ctx-orders').shadowRoot).find((el) => el.tagName === 'P' && el.textContent.includes('Order 1001')); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const refresh = (open) => page.evaluate((open) => document.querySelector('pg-ctx-orders').refreshContextualRibbon(open ? { open: true } : undefined), open);
const leavePanel = async () => {
  const p = await ribbonBox('.ribbon-panel');
  const d = await detailBox();
  if (!p || !d) return false;
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.move(d.x, d.y, { steps: 4 });
  return true;
};
await clickRibbon('#ribbon-toggle'); // pinned → collapsed (unpinned), as Ctrl+F1
await new Promise((r) => setTimeout(r, 400));
let rs = await ribbonState();
check(`the ribbon is unpinned and collapsed (${JSON.stringify(rs)})`, !rs.pinned && !rs.expanded);
const row = await page.evaluate(() => {
  const deep = (root, out = []) => { for (const el of root.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) deep(el.shadowRoot, out); } return out; };
  const cell = deep(document.querySelector('pg-ctx-orders').shadowRoot).find((el) => el.tagName === 'TD' && el.textContent.trim() === 'Order 1001');
  const r = cell.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(row.x, row.y);
await new Promise((r) => setTimeout(r, 800));
rs = await ribbonState();
check(`unpinned, a row click raises the tab and opens its panel over the page (${JSON.stringify(rs)})`, rs.active === 'order-tools' && rs.expanded && rs.panelH > 20);
const left = await leavePanel();
await new Promise((r) => setTimeout(r, 800));
rs = await ribbonState();
check(`the pointer leaving the panel for the detail collapses it, the tab still active (${left}, ${JSON.stringify(rs)})`, left && !rs.expanded && rs.panelH <= 1 && rs.active === 'order-tools');
await refresh(false);
await new Promise((r) => setTimeout(r, 600));
rs = await ribbonState();
check(`refreshContextualRibbon() for the same record leaves it collapsed (${JSON.stringify(rs)})`, !rs.expanded && rs.active === 'order-tools');
await refresh(true);
await new Promise((r) => setTimeout(r, 600));
rs = await ribbonState();
check(`refreshContextualRibbon({ open: true }) opens the panel on the tab (${JSON.stringify(rs)})`, rs.expanded && rs.panelH > 20 && rs.active === 'order-tools');
// The click that selects a sub-row is the one that left the panel: the re-raise lands while the collapse waits.
await leavePanel();
await refresh(true);
await new Promise((r) => setTimeout(r, 800));
rs = await ribbonState();
check(`and when it lands inside the collapse delay, the queued collapse does not undo it (${JSON.stringify(rs)})`, rs.expanded && rs.panelH > 20 && rs.active === 'order-tools');
check(`no page errors (${JSON.stringify(errors)})`, errors.length === 0);
await browser.close(); server.close();
console.log(`
contextual-ribbon-check: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
