// Birko TASK-978 — a table row can be opened by keyboard. Found at TASK-545 on Symbio HR → Positions: b-table emitted
// `row-click` only from a mouse click and its rows were not focusable, so a split page's detail (and its Delete) was
// out of a keyboard user's reach. Driven with trusted keys (Puppeteer) over the /?rows=1 fixtures:
//   A. split page in undo mode: Tab reaches the rows as ONE tab stop, arrows/Home/End move, Enter opens the detail,
//      Tab reaches Delete, Enter deletes, Undo restores (TASK-545's keyboard step); a re-render keeps row focus.
//   B. list page with onRowClick: Enter and Space open a row; Enter on a control inside the row stays the control's.
//   C. list page without onRowClick: rows stay out of the tab order.
//   D. selectable data table: Space toggles the row's checkbox, Enter opens the row.
//
//   node build.js && node table-rows-keyboard-check.mjs        (exit 1 on any FAIL)
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
const url = `http://localhost:${server.address().port}/?rows=1`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__rowsKb);

  // Helpers installed in the page: the deepest focused element, and a deep query.
  await page.evaluate(() => {
    window.__deepActive = () => {
      let a = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      if (!a) return null;
      return { tag: a.tagName.toLowerCase(), rowId: a.matches('tbody tr[data-id]') ? a.dataset.id : null,
        // A b-button's label is its host's light DOM, so read the host when the inner button has no text of its own.
        hostId: a.getRootNode().host?.id ?? null,
        text: ((a.textContent || '').trim() || (a.getRootNode().host?.textContent || '')).trim().slice(0, 40),
        outline: getComputedStyle(a).outlineStyle };
    };
    window.__deepAll = (root, sel) => {
      const out = [...root.querySelectorAll(sel)];
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...window.__deepAll(el.shadowRoot, sel));
      return out;
    };
  });
  const active = () => page.evaluate(() => window.__deepActive());
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(40); } };
  /** Mount `tag` in a fresh host after a start button, focus the button. */
  const mount = async (tag) => {
    await page.evaluate((tag) => {
      document.getElementById('rows-host')?.remove();
      const host = document.createElement('div');
      host.id = 'rows-host';
      host.innerHTML = `<button id="rows-start">start</button>${tag ? `<${tag} id="rows-page"></${tag}>` : ''}`;
      document.body.prepend(host);
    }, tag);
    if (tag) await page.waitForFunction(() => window.__deepAll(document.getElementById('rows-host'), 'tbody tr[data-id]').length === 3, { timeout: 5000 });
    await page.evaluate(() => document.getElementById('rows-start').focus());
  };
  /** Tab from the start button until a row has focus (or `max` presses). Returns the presses it took, or -1. */
  const tabToRow = async (max = 15) => {
    for (let i = 1; i <= max; i++) { await key('Tab'); if ((await active())?.rowId) return i; }
    return -1;
  };
  const tabStops = () => page.evaluate(() => window.__deepAll(document.getElementById('rows-host'), 'tbody tr[data-id]')
    .map((tr) => tr.getAttribute('tabindex')));

  // ── A. split page (Symbio Positions' shape), undo mode ─────────────────────────────────────────────────────────
  await mount('rows-split-page');
  check(`A: one row is the tab stop, the others -1 (${JSON.stringify(await tabStops())})`,
    JSON.stringify(await tabStops()) === '["0","-1","-1"]');
  const presses = await tabToRow();
  let a = await active();
  check(`A: Tab reaches the first row (after ${presses} Tab, on "${a?.rowId}")`, presses > 0 && a?.rowId === 'a');
  check(`A: the focused row shows a focus ring (outline ${a?.outline})`, a?.outline === 'solid');
  await key('ArrowDown'); const d1 = (await active())?.rowId;
  await key('End'); const e1 = (await active())?.rowId;
  await key('Home'); const h1 = (await active())?.rowId;
  await key('ArrowUp'); const u1 = (await active())?.rowId;
  check(`A: Down, End, Home, Up move between rows (${d1}, ${e1}, ${h1}, ${u1})`, d1 === 'b' && e1 === 'c' && h1 === 'a' && u1 === 'a');
  await key('ArrowDown');
  check(`A: the tab stop follows focus (${JSON.stringify(await tabStops())})`, JSON.stringify(await tabStops()) === '["-1","0","-1"]');
  await key('Enter');
  await page.waitForFunction(() => window.__deepAll(document, '.detail-name').some((e) => e.textContent === 'Bravo'), { timeout: 3000 }).catch(() => {});
  const detail = await page.evaluate(() => window.__deepAll(document, '.detail-name').map((e) => e.textContent));
  check(`A: Enter on a row opens its detail (${JSON.stringify(detail)})`, detail.includes('Bravo'));
  // Tab out of the row reaches the detail panel's controls, never another row.
  let reachedDelete = false; let rowAgain = false;
  for (let i = 0; i < 25 && !reachedDelete; i++) {
    await key('Tab');
    const now = await active();
    if (now?.rowId) rowAgain = true;
    if (now?.hostId === 'btn-detail-delete') reachedDelete = true;
  }
  check(`A: Tab from the rows goes on to the detail's Delete without another row in between`, reachedDelete && !rowAgain);
  await key('Enter');
  await page.waitForFunction(() => !document.getElementById('rows-page').fake.live.some((r) => r.id === 'b'), { timeout: 3000 }).catch(() => {});
  const afterDelete = await page.evaluate(() => document.getElementById('rows-page').fake.live.map((r) => r.id));
  check(`A: Enter on Delete deletes the row on the server (${JSON.stringify(afterDelete)})`, !afterDelete.includes('b'));
  await sleep(200);
  const onUndo = await active();
  check(`A: focus is on the toast's Undo ("${onUndo?.text}")`, /undo/i.test(onUndo?.text ?? ''));
  await key('Enter');
  await page.waitForFunction(() => document.getElementById('rows-page').fake.live.some((r) => r.id === 'b'), { timeout: 3000 }).catch(() => {});
  const afterUndo = await page.evaluate(() => document.getElementById('rows-page').fake.live.map((r) => r.id).sort());
  check(`A: Enter on Undo restores it (${JSON.stringify(afterUndo)})`, JSON.stringify(afterUndo) === '["a","b","c"]');

  // A re-render (reload) while a row has focus keeps focus on that row.
  await mount('rows-split-page');
  await tabToRow();
  await key('End');
  await page.evaluate(() => document.getElementById('rows-page').reload());
  await sleep(400);
  const kept = await active();
  check(`A: a reload while row "c" has focus keeps focus on it ("${kept?.rowId}")`, kept?.rowId === 'c');

  // ── B. list page that opens rows ─────────────────────────────────────────────────────────────────────────────
  await mount('rows-open-list-page');
  const pb = await tabToRow();
  await key('Enter');
  await key('ArrowDown');
  await key(' ');
  const opened = await page.evaluate(() => document.getElementById('rows-page').opened);
  check(`B: Enter and Space open a row (opened ${JSON.stringify(opened)}, reached after ${pb} Tab)`, JSON.stringify(opened) === '["a","b"]');
  // Enter on a control inside a row belongs to the control.
  const beforeCtl = opened.length;
  await key('Tab');
  const ctl = await active();
  if (ctl && !ctl.rowId && ctl.tag !== 'body') { await key('Enter'); await key('Escape'); }
  const openedAfter = await page.evaluate(() => document.getElementById('rows-page').opened.length);
  check(`B: Enter on a control in the row ("${ctl?.tag}" "${ctl?.text}") does not open the row`, !ctl?.rowId && openedAfter === beforeCtl);

  // ── C. list page that opens nothing ─────────────────────────────────────────────────────────────────────────
  await mount('rows-plain-list-page');
  check(`C: rows of a page that opens nothing are not focusable (${JSON.stringify(await tabStops())})`,
    (await tabStops()).every((t) => t === null));
  check('C: Tab never lands on a row', (await tabToRow(10)) === -1);

  // ── D. selectable data table ─────────────────────────────────────────────────────────────────────────────────
  await mount(null);
  await page.evaluate(async () => { window.__sel = await window.__rowsKb.mountSelectable(document.getElementById('rows-host')); });
  await page.evaluate(() => document.getElementById('rows-start').focus());
  const pd = await tabToRow();
  await key(' ');
  const checked = await page.evaluate(() => window.__deepAll(document.getElementById('rows-host'), 'tbody tr[data-id] input[type="checkbox"]').map((c) => c.checked));
  const openedSel = await page.evaluate(() => window.__sel.opened.length);
  check(`D: Space on a selectable row toggles its checkbox, opens nothing (${JSON.stringify(checked)}, opened ${openedSel}, after ${pd} Tab)`,
    pd > 0 && checked[0] === true && openedSel === 0);
  const back = await active();
  await key('Enter');
  const openedSel2 = await page.evaluate(() => window.__sel.opened);
  check(`D: focus stays on the row after Space ("${back?.rowId}"), Enter opens it (${JSON.stringify(openedSel2)})`,
    back?.rowId === 'a' && JSON.stringify(openedSel2) === '["a"]');
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`table-rows-keyboard-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
