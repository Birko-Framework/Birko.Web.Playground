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
  // ?kb=1 loads the fixtures only this script needs (TASK-545's toast manager on window and an undo-mode page).
  await page.goto(`${url}?kb=1`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__kbToast && !!customElements.get('ud-kb-page'));

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

  // ── b-rating with a slotted icon (TASK-592): keys unchanged, and focus survives an icon swap ──
  await mount('<b-rating name="hearts"><svg slot="icon" viewBox="0 0 24 24"><path d="M12 21s-7-4.4-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.6-9.5 9-9.5 9z"/></svg></b-rating>');
  await focusBefore();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  check(`with a slotted icon: Tab, Space, ArrowRight pick 2 (value ${(await state()).value}, focus ${await focused()})`,
    (await state()).value === '2' && (await focused()) === 'radio:2');
  await page.evaluate(() => {
    const r = document.querySelector('#kb-host b-rating');
    r.querySelector('svg[slot="icon"]').remove();
    r.insertAdjacentHTML('beforeend', '<svg slot="icon" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
  });
  await page.waitForFunction(() => !!document.querySelector('#kb-host b-rating').shadowRoot.querySelector('.star svg circle'));
  check(`swapping the icon keeps focus and value (focus ${await focused()}, value ${(await state()).value})`,
    (await focused()) === 'radio:2' && (await state()).value === '2');
  await page.keyboard.press('ArrowRight');
  check(`the keys still work after the swap (value ${(await state()).value})`, (await state()).value === '3');

  // ── b-rating, disabled: no tab stop ──
  await mount('<b-rating value="3" disabled></b-rating>');
  await focusBefore();
  await page.keyboard.press('Tab');
  check(`disabled has no tab stop (focus ${await focused()})`, (await focused()) === 'kb-after');

  // ── TASK-545: a toast's action is reachable by Tab, held open by real focus and real hover, operable by Enter ──
  await page.evaluate(() => { document.getElementById('kb-host')?.remove(); document.querySelectorAll('b-toast-item').forEach((t) => t.remove()); });
  /** Show an action toast and put a button right before the toast container, so one Tab reaches the toast. */
  const showActionToast = (durationMs) => page.evaluate((ms) => {
    window.__kbActed = 0;
    const t = window.__kbToast.show('Item deleted', 'success', ms, { action: { onClick: () => { window.__kbActed++; } } });
    document.getElementById('kb-last')?.remove();
    const last = document.createElement('button');
    last.id = 'kb-last';
    last.textContent = 'last';
    t.parentElement.before(last);
    return true;
  }, durationMs);
  const toastState = () => page.evaluate(() => {
    const t = [...document.querySelectorAll('b-toast-item')].at(-1);
    return { present: !!t && t.isConnected && !t.classList.contains('fade-out'), acted: window.__kbActed };
  });
  const focusedIsAction = () => page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el?.classList.contains('action') === true && el.getRootNode().host?.localName === 'b-toast-item';
  });

  await showActionToast(400);
  await page.evaluate(() => document.getElementById('kb-last').focus());
  await page.keyboard.press('Tab');
  check("Tab reaches the toast's Undo button", await focusedIsAction());
  await new Promise((r) => setTimeout(r, 900));
  check('a toast whose Undo holds real focus outlives its 400 ms duration', (await toastState()).present);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 50));
  const afterEnter = await toastState();
  check(`Enter on Undo runs the action (acted ${afterEnter.acted}) and dismisses the toast`, afterEnter.acted === 1 && !afterEnter.present);

  await showActionToast(400);
  const box = await page.evaluate(() => {
    const r = [...document.querySelectorAll('b-toast-item')].at(-1).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await new Promise((r) => setTimeout(r, 900));
  check('a hovered toast outlives its 400 ms duration', (await toastState()).present);
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 1600));
  check('after the pointer leaves, it dismisses', !(await toastState()).present);

  // ── TASK-545: a keyboard-started undo-delete moves focus to Undo; Enter restores the row ──
  await page.evaluate(() => {
    document.getElementById('kb-last')?.remove();
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px;width:700px';
    host.innerHTML = '<button id="kb-before">before</button><ud-kb-page></ud-kb-page>';
    document.body.prepend(host);
  });
  const rowsText = () => page.evaluate(() => {
    const deep = (n) => (n.nodeType === 3 ? n.textContent : '') + (n.shadowRoot ? deep(n.shadowRoot) : '') + [...n.childNodes].map(deep).join('');
    return deep(document.querySelector('ud-kb-page').shadowRoot.querySelector('#table'));
  });
  await page.waitForFunction(() => !!document.querySelector('ud-kb-page')?.shadowRoot?.querySelector('#table'));
  for (let i = 0; i < 50 && !(await rowsText()).includes('Alpha'); i++) await new Promise((r) => setTimeout(r, 50));
  const onTrigger = () => page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el?.getRootNode().host?.matches('.row-action-trigger[data-id="a"]') === true;
  });
  await page.evaluate(() => document.getElementById('kb-before').focus());
  for (let i = 0; i < 25 && !(await onTrigger()); i++) await page.keyboard.press('Tab');
  check("precondition: Tab reaches row Alpha's actions trigger", await onTrigger());
  await page.evaluate(() => document.querySelector('ud-kb-page').deleteRow('a'));
  for (let i = 0; i < 50 && (await rowsText()).includes('Alpha'); i++) await new Promise((r) => setTimeout(r, 50));
  check('the keyboard-started delete removed the row', !(await rowsText()).includes('Alpha'));
  check("focus moved to the toast's Undo, not to <body>", await focusedIsAction());
  await page.keyboard.press('Enter');
  for (let i = 0; i < 50 && !(await rowsText()).includes('Alpha'); i++) await new Promise((r) => setTimeout(r, 50));
  check('Enter on Undo brings the row back', (await rowsText()).includes('Alpha'));

  // A pointer-started delete leaves focus alone: a toast that grabbed it would stay open until the user clicked away.
  await page.evaluate(() => document.querySelectorAll('b-toast-item').forEach((t) => t.remove()));
  const trigger = await page.evaluateHandle(() => document.querySelector('ud-kb-page').shadowRoot.querySelector('#table')
    .shadowRoot.querySelector('b-table').shadowRoot.querySelector('.row-action-trigger[data-id="b"]').shadowRoot.querySelector('button'));
  await trigger.click();
  await page.evaluate(() => document.querySelector('ud-kb-page').deleteRow('b'));
  for (let i = 0; i < 50 && (await rowsText()).includes('Bravo'); i++) await new Promise((r) => setTimeout(r, 50));
  check('a pointer-started delete does not move focus to Undo', !(await focusedIsAction()));

  // ── b-tag-input keeps focus across a commit (TASK-729) ──
  // Each commit re-renders, and the positional morph puts the new chip where the input was, replacing the focused
  // element: after "type, Enter" focus was on <body>, so the second value typed went nowhere.
  await page.evaluate(async () => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px;width:400px';
    host.innerHTML = '<b-tag-input id="kb-tags" label="Codes"></b-tag-input><button id="kb-after">after</button>';
    document.body.prepend(host);
    await customElements.whenDefined('b-tag-input');
    for (let i = 0; i < 50 && !document.querySelector('#kb-tags').shadowRoot?.querySelector('input'); i++) await new Promise((r) => setTimeout(r, 20));
  });
  const tags = () => page.evaluate(() => document.querySelector('#kb-tags').getTags());
  const tagInput = await page.evaluateHandle(() => document.querySelector('#kb-tags').shadowRoot.querySelector('input'));
  await tagInput.click();
  await page.keyboard.type('11111111');
  await page.keyboard.press('Enter');
  check(`after Enter focus stays in the tag input (${await focused()})`, (await focused()) === 'input');
  await page.keyboard.type('22222222');
  await page.keyboard.press('Enter');
  check(`type, Enter, type, Enter keeps both tags (${JSON.stringify(await tags())})`,
    JSON.stringify(await tags()) === '["11111111","22222222"]');
  await page.keyboard.type('33333333,44444444');
  await page.keyboard.press('Tab');
  check(`a separator then Tab commit both and keep focus (${JSON.stringify(await tags())}, ${await focused()})`,
    (await tags()).length === 4 && (await focused()) === 'input');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  check(`repeated Backspace removes one tag per press (${JSON.stringify(await tags())})`,
    JSON.stringify(await tags()) === '["11111111","22222222"]');
  await page.keyboard.press('Tab');
  check(`with an empty buffer Tab still leaves the control (${await focused()})`, (await focused()) === 'kb-after');

  // ── b-ribbon: arrow keys in the panel (TASK-731) ──
  // The panel is one Tab stop and the arrows move by position. Before, every command was a Tab stop, Left/Right
  // walked a flat list that included the commands of CLOSED flyouts, and folded groups' buttons were skipped.
  const mountRibbon = (width) => page.evaluate(async (w) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned style="width:${w}px"></b-ribbon><button id="kb-after">after</button>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const it = (g, ids) => ids.map((id) => ({ id, label: id, icon: '●' }));
    document.getElementById('kb-ribbon').setTabs([
      { id: 'home', label: 'Home', groups: [
        { id: 'clip', label: 'Clipboard', icon: '📋', items: it('clip', ['Paste', 'Cut', 'Copy']) },
        { id: 'rec', label: 'Records', icon: '🗂', items: it('rec', ['New', 'Delete', 'Duplicate']) },
        { id: 'lay', label: 'Layout', icon: '▦', items: it('lay', ['Columns', 'Rows']) },
        { id: 'exp', label: 'Export', icon: '📤', items: it('exp', ['PDF', 'CSV', 'Print']) },
      ] },
      { id: 'insert', label: 'Insert', groups: [{ id: 'ins', label: 'Insert', items: it('ins', ['Image']) }] },
    ]);
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 25));
  }, width);
  /** The focused element inside the ribbon: a command's id, `chunk:<group>`, `tab:<id>`, else what focused() says. */
  const inRibbon = () => page.evaluate(() => {
    const el = document.getElementById('kb-ribbon')?.shadowRoot?.activeElement;
    if (!el) return 'outside';
    if (el.dataset.chunk) return `chunk:${el.dataset.chunk}`;
    if (el.dataset.item) return (el.closest('.ribbon-flyout') ? 'flyout:' : '') + el.dataset.item;
    if (el.classList.contains('ribbon-tab')) return `tab:${el.dataset.tab}`;
    return el.id || el.tagName.toLowerCase();
  });
  const press = async (...keys) => { for (const k of keys) await page.keyboard.press(k); return inRibbon(); };

  await mountRibbon(1000);
  await focusBefore();
  check(`precondition: Tab reaches the active ribbon tab (${await press('Tab')})`, (await inRibbon()) === 'tab:home');
  check(`ArrowDown from a tab enters the panel at its first command (${await press('ArrowDown')})`, (await inRibbon()) === 'Paste');
  check(`ArrowRight moves to the next group, same row (${await press('ArrowRight')})`, (await inRibbon()) === 'New');
  check(`ArrowDown stays in the column (${await press('ArrowDown')})`, (await inRibbon()) === 'Delete');
  check(`ArrowLeft goes back across the group boundary (${await press('ArrowLeft')})`, (await inRibbon()) === 'Cut');
  check(`ArrowUp then ArrowUp from the top row returns to the tab (${await press('ArrowUp', 'ArrowUp')})`, (await inRibbon()) === 'tab:home');
  await press('ArrowDown');
  check(`End goes to the last command (${await press('End')})`, (await inRibbon()) === 'Print');
  check(`ArrowRight at the end wraps to the first (${await press('ArrowRight')})`, (await inRibbon()) === 'Paste');
  check(`Home goes to the first command (${await press('ArrowRight', 'Home')})`, (await inRibbon()) === 'Paste');
  const zeroStops = () => page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot
    .querySelectorAll('.ribbon-panel-inner .ribbon-item, .ribbon-panel-inner .ribbon-chunk')].filter((e) => e.tabIndex === 0).map((e) => e.dataset.item ?? e.dataset.chunk));
  await press('ArrowRight', 'ArrowDown');
  check(`exactly one panel command is a Tab stop, the focused one (${JSON.stringify(await zeroStops())})`, JSON.stringify(await zeroStops()) === '["Delete"]');
  const afterPanel = await press('Tab');
  check(`Tab leaves the panel after one stop (${afterPanel}, ${await focused()})`, afterPanel === 'outside' && (await focused()) === 'kb-after');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  check(`Shift+Tab comes back to the command focused last (${await inRibbon()})`, (await inRibbon()) === 'Delete');
  await page.evaluate(() => { document.getElementById('kb-ribbon').style.width = '700px'; });
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 25));
  check(`a scaling re-render keeps focus on the same command (${await inRibbon()})`, (await inRibbon()) === 'Delete');

  // Folded groups: one stop each, Enter or ArrowDown opens the flyout and moves into it, Escape comes back.
  await mountRibbon(230);
  const sizes = await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-panel-inner > .ribbon-group')].map((g) => [...g.classList].find((c) => c.startsWith('size-'))));
  check(`precondition: at 230px every group is folded (${sizes.join(',')})`, sizes.every((s) => s === 'size-popup'));
  await focusBefore();
  await press('Tab');
  check(`ArrowDown from the tab reaches the first folded group (${await press('ArrowDown')})`, (await inRibbon()) === 'chunk:clip');
  check(`ArrowRight moves between folded groups (${await press('ArrowRight')})`, (await inRibbon()) === 'chunk:rec');
  check(`Enter opens the flyout and focuses its first command (${await press('Enter')})`, (await inRibbon()) === 'flyout:New');
  check(`arrows move inside the flyout (${await press('ArrowRight')})`, (await inRibbon()) === 'flyout:Delete');
  // A popover closes on Escape through a close request, a task later, and its focus return follows: wait for it.
  const settled = async (want) => { for (let i = 0; i < 20 && (await inRibbon()) !== want; i++) await new Promise((r) => setTimeout(r, 25)); return inRibbon(); };
  await page.keyboard.press('Escape');
  check(`Escape closes it and gives focus back to its button (${await settled('chunk:rec')})`, (await inRibbon()) === 'chunk:rec');
  check(`ArrowDown on a folded group opens it too (${await press('ArrowDown')})`, (await inRibbon()) === 'flyout:New');
  await press('Escape');
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nkeyboard-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
