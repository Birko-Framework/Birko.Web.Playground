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
  // A focused command shows its tooltip (TASK-738), and Escape dismisses that first without moving focus (WCAG
  // 1.4.13); the second Escape closes the flyout.
  await page.keyboard.press('Escape');
  check(`the first Escape only hides the tooltip (${await inRibbon()})`, (await inRibbon()) === 'flyout:Delete');
  await page.keyboard.press('Escape');
  check(`Escape closes it and gives focus back to its button (${await settled('chunk:rec')})`, (await inRibbon()) === 'chunk:rec');
  check(`ArrowDown on a folded group opens it too (${await press('ArrowDown')})`, (await inRibbon()) === 'flyout:New');
  await press('Escape', 'Escape');
  await settled('chunk:rec');
  await press('ArrowLeft');
  // A close that focus had already left must not pull it back: open the flyout, click outside the ribbon.
  await press('Enter');
  // #kb-before, not #kb-after: the open flyout hangs over #kb-after, so a click there lands inside the flyout.
  await page.click('#kb-before');
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 25));
  check(`a flyout closed by a click elsewhere leaves focus there (${await focused()})`, (await focused()) === 'kb-before');

  // ── b-ribbon: split and menu buttons (TASK-732) ──
  // Here rather than in verify.mjs: an auto popover closes every other one, and verify runs every suite at once.
  await page.evaluate(async () => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = '<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned style="width:900px"></b-ribbon><button id="kb-after">after</button>';
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    window.__kbClicks = [];
    const r = document.getElementById('kb-ribbon');
    r.addEventListener('item-click', (e) => window.__kbClicks.push(e.detail));
    r.setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', icon: '📋', items: [
        { id: 'paste', label: 'Paste', icon: '📋', split: true, menu: [
          { id: 'paste-text', label: 'Paste as text', shortcut: 'Ctrl+Shift+V' }, { id: 'paste-off', label: 'Paste off', disabled: true },
          { separator: true }, { id: 'paste-special', label: 'Paste special' }] },
        { id: 'cut', label: 'Cut', icon: '✂️' },
      ] },
      { id: 'exp', label: 'Export', icon: '📤', items: [
        { id: 'csv', label: 'CSV', icon: '📊', menu: [{ id: 'csv-comma', label: 'Comma' }, { id: 'csv-semi', label: 'Semicolon' }] },
      ] },
    ] }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  });
  const menuState = () => page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const open = [...sr.querySelectorAll('.ribbon-menu')].filter((m) => m.matches(':popover-open')).map((m) => m.getAttribute('aria-label'));
    const el = sr.activeElement;
    const focus = !el ? 'outside' : el.dataset.menuItem ? `menu:${el.dataset.menuItem}` : el.dataset.arrow ? `arrow:${el.dataset.arrow}` : el.dataset.item ?? el.tagName;
    return { open, focus, clicks: window.__kbClicks };
  });
  const handle = (sel) => page.evaluateHandle((s) => document.getElementById('kb-ribbon').shadowRoot.querySelector(s), sel);

  await (await handle('.ribbon-split-main')).click();
  let st = await menuState();
  check(`clicking the main part runs Paste and opens nothing (${JSON.stringify(st.clicks)})`, st.clicks.length === 1 && st.clicks[0].itemId === 'paste' && st.open.length === 0);
  await (await handle('.ribbon-split-arrow')).click();
  st = await menuState();
  check(`clicking ▾ opens the menu, runs nothing, keeps focus on ▾ (${st.open}, ${st.focus})`, JSON.stringify(st.open) === '["Paste"]' && st.clicks.length === 1 && st.focus === 'arrow:paste');
  await (await handle('.ribbon-menu-item[data-menu-item="paste-special"]')).click();
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 25));
  st = await menuState();
  check(`a clicked choice reports itself and its parent, and closes (${JSON.stringify(st.clicks.at(-1))})`,
    st.clicks.at(-1)?.itemId === 'paste-special' && st.clicks.at(-1)?.parentId === 'paste' && st.open.length === 0);

  // Keyboard: Enter on ▾ moves into the menu; arrows skip the disabled choice and wrap; Escape returns to ▾.
  await (await handle('.ribbon-split-arrow')).focus();
  await page.keyboard.press('Enter');
  st = await menuState();
  check(`Enter on ▾ opens the menu at its first choice (${st.focus})`, st.focus === 'menu:paste-text');
  await page.keyboard.press('ArrowDown');
  check(`ArrowDown skips the disabled choice and the separator (${(await menuState()).focus})`, (await menuState()).focus === 'menu:paste-special');
  await page.keyboard.press('ArrowDown');
  check(`ArrowDown wraps to the first (${(await menuState()).focus})`, (await menuState()).focus === 'menu:paste-text');
  await page.keyboard.press('ArrowUp');
  check(`ArrowUp wraps to the last (${(await menuState()).focus})`, (await menuState()).focus === 'menu:paste-special');
  await page.keyboard.press('Escape');
  for (let i = 0; i < 20 && (await menuState()).focus !== 'arrow:paste'; i++) await new Promise((r) => setTimeout(r, 25));
  st = await menuState();
  check(`Escape closes the menu and returns to ▾ (${st.open}, ${st.focus})`, st.open.length === 0 && st.focus === 'arrow:paste');
  await (await handle('.ribbon-split-main')).focus();
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Alt');
  st = await menuState();
  check(`Alt+ArrowDown on the command opens its menu (${st.open}, ${st.focus})`, JSON.stringify(st.open) === '["Paste"]' && st.focus === 'menu:paste-text');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 20 && (await menuState()).focus !== 'arrow:paste'; i++) await new Promise((r) => setTimeout(r, 25));
  st = await menuState();
  check(`Enter on a choice runs it, closes, focus back on ▾ (${JSON.stringify(st.clicks.at(-1))}, ${st.focus})`,
    st.clicks.at(-1)?.itemId === 'paste-text' && st.open.length === 0 && st.focus === 'arrow:paste');
  await (await handle('.ribbon-item[data-item="csv"]')).focus();
  const n = (await menuState()).clicks.length;
  await page.keyboard.press('Space');
  st = await menuState();
  check(`Space on a menu-only command opens it, emits nothing (${st.open}, ${st.focus})`, JSON.stringify(st.open) === '["CSV"]' && st.focus === 'menu:csv-comma' && st.clicks.length === n);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 20 && ((await menuState()).open.length || (await menuState()).focus !== 'csv'); i++) await new Promise((r) => setTimeout(r, 25));
  st = await menuState();
  check(`Tab closes the menu and focus stays on its command (${st.open}, ${st.focus})`, st.open.length === 0 && st.focus === 'csv');
  await page.keyboard.press('Space');
  await page.click('#kb-after');
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 25));
  check(`a menu closed by a click elsewhere leaves focus there (${await focused()})`, (await focused()) === 'kb-after' && (await menuState()).open.length === 0);

  // ── b-ribbon: tooltips through the shared b-tooltip (TASK-738) ──
  await page.evaluate(async () => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = '<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned style="width:900px"></b-ribbon><button id="kb-after">after</button>';
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    document.getElementById('kb-ribbon').setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', icon: '📋', items: [
        { id: 'paste', label: 'Paste', icon: '📋', description: 'Add content from the clipboard.', shortcut: 'Ctrl+V', split: true, menu: [{ id: 'pt', label: 'Paste as text' }] },
        { id: 'cut', label: 'Cut', icon: '✂️', description: 'Remove the selection.', shortcut: 'Ctrl+X' },
        { id: 'copy', label: 'Copy', icon: '📄' },
      ] },
    ] }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  });
  const tipState = () => page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const tipEl = sr.querySelector('b-tooltip.ribbon-tooltip')?.shadowRoot?.querySelector('.tip');
    const open = !!tipEl?.matches(':popover-open');
    return { open, text: open ? [...tipEl.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' ') : '', focus: sr.activeElement?.dataset?.item ?? sr.activeElement?.dataset?.arrow ?? (sr.activeElement ? sr.activeElement.className : 'outside') };
  });
  const centre = (sel) => page.evaluate((s) => {
    const r = document.getElementById('kb-ribbon').shadowRoot.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await page.mouse.move(5, 300);
  await wait(400);
  let c = await centre('.ribbon-item[data-item="cut"]');
  await page.mouse.move(c.x, c.y);
  await wait(200);
  check(`hovering does not show the tooltip at once (${(await tipState()).open})`, !(await tipState()).open);
  await wait(500);
  let ts = await tipState();
  check(`after the delay it shows name, shortcut and description (${ts.text})`, ts.open && ts.text === 'Cut (Ctrl+X) Remove the selection.');
  c = await centre('.ribbon-item[data-item="copy"]');
  await page.mouse.move(c.x, c.y);
  await wait(60);
  ts = await tipState();
  check(`moving to the next command shows its tooltip at once (${ts.text})`, ts.open && ts.text === 'Copy');
  c = await centre('.ribbon-split-arrow');
  await page.mouse.move(c.x, c.y);
  await wait(60);
  check(`the ▾ part has its own tooltip (${(await tipState()).text})`, (await tipState()).text === 'More options: Paste');
  await page.mouse.move(5, 300);
  await wait(60);
  check('leaving the ribbon hides it', !(await tipState()).open);
  await page.mouse.move(5, 300);
  await wait(500); // cool down: past the "warm" window the next hover waits for the delay again

  // Keyboard focus shows it at once; Escape hides it without leaving the command; a second Escape goes to the tab.
  await focusBefore();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  ts = await tipState();
  check(`keyboard focus shows the focused command's tooltip at once (${ts.focus}: ${ts.text})`, ts.open && ts.focus === 'paste' && ts.text === 'Paste (Ctrl+V) Add content from the clipboard.');
  await page.keyboard.press('ArrowDown');
  ts = await tipState();
  check(`and follows the focus (${ts.text})`, ts.text === 'Cut (Ctrl+X) Remove the selection.');
  await page.keyboard.press('Escape');
  ts = await tipState();
  check(`Escape hides it and focus stays on the command (${ts.open}, ${ts.focus})`, !ts.open && ts.focus === 'cut');
  await page.keyboard.press('Escape');
  check(`a second Escape goes back to the tab (${(await tipState()).focus})`, (await tipState()).focus.includes('ribbon-tab'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  check(`on the ▾ part (${(await tipState()).text})`, (await tipState()).text === 'More options: Paste');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10; i++) await wait(20);
  check(`opening the menu hides the tooltip (${(await tipState()).open})`, !(await tipState()).open);
  await page.keyboard.press('Escape');
  await page.click('#kb-after');

  // Over a folded group's flyout: the tooltip is in the top layer, above the popover.
  await page.evaluate(() => { document.getElementById('kb-ribbon').style.width = '60px'; });
  for (let i = 0; i < 12; i++) await wait(25);
  const chunk = (await page.evaluateHandle(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-chunk'))).asElement();
  if (chunk) {
    await chunk.click();
    await wait(60);
    c = await centre('.ribbon-flyout .ribbon-item[data-item="cut"]');
    await page.mouse.move(c.x, c.y);
    await wait(700);
    // The top layer paints popovers in the order they opened, so "on top" is: both open, the tooltip opened after
    // the flyout (it is shown on hover, the flyout was already up). Hit-testing cannot see it: pointer-events: none.
    const top = await page.evaluate(() => {
      const sr = document.getElementById('kb-ribbon').shadowRoot;
      const tip = sr.querySelector('b-tooltip.ribbon-tooltip').shadowRoot.querySelector('.tip');
      const flyout = sr.querySelector('.ribbon-flyout:popover-open');
      return `${tip.matches(':popover-open') ? 'tip open' : 'tip closed'}, ${flyout ? 'flyout open' : 'flyout closed'}, ${tip.text ?? tip.textContent.trim()}`;
    });
    check(`over a flyout the tooltip is in the top layer with it (${top})`, top.startsWith('tip open, flyout open'));
  } else {
    check('precondition: at 60px a group is folded', false);
  }

  // ── b-ribbon: toggle buttons from the keyboard (TASK-739) ──
  await page.evaluate(async () => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = '<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned style="width:900px"></b-ribbon><button id="kb-after">after</button>';
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    document.getElementById('kb-ribbon').setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'font', label: 'Font', items: [{ id: 'bold', label: 'Bold', toggle: true }, { id: 'italic', label: 'Italic', toggle: true }] },
      { id: 'align', label: 'Alignment', items: [{ id: 'left', label: 'Left', toggleGroup: 'al', pressed: true }, { id: 'right', label: 'Right', toggleGroup: 'al' }] },
    ] }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  });
  const toggleState = (id) => page.evaluate((i) => {
    const b = document.getElementById('kb-ribbon').shadowRoot.querySelector(`.ribbon-panel-inner .ribbon-item[data-item="${i}"]`);
    return b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked');
  }, id);
  await focusBefore();
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  check(`Space on a toggle turns it on (${await toggleState('bold')})`, (await toggleState('bold')) === 'true');
  await page.keyboard.press('Enter');
  check(`Enter turns it off again (${await toggleState('bold')})`, (await toggleState('bold')) === 'false');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  check(`Space on a set member selects it and releases the other (${await toggleState('right')}, ${await toggleState('left')})`, (await toggleState('right')) === 'true' && (await toggleState('left')) === 'false');

  // ── b-ribbon: double-click a tab, and Ctrl+F1 anywhere (TASK-735) ──
  await page.evaluate(async () => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = '<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned style="width:900px"></b-ribbon><button id="kb-after">after</button>';
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const r = document.getElementById('kb-ribbon');
    window.__kbPins = [];
    r.addEventListener('pin', (e) => window.__kbPins.push(e.detail.pinned));
    r.setTabs([
      { id: 'home', label: 'Home', groups: [{ id: 'g', label: 'G', items: [{ id: 'a', label: 'A' }] }] },
      { id: 'view', label: 'View', groups: [{ id: 'v', label: 'V', items: [{ id: 'b', label: 'B' }] }] },
    ]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  });
  const ribbonState = () => page.evaluate(() => {
    const r = document.getElementById('kb-ribbon');
    return `${r.hasAttribute('pinned') ? 'pinned' : 'unpinned'} ${r.hasAttribute('expanded') ? 'expanded' : 'collapsed'} ${r.getAttribute('active')}`;
  });
  const ctrlF1 = async (mods = ['Control']) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.keyboard.press('F1');
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
    await new Promise((r) => setTimeout(r, 40));
  };
  const tabHandle = async (id) => (await page.evaluateHandle((i) => document.getElementById('kb-ribbon').shadowRoot.querySelector(`#ribbon-tab-${i}`), id)).asElement();

  await (await tabHandle('home')).click({ count: 2 });
  await new Promise((r) => setTimeout(r, 40));
  check(`double-clicking a tab collapses the ribbon to its tabs (${await ribbonState()})`, (await ribbonState()) === 'unpinned collapsed home');
  await (await tabHandle('home')).click({ count: 2 });
  await new Promise((r) => setTimeout(r, 40));
  check(`double-clicking again brings it back, pinned (${await ribbonState()})`, (await ribbonState()) === 'pinned expanded home');
  check(`each emits pin (${JSON.stringify(await page.evaluate(() => window.__kbPins))})`, JSON.stringify(await page.evaluate(() => window.__kbPins)) === '[false,true]');
  await (await tabHandle('view')).click();
  await new Promise((r) => setTimeout(r, 40));
  check(`a single click still only selects a tab (${await ribbonState()})`, (await ribbonState()) === 'pinned expanded view');

  await page.focus('#kb-after');
  await ctrlF1();
  check(`Ctrl+F1 works with focus outside the ribbon (${await ribbonState()})`, (await ribbonState()).startsWith('unpinned collapsed'));
  await ctrlF1();
  check(`Ctrl+F1 again brings it back (${await ribbonState()})`, (await ribbonState()).startsWith('pinned expanded'));
  await page.evaluate(() => {
    window.__kbAppF1 = (e) => { if (e.ctrlKey && e.key === 'F1') e.preventDefault(); };
    window.addEventListener('keydown', window.__kbAppF1, true);
  });
  await ctrlF1();
  check(`a key press the app handled first is left alone (${await ribbonState()})`, (await ribbonState()).startsWith('pinned expanded'));
  await page.evaluate(() => window.removeEventListener('keydown', window.__kbAppF1, true));
  await page.evaluate(() => document.getElementById('kb-ribbon').setAttribute('collapse-shortcut', 'none'));
  await ctrlF1();
  check(`collapse-shortcut="none" turns it off (${await ribbonState()})`, (await ribbonState()).startsWith('pinned expanded'));
  await page.evaluate(() => document.getElementById('kb-ribbon').setAttribute('collapse-shortcut', 'Ctrl+Shift+F1'));
  await ctrlF1();
  const plain = await ribbonState();
  await ctrlF1(['Control', 'Shift']);
  check(`a rebound shortcut replaces Ctrl+F1 (${plain} → ${await ribbonState()})`, plain.startsWith('pinned expanded') && (await ribbonState()).startsWith('unpinned collapsed'));
  const btn = await page.evaluate(() => {
    const b = document.getElementById('kb-ribbon').shadowRoot.querySelector('#ribbon-toggle');
    return `${b.getAttribute('title')} | ${b.getAttribute('aria-keyshortcuts')}`;
  });
  check(`the collapse button names the shortcut (${btn})`, btn.includes('(Ctrl+Shift+F1)') && btn.includes('Control+Shift+F1'));
  await page.evaluate(() => document.getElementById('kb-host').remove());
  let threw = false;
  try { await ctrlF1(); } catch { threw = true; }
  check('a removed ribbon leaves no listener behind (no error)', !threw);

  // ── b-ribbon: Quick Access Toolbar (TASK-737) ──
  const mountQat = (attrs = '') => page.evaluate(async (extra) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned qat-key="kbtest" ${extra} style="width:900px"></b-ribbon><button id="kb-after">after</button>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const r = document.getElementById('kb-ribbon');
    window.__kbClicks = [];
    window.__kbQat = [];
    r.addEventListener('item-click', (e) => window.__kbClicks.push(e.detail));
    r.addEventListener('quick-access-change', (e) => window.__kbQat.push(e.detail.refs));
    r.setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', items: [{ id: 'cut', label: 'Cut', icon: '✂️' }, { id: 'bold', label: 'Bold', toggle: true }] },
      { id: 'exp', label: 'Export', items: [{ id: 'csv', label: 'CSV', menu: [{ id: 'c1', label: 'Comma' }] }] },
    ] }]);
    r.setQuickAccess([{ id: 'save', label: 'Save', icon: '💾' }, { id: 'undo', label: 'Undo', icon: '↶' }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  }, attrs);
  const qatState = () => page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const menu = sr.querySelector('.ribbon-shared-menu');
    return {
      buttons: [...sr.querySelectorAll('.ribbon-qat-btn[data-qat-ref]')].map((b) => b.getAttribute('aria-label')),
      menu: menu.matches(':popover-open') ? [...menu.querySelectorAll('.ribbon-menu-item')].map((m) => m.textContent.trim() + (m.hasAttribute('aria-checked') ? `[${m.getAttribute('aria-checked')}]` : '')) : null,
      focus: sr.activeElement ? (sr.activeElement.getAttribute('aria-label') ?? sr.activeElement.textContent.trim()) : 'outside',
      stored: localStorage.getItem('birko-ribbon-qat:kbtest'),
      clicks: window.__kbClicks, changes: window.__kbQat,
    };
  });
  const sel = (q) => page.evaluateHandle((x) => document.getElementById('kb-ribbon').shadowRoot.querySelector(x), q).then((h) => h.asElement());
  // Clicks by coordinates read at the moment of the click: the ribbon's hover preview re-renders its panel when the
  // pointer crosses a tab, which detaches an element handle taken a moment earlier.
  const clickAt = async (q, opts = {}) => {
    const c = await page.evaluate((x) => {
      const r = document.getElementById('kb-ribbon').shadowRoot.querySelector(x).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, q);
    await page.mouse.click(c.x, c.y, opts);
  };
  const pause = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  await page.evaluate(() => localStorage.removeItem('birko-ribbon-qat:kbtest'));

  await mountQat();
  let q = await qatState();
  check(`the toolbar shows the app's commands (${q.buttons})`, JSON.stringify(q.buttons) === '["Save","Undo"]');
  const geo = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const a = sr.querySelector('.ribbon-qat').getBoundingClientRect();
    const t = sr.querySelector('.ribbon-tab').getBoundingClientRect();
    return { before: a.right <= t.left + 1, sameRow: Math.abs((a.top + a.bottom) / 2 - (t.top + t.bottom) / 2) < 8 };
  });
  check(`by default it sits in the tab row, before the tabs (${JSON.stringify(geo)})`, geo.before && geo.sameRow);
  await clickAt('.ribbon-qat-btn[data-qat-ref="qat:save"]');
  q = await qatState();
  check(`a toolbar button reports its command with source "qat" (${JSON.stringify(q.clicks.at(-1))})`, q.clicks.at(-1)?.itemId === 'save' && q.clicks.at(-1)?.source === 'qat');

  // Keyboard: one Tab stop, arrows inside.
  await focusBefore();
  await page.keyboard.press('Tab');
  q = await qatState();
  check(`Tab reaches the toolbar first, on one button (${q.focus})`, q.focus === 'Save');
  await page.keyboard.press('ArrowRight');
  check(`ArrowRight moves inside the toolbar (${(await qatState()).focus})`, (await qatState()).focus === 'Undo');
  await page.keyboard.press('Tab');
  check(`the next Tab leaves it for the tabs (${(await qatState()).focus})`, (await qatState()).focus === 'Home');

  // Add from a command's context menu (right-click), then use it.
  await clickAt('.ribbon-panel-inner .ribbon-item[data-item="cut"]', { button: 'right' });
  await pause();
  q = await qatState();
  check(`right-clicking a command offers "Add to Quick Access Toolbar" (${q.menu}, ${q.focus})`, JSON.stringify(q.menu) === '["Add to Quick Access Toolbar"]' && q.focus === 'Add to Quick Access Toolbar');
  await page.keyboard.press('Enter');
  await pause();
  q = await qatState();
  check(`Enter adds it, saves it, reports it (${q.buttons}; ${q.stored}; ${JSON.stringify(q.changes.at(-1))})`,
    JSON.stringify(q.buttons) === '["Save","Undo","Cut"]' && q.stored === '["qat:save","qat:undo","item:home/clip/cut"]' && q.changes.length === 1);
  await clickAt('.ribbon-qat-btn[data-qat-ref="item:home/clip/cut"]');
  q = await qatState();
  check(`the added button runs the command (${JSON.stringify(q.clicks.at(-1))})`, q.clicks.at(-1)?.itemId === 'cut' && q.clicks.at(-1)?.tabId === 'home' && q.clicks.at(-1)?.source === 'qat');
  await clickAt('.ribbon-panel-inner .ribbon-item[data-item="csv"]', { button: 'right' });
  await pause();
  check(`a menu-only command cannot be added (${(await qatState()).menu})`, (await qatState()).menu === null);
  await page.keyboard.press('Escape');

  // Toggle commands keep their state in the toolbar too.
  await clickAt('.ribbon-panel-inner .ribbon-item[data-item="bold"]', { button: 'right' });
  await pause();
  await page.keyboard.press('Enter');
  await pause();
  await clickAt('.ribbon-qat-btn[data-qat-ref="item:home/clip/bold"]');
  const bold = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    return `${sr.querySelector('.ribbon-qat-btn[data-qat-ref="item:home/clip/bold"]').getAttribute('aria-pressed')}/${sr.querySelector('.ribbon-panel-inner .ribbon-item[data-item="bold"]').getAttribute('aria-pressed')}`;
  });
  check(`a toggle pressed in the toolbar is pressed in the ribbon too (${bold})`, bold === 'true/true');

  // Remove with Shift+F10 on a toolbar button.
  await (await sel('.ribbon-qat-btn[data-qat-ref="item:home/clip/cut"]')).focus();
  await page.keyboard.down('Shift'); await page.keyboard.press('F10'); await page.keyboard.up('Shift');
  await pause();
  q = await qatState();
  check(`Shift+F10 on a toolbar button offers "Remove" (${q.menu})`, JSON.stringify(q.menu) === '["Remove from Quick Access Toolbar"]');
  await page.keyboard.press('Enter');
  await pause();
  check(`Enter removes it (${(await qatState()).buttons})`, JSON.stringify((await qatState()).buttons) === '["Save","Undo","Bold"]');

  // Customise: show/hide the defaults, reset.
  await clickAt('.ribbon-qat-more');
  await pause();
  q = await qatState();
  check(`▾ lists the commands as checkboxes, then Reset (${q.menu})`, JSON.stringify(q.menu) === '["Save[true]","Undo[true]","Bold[true]","Reset to default"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await pause();
  q = await qatState();
  check(`unchecking Undo hides it, focus back on ▾ (${q.buttons}, ${q.focus})`, JSON.stringify(q.buttons) === '["Save","Bold"]' && q.focus === 'Customize Quick Access Toolbar');

  // A hover preview re-renders the panel and used to re-bind menu handlers onto the OPEN shared menu, swallowing its
  // choice: hover a tab while the ▾ menu is open, then choose.
  await clickAt('.ribbon-qat-more');
  await pause();
  const tabPos = await page.evaluate(() => {
    const r = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-tab').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(tabPos.x, tabPos.y);
  await pause(400); // past the pinned hover preview's 200 ms re-render
  await page.mouse.move(5, 400);
  await pause(400);
  check(`precondition: the ▾ menu is still open after the hover (${(await qatState()).menu})`, (await qatState()).menu !== null);
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-shared-menu .ribbon-menu-item[data-ref="qat:undo"]').focus());
  const clicksBefore = (await qatState()).clicks.length;
  await page.keyboard.press('Enter');
  await pause();
  q = await qatState();
  check(`after a hover preview the ▾ menu still works, and emits no stray item-click (${q.buttons}, ${q.clicks.length - clicksBefore})`,
    JSON.stringify(q.buttons) === '["Save","Undo","Bold"]' && q.clicks.length === clicksBefore);
  // Undo is back; hide it again so the reload check below starts from Save, Bold.
  await clickAt('.ribbon-qat-more');
  await pause();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await pause();

  // The choice survives a reload; hostile storage is ignored.
  await mountQat();
  check(`the saved choice is restored (${(await qatState()).buttons})`, JSON.stringify((await qatState()).buttons) === '["Save","Bold"]');
  await page.evaluate(() => localStorage.setItem('birko-ribbon-qat:kbtest', JSON.stringify(['qat:save', '<img src=x onerror=1>', 5, 'item:../../x', 'item:home/clip/gone'])));
  await mountQat();
  check(`malformed, foreign and unknown entries are ignored (${(await qatState()).buttons})`, JSON.stringify((await qatState()).buttons) === '["Save"]');
  await page.evaluate(() => localStorage.setItem('birko-ribbon-qat:kbtest', '{"not":"a list"}'));
  await mountQat();
  check(`a stored value that is not a list falls back to the defaults (${(await qatState()).buttons})`, JSON.stringify((await qatState()).buttons) === '["Save","Undo"]');
  await page.evaluate(() => localStorage.setItem('birko-ribbon-qat:kbtest', '["qat:save"]'));
  await mountQat();
  await clickAt('.ribbon-qat-more');
  await pause();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await pause();
  q = await qatState();
  check(`Reset brings the defaults back and clears the storage (${q.buttons}, ${q.stored})`, JSON.stringify(q.buttons) === '["Save","Undo"]' && q.stored === null);

  // Positions.
  for (const pos of ['above', 'below']) {
    await mountQat(`qat-position="${pos}"`);
    const where = await page.evaluate((c) => {
      const sr = document.getElementById('kb-ribbon').shadowRoot;
      const row = sr.querySelector(`.ribbon-qat-row.${c}`);
      const tabs = sr.querySelector('.ribbon-tab-row').getBoundingClientRect();
      const panel = sr.querySelector('.ribbon-panel').getBoundingClientRect();
      if (!row) return 'missing';
      const r = row.getBoundingClientRect();
      return c === 'above' ? (r.bottom <= tabs.top + 1 ? 'above the tabs' : 'wrong') : (r.top >= panel.bottom - 1 ? 'below the panel' : 'wrong');
    }, pos);
    check(`qat-position="${pos}" moves it (${where})`, where === (pos === 'above' ? 'above the tabs' : 'below the panel'));
  }
  // Opt-in: a ribbon whose app never asked for a toolbar has none, and a right-click offers nothing.
  await page.evaluate(async () => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = '<b-ribbon id="kb-ribbon" expanded pinned style="width:900px"></b-ribbon>';
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    document.getElementById('kb-ribbon').setTabs([{ id: 'home', label: 'Home', groups: [{ id: 'clip', label: 'Clipboard', items: [{ id: 'cut', label: 'Cut' }] }] }]);
    for (let i = 0; i < 20; i++) await new Promise((res) => setTimeout(res, 25));
  });
  await clickAt('.ribbon-panel-inner .ribbon-item[data-item="cut"]', { button: 'right' });
  await pause();
  const off = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    return `${sr.querySelectorAll('.ribbon-qat').length} toolbar, menu ${sr.querySelector('.ribbon-shared-menu').matches(':popover-open') ? 'open' : 'closed'}`;
  });
  check(`without setQuickAccess there is no toolbar and no "Add" menu (${off})`, off === '0 toolbar, menu closed');
  await page.evaluate(() => document.getElementById('kb-ribbon').setQuickAccess([]));
  await pause();
  await clickAt('.ribbon-panel-inner .ribbon-item[data-item="cut"]', { button: 'right' });
  await pause();
  await page.keyboard.press('Enter');
  await pause();
  const filled = await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-qat-btn[data-qat-ref]')].map((b) => b.getAttribute('aria-label')).join(','));
  check(`setQuickAccess([]) gives an empty toolbar the user can fill (${filled})`, filled === 'Cut');
  await page.evaluate(() => document.getElementById('kb-ribbon').setQuickAccess(null));
  await pause();
  check('setQuickAccess(null) turns it off again', await page.evaluate(() => !document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-qat')));
  await page.evaluate(() => localStorage.removeItem('birko-ribbon-qat:kbtest'));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nkeyboard-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
