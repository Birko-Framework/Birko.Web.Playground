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
  // ── b-ribbon: key tips (TASK-736) ──
  const mountKt = (width = 900, attrs = '') => page.evaluate(async ({ w, extra }) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<input id="kb-input"><b-ribbon id="kb-ribbon" expanded pinned ${extra} style="width:${w}px"></b-ribbon>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const r = document.getElementById('kb-ribbon');
    window.__kbClicks = [];
    r.addEventListener('item-click', (e) => window.__kbClicks.push(e.detail));
    r.setTabs([
      { id: 'home', label: 'Home', groups: [
        { id: 'clip', label: 'Clipboard', icon: '📋', items: [
          { id: 'paste', label: 'Paste', keytip: 'V', split: true, menu: [{ id: 'pt', label: 'Paste as text' }, { id: 'pp', label: 'Picture' }] },
          { id: 'cut', label: 'Cut' }, { id: 'copy', label: 'Copy' }] },
        { id: 'num', label: 'Number', icon: '🔢', items: [{ id: 'cislo', label: 'Číslo' }] },
        ...(w < 300 ? [
          { id: 'rec', label: 'Records', icon: '🗂', items: [{ id: 'new', label: 'New' }, { id: 'del', label: 'Delete' }, { id: 'dup', label: 'Duplicate' }] },
          { id: 'exp', label: 'Export', icon: '📤', items: [{ id: 'pdf', label: 'PDF' }, { id: 'csv2', label: 'CSV' }, { id: 'print', label: 'Print' }] },
        ] : []),
      ] },
      { id: 'insert', label: 'Insert', groups: [{ id: 'ins', label: 'Insert', items: [{ id: 'image', label: 'Image' }] }] },
      { id: 'data', label: 'Data', keytip: 'A', groups: [{ id: 'd', label: 'D', items: [{ id: 'sort', label: 'Sort' }] }] },
    ]);
    r.setQuickAccess([{ id: 'save', label: 'Save', icon: '💾' }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  }, { w: width, extra: attrs });
  const tips = () => page.evaluate(() => {
    const layer = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-keytips');
    return layer.matches(':popover-open') ? [...layer.querySelectorAll('.ribbon-keytip')].map((t) => t.textContent).sort().join('') : '';
  });
  const combo = async (mods = ['Alt', 'Meta']) => {
    for (const m of mods) await page.keyboard.down(m);
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
    await new Promise((r) => setTimeout(r, 80));
  };
  const key = async (k) => { await page.keyboard.press(k); await new Promise((r) => setTimeout(r, 80)); };
  const last = async () => JSON.stringify((await page.evaluate(() => window.__kbClicks)).at(-1) ?? null);
  const active = () => page.evaluate(() => document.getElementById('kb-ribbon').getAttribute('active'));

  await mountKt();
  await page.focus('#kb-input');
  await page.keyboard.type('abc');
  check(`typing in an input is untouched and shows no tips (${await page.evaluate(() => document.getElementById('kb-input').value)}, "${await tips()}")`,
    (await page.evaluate(() => document.getElementById('kb-input').value)) === 'abc' && (await tips()) === '');
  await combo();
  check(`Alt+Win shows a letter on every tab and a digit on the toolbar (${await tips()})`, (await tips()) === '1AHI');
  await key('A');
  check(`a declared tab tip opens its tab (${await active()}; ${await tips()})`, (await active()) === 'data' && (await tips()) === 'S');
  await key('Escape');
  check(`Escape goes back to the tab tips (${await tips()})`, (await tips()) === '1AHI');
  await key('H');
  check(`H opens Home and shows its commands' tips (${await tips()})`, (await active()) === 'home' && (await tips()) === 'CIOPV');
  const letters = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const out = {};
    for (const t of sr.querySelectorAll('.ribbon-keytip')) {
      const x = parseFloat(t.style.left), y = parseFloat(t.style.top);
      const el = [...sr.querySelectorAll('.ribbon-panel-inner .ribbon-item, .ribbon-panel-inner .ribbon-split-arrow')]
        .find((e) => { const r = e.getBoundingClientRect(); return Math.abs(r.right - x) < 2 && Math.abs(r.bottom - y) < 2; });
      out[el?.dataset.item ?? (el?.dataset.arrow ? `arrow:${el.dataset.arrow}` : '?')] = t.textContent;
    }
    return out;
  });
  check(`letters: declared V for Paste, first free letters, accents folded (${JSON.stringify(letters)})`,
    letters.paste === 'V' && letters.cut === 'C' && letters.copy === 'O' && letters.cislo === 'I');
  await key('C');
  check(`a command's letter runs it and ends the mode (${await last()}; "${await tips()}")`, JSON.parse(await last())?.itemId === 'cut' && (await tips()) === '');

  // Menu level: the split ▾ opens its menu with its own tips.
  await combo();
  await key('H');
  const arrowTip = letters['arrow:paste'];
  await key(arrowTip);
  check(`the ▾ part's letter (${arrowTip}) opens its menu with tips on its choices (${await tips()})`, (await tips()) === 'AP' || (await tips()).length === 2);
  await key('I'); // "Picture": P belongs to "Paste as text", so its first free letter is I
  check(`a choice's letter runs it (${await last()})`, JSON.parse(await last())?.itemId === 'pp' && JSON.parse(await last())?.parentId === 'paste');

  // The toolbar's digit, a lone modifier, a stray letter, a click.
  await combo();
  await key('1');
  check(`a toolbar digit runs its command (${await last()})`, JSON.parse(await last())?.itemId === 'save' && JSON.parse(await last())?.source === 'qat');
  await combo();
  await page.keyboard.press('Shift');
  check(`a lone modifier keeps the tips up (${await tips()})`, (await tips()) === '1AHI');
  await page.focus('#kb-input');
  await combo(); // toggles off (it was on), then on again
  await combo();
  await key('Z');
  check(`a letter with no tip ends the mode and is not typed (${await page.evaluate(() => document.getElementById('kb-input').value)}, "${await tips()}")`,
    (await page.evaluate(() => document.getElementById('kb-input').value)) === 'abc' && (await tips()) === '');
  await combo();
  await page.mouse.click(5, 300);
  await new Promise((r) => setTimeout(r, 80));
  check(`a click ends the mode ("${await tips()}")`, (await tips()) === '');

  // Folded groups: a group's letter opens its flyout with tips on its commands.
  await mountKt(190); // two more groups, so they fold while the tabs still have room
  check(`precondition: at 190px the groups are folded (${await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-panel-inner > .ribbon-group')].map((g) => g.classList.contains('size-popup')).join(','))})`,
    await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-panel-inner > .ribbon-group')].every((g) => g.classList.contains('size-popup'))));
  await combo();
  await key('H');
  const commandTips = await tips();
  await key('C'); // Clipboard, folded
  const flyoutTips = await tips();
  check(`a folded group's letter opens its flyout with its own tips (${commandTips} → ${flyoutTips})`, flyoutTips.includes('V') && flyoutTips.length >= 3);
  await key('V');
  check(`and a letter there runs the command (${await last()})`, JSON.parse(await last())?.itemId === 'paste');

  // Configuration.
  await mountKt(900, 'keytip-shortcut="none"');
  await combo();
  check(`keytip-shortcut="none" turns it off ("${await tips()}")`, (await tips()) === '');
  await mountKt(900, 'keytip-shortcut="Ctrl+Shift+K"');
  await combo();
  const notDefault = await tips();
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('K');
  await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 80));
  check(`a rebound combination replaces Alt+Win ("${notDefault}" → ${await tips()})`, notDefault === '' && (await tips()) === '1AHI');
  await page.evaluate(() => document.getElementById('kb-host').remove());
  // ── b-ribbon: group launcher (TASK-733) ──
  const mountL = (width = 900) => page.evaluate(async (w) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned style="width:${w}px"></b-ribbon>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const r = document.getElementById('kb-ribbon');
    window.__kbL = []; window.__kbClicks = [];
    r.addEventListener('group-launcher', (e) => window.__kbL.push(e.detail));
    r.addEventListener('item-click', (e) => window.__kbClicks.push(e.detail));
    const it = (ids) => ids.map((id) => ({ id, label: id, icon: '●' }));
    r.setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', icon: '📋', items: it(['Paste', 'Cut', 'Copy']) },
      { id: 'font', label: 'Font', icon: '🅰', launcher: true, items: it(['Bold', 'Italic', 'Colour']) },
      { id: 'para', label: 'Paragraph', icon: '¶', launcher: true, launcherLabel: 'Paragraph settings', items: it(['Left', 'Right']) },
      { id: 'exp', label: 'Export', icon: '📤', items: it(['PDF', 'CSV', 'Print']) },
    ] }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  }, width);
  const lState = () => page.evaluate(() => ({ launches: window.__kbL, clicks: window.__kbClicks.length }));
  const wait2 = (ms = 60) => new Promise((r) => setTimeout(r, ms));

  await mountL();
  const marks = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const ls = [...sr.querySelectorAll('.ribbon-panel-inner > .ribbon-group > .ribbon-launcher')];
    const font = sr.querySelector('.ribbon-group[data-group="font"]');
    const lb = font.querySelector('.ribbon-launcher').getBoundingClientRect();
    const gb = font.getBoundingClientRect();
    const tb = font.querySelector('.ribbon-group-label').getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(font.querySelector('.ribbon-group-label'));
    const text = range.getBoundingClientRect();
    return { names: ls.map((l) => l.getAttribute('aria-label')), corner: Math.abs(lb.right - gb.right) < 2 && Math.abs(lb.bottom - gb.bottom) < 2,
      clear: text.right <= lb.left + 0.5, sameLine: lb.top < tb.bottom && lb.bottom > tb.top };
  });
  check(`launchers only on groups that ask, named (${JSON.stringify(marks.names)})`, JSON.stringify(marks.names) === '["More Font options","Paragraph settings"]');
  check(`it sits at the group's bottom-right corner, beside the name and clear of it (${JSON.stringify(marks)})`, marks.corner && marks.clear && marks.sameLine);
  await clickAt('.ribbon-group[data-group="font"] > .ribbon-launcher');
  let ls = await lState();
  check(`a click emits group-launcher and no item-click (${JSON.stringify(ls)})`, JSON.stringify(ls.launches) === '[{"tabId":"home","groupId":"font"}]' && ls.clicks === 0);
  await page.mouse.move(5, 400);
  await wait2(500);
  const paraPos = await page.evaluate(() => {
    const r = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-group[data-group="para"] > .ribbon-launcher').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(paraPos.x, paraPos.y);
  await wait2(700);
  const tipText = await page.evaluate(() => {
    const tip = document.getElementById('kb-ribbon').shadowRoot.querySelector('b-tooltip.ribbon-tooltip').shadowRoot.querySelector('.tip');
    return tip.matches(':popover-open') ? tip.textContent.trim() : 'closed';
  });
  check(`hovering it shows its name as a tooltip (${tipText})`, tipText === 'Paragraph settings');
  await page.mouse.move(5, 400);

  // Keyboard: an arrow-key stop; Enter emits.
  // It sits under the right end of the bottom row, so ArrowDown from the group's last command reaches it.
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner .ribbon-item[data-item="Colour"]').focus());
  await page.keyboard.press('ArrowDown');
  const onLauncher = await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.activeElement?.dataset.launcher ?? document.getElementById('kb-ribbon').shadowRoot.activeElement?.dataset.item);
  check(`ArrowDown from the group's last command reaches its launcher (${onLauncher})`, onLauncher === 'font');
  await page.keyboard.press('Escape'); // its tooltip
  await page.keyboard.press('Enter');
  ls = await lState();
  check(`Enter on it emits group-launcher (${ls.launches.length})`, ls.launches.length === 2 && ls.launches[1].groupId === 'font');

  // Key tips: it gets a letter.
  await page.click('#kb-before');
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await wait2(80);
  await page.keyboard.press('H');
  await wait2(120);
  const ltip = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const l = sr.querySelector('.ribbon-group[data-group="para"] > .ribbon-launcher').getBoundingClientRect();
    const t = [...sr.querySelectorAll('.ribbon-keytip')].find((k) => Math.abs(parseFloat(k.style.left) - l.right) < 2 && Math.abs(parseFloat(k.style.top) - l.bottom) < 2);
    return t?.textContent ?? '';
  });
  if (ltip) await page.keyboard.press(ltip);
  await wait2(80);
  ls = await lState();
  check(`the launcher has a key tip (${ltip}) that runs it`, !!ltip && ls.launches.at(-1)?.groupId === 'para');

  // Folded: the launcher moves into the flyout's header.
  await mountL(230);
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-chunk[data-chunk="font"]').click());
  await wait2();
  const head = await page.evaluate(() => {
    const f = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-group[data-group="font"] .ribbon-flyout');
    return f.matches(':popover-open') ? (f.querySelector('.ribbon-flyout-header')?.textContent.trim() ?? 'no header') + ' / ' + (f.querySelector('.ribbon-flyout-header .ribbon-launcher')?.getAttribute('aria-label') ?? '') : 'closed';
  });
  check(`a folded group's flyout has a header with its launcher (${head})`, head === 'Font / More Font options');
  await clickAt('.ribbon-group[data-group="font"] .ribbon-flyout .ribbon-launcher');
  ls = await lState();
  const flyOpen = await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-group[data-group="font"] .ribbon-flyout').matches(':popover-open'));
  check(`clicking it emits and closes the flyout (${JSON.stringify(ls.launches)}, ${flyOpen})`, ls.launches.at(-1)?.groupId === 'font' && !flyOpen);

  // Mobile list: listed under the group, fires once even after hover previews re-rendered the panel.
  await mountL();
  const tabPos2 = await page.evaluate(() => { const r = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-tab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  for (let i = 0; i < 3; i++) { await page.mouse.move(tabPos2.x, tabPos2.y); await wait2(260); await page.mouse.move(5, 400); await wait2(260); }
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.mobile-launcher[data-launcher="font"]').click());
  ls = await lState();
  check(`the mobile list's launcher fires once, after hover previews, with no item-click (${ls.launches.length}, ${ls.clicks})`, ls.launches.length === 1 && ls.clicks === 0);
  await page.evaluate(() => document.getElementById('kb-host').remove());
  // ── b-ribbon: galleries (TASK-740) ──
  const mountG = (width = 1000, attrs = '', galleryStyle = undefined) => page.evaluate(async ({ w, extra, gs }) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<button id="kb-before">before</button><b-ribbon id="kb-ribbon" expanded pinned ${extra} style="width:${w}px"></b-ribbon>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const r = document.getElementById('kb-ribbon');
    window.__kbClicks = [];
    r.addEventListener('item-click', (e) => window.__kbClicks.push(e.detail));
    const names = ['Normal', 'No spacing', 'Heading 1', 'Heading 2', 'Title', 'Subtitle', 'Quote', 'List'];
    const it = (ids) => ids.map((id) => ({ id, label: id, icon: '●' }));
    r.setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', icon: '📋', items: it(['Paste', 'Cut', 'Copy']) },
      { id: 'st', label: 'Styles', icon: '🅂', items: [{ id: 'styles', label: 'Styles', gallery: { selected: 's0', visible: 4, columns: 4, style: gs,
        items: names.map((n, i) => ({ id: `s${i}`, label: n, preview: i === 7 ? '<b>x</b>' : n.slice(0, 2) })) } }] },
      { id: 'exp', label: 'Export', icon: '📤', items: it(['PDF', 'CSV', 'Print']) },
    ] }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  }, { w: width, extra: attrs, gs: galleryStyle });
  const gState = () => page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const g = sr.querySelector('.ribbon-panel-inner .ribbon-gallery');
    const grid = sr.querySelector('.ribbon-gallery-grid');
    const a = sr.activeElement;
    return {
      row: g ? [...g.querySelectorAll('.ribbon-gallery-row > .ribbon-gallery-tile')].map((t) => t.dataset.choice + (t.getAttribute('aria-checked') === 'true' ? '*' : '')) : null,
      grid: grid?.matches(':popover-open') ?? false,
      focus: a ? (a.dataset.choice ? `${a.closest('.ribbon-gallery-grid') ? 'grid:' : ''}${a.dataset.choice}` : a.dataset.galleryStep ? `step:${a.dataset.galleryStep}` : a.hasAttribute('data-gallery-expand') ? 'expand' : a.tagName) : 'outside',
      clicks: window.__kbClicks,
    };
  });
  const pauseG = (ms = 60) => new Promise((r) => setTimeout(r, ms));

  await mountG();
  let gs = await gState();
  check(`a framed gallery shows its first tiles, the current one checked (${gs.row})`, JSON.stringify(gs.row) === '["s0*","s1","s2","s3"]');
  const roles = await page.evaluate(() => {
    const g = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner .ribbon-gallery');
    return `${g.querySelector('.ribbon-gallery-row').getAttribute('role')}/${g.querySelector('.ribbon-gallery-tile').getAttribute('role')}/${g.querySelector('.ribbon-gallery-tile').getAttribute('aria-label')}`;
  });
  check(`its tiles are radios in a named radiogroup (${roles})`, roles === 'radiogroup/radio/Normal');
  await clickAt('.ribbon-panel-inner .ribbon-gallery-row > [data-choice="s2"]');
  gs = await gState();
  check(`picking a tile makes it current and reports it with its gallery (${gs.row}; ${JSON.stringify(gs.clicks.at(-1))})`,
    JSON.stringify(gs.row) === '["s0","s1","s2*","s3"]' && gs.clicks.at(-1)?.itemId === 's2' && gs.clicks.at(-1)?.parentId === 'styles');
  const stepState = () => page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-panel-inner [data-gallery-step]')].map((b) => b.getAttribute('aria-disabled') === 'true' ? 'off' : 'on').join(','));
  check(`at the start ▲ is off, ▼ on (${await stepState()})`, (await stepState()) === 'off,on');
  await clickAt('.ribbon-panel-inner [data-gallery-step="1"]');
  gs = await gState();
  check(`▼ shows the next tiles (${gs.row}; ${await stepState()})`, JSON.stringify(gs.row) === '["s4","s5","s6","s7"]' && (await stepState()) === 'on,off');
  check('a preview is text, never markup', await page.evaluate(() => !document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-gallery-preview b')));
  await clickAt('.ribbon-panel-inner [data-gallery-step="-1"]');

  // The grid: Enter on ▾ opens it on the current tile; arrows by one and by a row; Enter picks; focus comes back.
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner [data-gallery-expand]').focus());
  await page.keyboard.press('Enter');
  await pauseG();
  gs = await gState();
  check(`Enter on ▾ opens the full grid on the current choice (${gs.grid}, ${gs.focus})`, gs.grid && gs.focus === 'grid:s2');
  await page.keyboard.press('ArrowDown');
  check(`ArrowDown moves a row down (${(await gState()).focus})`, (await gState()).focus === 'grid:s6');
  await page.keyboard.press('ArrowRight');
  check(`ArrowRight moves one along (${(await gState()).focus})`, (await gState()).focus === 'grid:s7');
  await page.keyboard.press('Enter');
  await pauseG(100);
  gs = await gState();
  check(`Enter picks it, closes the grid, focus back on the gallery (${gs.grid}, ${gs.focus}, ${JSON.stringify(gs.clicks.at(-1))})`,
    !gs.grid && gs.clicks.at(-1)?.itemId === 's7' && (gs.focus === 'expand' || gs.focus === 's7'));
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner [data-gallery-expand]').focus());
  await page.keyboard.press('Enter');
  await pauseG();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 20 && ((await gState()).grid || (await gState()).focus !== 'expand'); i++) await pauseG(25);
  gs = await gState();
  check(`Escape closes the grid, focus back on ▾ (${gs.grid}, ${gs.focus})`, !gs.grid && gs.focus === 'expand');

  // App control and the three looks.
  const clicksSoFar = (await gState()).clicks.length;
  await page.evaluate(() => document.getElementById('kb-ribbon').setGallerySelection('styles', 's1'));
  await pauseG();
  gs = await gState();
  check(`setGallerySelection moves the choice without an event (${gs.row}, ${gs.clicks.length - clicksSoFar})`, gs.row.includes('s1*') && gs.clicks.length === clicksSoFar);
  check('getGallerySelection reads it', (await page.evaluate(() => document.getElementById('kb-ribbon').getGallerySelection('styles'))) === 's1');
  await mountG(1000, 'gallery-style="open"');
  const open = await page.evaluate(() => {
    const g = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner .ribbon-gallery');
    return `${g.classList.contains('style-open')}/${g.querySelectorAll('.ribbon-gallery-line > [data-gallery-step]').length}/${g.querySelector('.ribbon-gallery-more')?.textContent.trim()}`;
  });
  check(`gallery-style="open": arrows around the row and "More" under it (${open})`, open === 'true/2/More ▾');
  await mountG(1000, 'gallery-style="open"', 'dropdown');
  const dd = await page.evaluate(() => {
    const g = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner .ribbon-gallery');
    return `${g.classList.contains('style-dropdown')}/${g.querySelectorAll('.ribbon-gallery-row .ribbon-gallery-tile').length}/${g.querySelector('.ribbon-gallery-current .ribbon-gallery-name')?.textContent.trim()}`;
  });
  check(`a gallery can override the style; dropdown shows only the current choice (${dd})`, dd === 'true/0/Normal ▾');

  // Key tips: the gallery's letters, a level for its grid.
  await mountG();
  await page.click('#kb-before');
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await pauseG(80);
  await page.keyboard.press('H');
  await pauseG(120);
  const expandTip = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    const b = sr.querySelector('.ribbon-panel-inner [data-gallery-expand]').getBoundingClientRect();
    return [...sr.querySelectorAll('.ribbon-keytip')].find((k) => Math.abs(parseFloat(k.style.left) - b.right) < 2 && Math.abs(parseFloat(k.style.top) - b.bottom) < 2)?.textContent ?? '';
  });
  if (expandTip) await page.keyboard.press(expandTip);
  await pauseG(120);
  const gridTips = await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-keytip')].length);
  check(`▾ has a key tip (${expandTip}) that opens the grid with a letter per tile (${gridTips})`, !!expandTip && (await gState()).grid && gridTips === 8);
  await page.keyboard.press('T'); // Title
  await pauseG(100);
  check(`a tile's letter in the grid picks it (${JSON.stringify((await gState()).clicks.at(-1))})`, (await gState()).clicks.at(-1)?.itemId === 's4');

  // Mobile and folded.
  const mob = await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.mobile-gallery')].map((m) => m.dataset.choice + (m.getAttribute('aria-checked') === 'true' ? '*' : '')).join(','));
  check(`the mobile list offers the choices as radios (${mob})`, mob === 's0,s1,s2,s3,s4*,s5,s6,s7');
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.mobile-gallery[data-choice="s6"]').click());
  check(`and a choice there is picked (${JSON.stringify((await gState()).clicks.at(-1))})`, (await gState()).clicks.at(-1)?.itemId === 's6');
  await mountG(200);
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-chunk[data-chunk="st"]')?.click());
  await pauseG();
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-flyout [data-gallery-expand]')?.click());
  await pauseG();
  const both = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    return `${!!sr.querySelector('.ribbon-flyout:popover-open')}/${!!sr.querySelector('.ribbon-gallery-grid:popover-open')}`;
  });
  check(`in a folded group the grid opens over the flyout without closing it (${both})`, both === 'true/true');
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-gallery-grid:popover-open [data-choice="s3"]').click());
  await pauseG();
  const closed = await page.evaluate(() => {
    const sr = document.getElementById('kb-ribbon').shadowRoot;
    return `${!!sr.querySelector('.ribbon-flyout:popover-open')}/${!!sr.querySelector('.ribbon-gallery-grid:popover-open')}`;
  });
  check(`and a pick closes both (${closed}, ${(await gState()).clicks.at(-1)?.itemId})`, closed === 'false/false' && (await gState()).clicks.at(-1)?.itemId === 's3');
  await page.evaluate(() => document.getElementById('kb-host').remove());
  // ── b-ribbon: inputs (TASK-741) ──
  {
  const mountF = (width = 1100, attrs = '', caption = undefined) => page.evaluate(async ({ w, extra, cap }) => {
    document.getElementById('kb-host')?.remove();
    const host = document.createElement('div');
    host.id = 'kb-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<button id="kb-before">before</button><b-ribbon id="kb-ribbon" ${extra} style="width:${w}px"></b-ribbon><button id="kb-after">after</button>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    const r = document.getElementById('kb-ribbon');
    window.__kbChanges = [];
    window.__kbLeaked = 0;
    r.addEventListener('item-change', (e) => window.__kbChanges.push(e.detail));
    host.addEventListener('change', () => { window.__kbLeaked++; });
    const opts = (vs) => vs.map((v) => ({ value: v, label: v }));
    r.setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', icon: '📋', items: [{ id: 'paste', label: 'Paste', icon: '●' }, { id: 'cut', label: 'Cut', icon: '●' }, { id: 'copy', label: 'Copy', icon: '●' }] },
      { id: 'font', label: 'Font', icon: '🅰', items: [
        { id: 'fname', label: 'Font', keytip: 'F', description: 'Pick a font.', field: { type: 'select', freeText: true, width: 12, value: 'Calibri', options: opts(['Arial', 'Calibri', 'Georgia']), caption: cap } },
        { id: 'fsize', label: 'Font size', field: { type: 'select', freeText: true, width: 3, value: '11', options: opts(['10', '11', '12']) } },
        { id: 'bold', label: 'Bold', icon: '●' }] },
      { id: 'size', label: 'Size', icon: '⇲', items: [
        { id: 'height', label: 'Height', field: { type: 'number', value: '2.5', min: 0, step: 0.1, width: 4 } },
        { id: 'width', label: 'Width', field: { type: 'number', value: '4.0', min: 0, step: 0.1, width: 4 } },
        { id: 'line', label: 'Line', field: { type: 'select', value: 'solid', options: opts(['solid', 'dashed', 'dotted']) } }] },
    ] }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  }, { w: width, extra: attrs, cap: caption });
  const fState = () => page.evaluate(() => {
    const r = document.getElementById('kb-ribbon');
    const sr = r.shadowRoot;
    const a = sr.activeElement;
    const vals = {};
    sr.querySelectorAll('.ribbon-panel-inner [data-field-control]').forEach((c) => { vals[c.dataset.item] = c.value; });
    return {
      focus: a ? (a.dataset.item ?? a.id ?? a.tagName) : (document.activeElement?.id || 'outside'),
      vals, changes: window.__kbChanges, leaked: window.__kbLeaked,
    };
  });
  const focusField = (id) => page.evaluate((x) => {
    const c = document.getElementById('kb-ribbon').shadowRoot.querySelector(`.ribbon-panel-inner [data-item="${x}"]`);
    c.shadowRoot.querySelector('input, select').focus();
  }, id);
  const selectAll = async () => { await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); };
  const pauseF = (ms = 60) => new Promise((r) => setTimeout(r, ms));

  await mountF(1100, 'expanded pinned');
  const named = await page.evaluate(() => [...document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-panel-inner [data-field-control]')]
    .map((c) => `${c.tagName.toLowerCase()}:${c.shadowRoot.querySelector('input, select').getAttribute('aria-label')}`).join(','));
  check(`inputs render as b-select / b-input boxes named by their label (${named})`,
    named === 'b-select:Font,b-select:Font size,b-input:Height,b-input:Width,b-select:Line');
  check('the default look has no captions', await page.evaluate(() => !document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner .ribbon-field-caption')));
  await clickAt('.ribbon-panel-inner [data-item="paste"]');
  await page.keyboard.press('ArrowRight');
  let fs = await fState();
  check(`an arrow from a command moves into an input (${fs.focus})`, fs.focus === 'fname');
  await focusField('height');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
  fs = await fState();
  check(`inside a number box the arrows step it and Left / Home stay in it (${fs.vals.height}, ${fs.focus})`, fs.vals.height === '2.6' && fs.focus === 'height');
  check(`nothing is reported while editing (${fs.changes.length})`, fs.changes.length === 0);
  await page.keyboard.press('Enter');
  fs = await fState();
  check(`Enter reports the value (${JSON.stringify(fs.changes.at(-1))})`, fs.changes.length === 1 && fs.changes[0].itemId === 'height' && fs.changes[0].value === '2.6' && fs.changes[0].groupId === 'size');
  await page.keyboard.press('Enter');
  check('the same value is not reported twice', (await fState()).changes.length === 1);
  await focusField('width');
  await selectAll();
  await page.keyboard.type('9');
  await page.keyboard.press('Escape');
  fs = await fState();
  check(`Escape puts the reported value back and returns to the tab (${fs.vals.width}, ${fs.focus}, ${fs.changes.length})`,
    fs.vals.width === '4.0' && fs.focus === 'ribbon-tab-home' && fs.changes.length === 1);
  await focusField('width');
  await selectAll();
  await page.keyboard.type('7');
  await page.keyboard.press('Tab');
  fs = await fState();
  check(`Tab leaves the ribbon and reports what was typed (${fs.focus}, ${JSON.stringify(fs.changes.at(-1))})`,
    fs.focus === 'kb-after' && fs.changes.at(-1)?.itemId === 'width' && fs.changes.at(-1)?.value === '7');
  await focusField('fsize');
  await selectAll();
  await page.keyboard.type('13');
  await page.keyboard.press('Enter');
  await pauseF();
  fs = await fState();
  check(`a dropdown that takes free text reports a value not in its list (${JSON.stringify(fs.changes.at(-1))})`,
    fs.changes.at(-1)?.itemId === 'fsize' && fs.changes.at(-1)?.value === '13');
  await focusField('line');
  await page.keyboard.press('ArrowDown');
  await pauseF();
  fs = await fState();
  check(`a plain dropdown reports a choice at once (${JSON.stringify(fs.changes.at(-1))}, ${fs.focus})`,
    fs.changes.at(-1)?.itemId === 'line' && fs.changes.at(-1)?.value === 'dashed' && fs.focus === 'line');
  check(`the boxes' own change events stay inside the ribbon (${fs.leaked})`, fs.leaked === 0);
  const api = await page.evaluate(() => {
    const r = document.getElementById('kb-ribbon');
    const before = window.__kbChanges.length;
    r.setFieldValue('height', '5');
    const shown = r.shadowRoot.querySelector('.ribbon-panel-inner [data-item="height"]').value;
    return `${shown}/${r.getFieldValue('height')}/${window.__kbChanges.length - before}/${r.getFieldValue('nope')}`;
  });
  check(`setFieldValue shows a value without an event; getFieldValue reads it (${api})`, api === '5/5/0/null');
  await focusField('width');
  await selectAll();
  await page.keyboard.type('8');
  await page.evaluate(() => document.getElementById('kb-ribbon').update());
  await pauseF();
  fs = await fState();
  check(`a re-render keeps what was typed and the focus (${fs.vals.width}, ${fs.focus})`, fs.vals.width === '8' && fs.focus === 'width');
  await page.click('#kb-before');

  // Key tips: the box takes focus with its text selected.
  await page.keyboard.down('Alt'); await page.keyboard.down('Meta'); await page.keyboard.up('Meta'); await page.keyboard.up('Alt');
  await pauseF(80);
  await page.keyboard.press('H');
  await pauseF(120);
  await page.keyboard.press('F');
  await pauseF(80);
  const kSel = await page.evaluate(() => {
    const c = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner [data-item="fname"]');
    const i = c.shadowRoot.querySelector('input');
    return `${c.shadowRoot.activeElement === i}/${i.selectionStart}-${i.selectionEnd}/${i.value.length}`;
  });
  check(`an input's key tip focuses it with its text selected (${kSel})`, kSel === 'true/0-7/7');
  await page.keyboard.type('Georgia');
  await page.keyboard.press('Enter');
  await pauseF();
  check(`and typing over it then Enter reports it (${JSON.stringify((await fState()).changes.at(-1))})`, (await fState()).changes.at(-1)?.value === 'Georgia');

  // Hover tooltip: the input's name and description, but not over a box being typed in.
  await page.click('#kb-before');
  await page.evaluate(() => { const r = document.getElementById('kb-ribbon'); r.shadowRoot.querySelector('.ribbon-tooltip').hide(); });
  const hoverAt = async (id) => {
    const c = await page.evaluate((x) => { const b = document.getElementById('kb-ribbon').shadowRoot.querySelector(`.ribbon-panel-inner [data-item="${x}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, id);
    await page.mouse.move(c.x, c.y);
  };
  const tipText = () => page.evaluate(() => { const t = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-tooltip'); return t.shown ? t.shadowRoot.textContent.replace(/\s+/g, ' ').trim() : ''; });
  await hoverAt('fname');
  await pauseF(700);
  const tip = await tipText();
  check(`hovering an input shows its tooltip (${tip})`, tip.includes('Font') && tip.includes('Pick a font.'));
  await page.mouse.move(0, 400);
  await pauseF(400);
  await focusField('height');
  await hoverAt('height');
  await pauseF(700);
  check(`but not over the box being typed in (${await tipText()})`, (await tipText()) === '');

  // The three looks.
  await mountF(1100, 'expanded pinned field-caption="beside"');
  const look = (id) => page.evaluate((x) => {
    const c = document.getElementById('kb-ribbon').shadowRoot.querySelector(`.ribbon-panel-inner [data-item="${x}"]`);
    const cap = c.parentElement.querySelector('.ribbon-field-caption');
    if (!cap) return 'none';
    const a = cap.getBoundingClientRect(); const b = c.getBoundingClientRect();
    return `${cap.textContent}:${a.right <= b.left + 1 ? 'beside' : a.bottom <= b.top + 1 ? 'above' : 'overlap'}:${cap.getAttribute('aria-hidden')}`;
  }, id);
  check(`field-caption="beside" puts the caption left of the box (${await look('height')})`, (await look('height')) === 'Height:beside:true');
  await mountF(1100, 'expanded pinned field-caption="above"', 'none');
  check(`field-caption="above" puts it over the box (${await look('height')})`, (await look('height')) === 'Height:above:true');
  check(`and an input can override the look (${await look('fname')})`, (await look('fname')) === 'none');
  await mountF(1100, 'expanded pinned field-caption="beside" preferred-group-size="small"');
  const smallCap = await page.evaluate(() => {
    const g = document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-panel-inner .ribbon-group[data-group="size"]');
    return `${g.classList.contains('size-small')}/${getComputedStyle(g.querySelector('.ribbon-field-caption')).display}`;
  });
  check(`a small group hides a beside caption (${smallCap})`, smallCap === 'true/none');

  // Folded and mobile.
  await mountF(200, 'expanded pinned');
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-chunk[data-chunk="size"]')?.click());
  await pauseF();
  const inFly = await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelectorAll('.ribbon-flyout:popover-open [data-field-control]').length);
  check(`a folded group's flyout holds its inputs (${inFly})`, inFly === 3);
  await page.evaluate(() => document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-flyout:popover-open [data-item="height"]').shadowRoot.querySelector('input').focus());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await pauseF();
  const flyDone = await page.evaluate(() => !!document.getElementById('kb-ribbon').shadowRoot.querySelector('.ribbon-flyout:popover-open'));
  fs = await fState();
  check(`an input there edits with the arrows and Enter reports and closes the flyout (${JSON.stringify(fs.changes.at(-1))}, ${flyDone})`,
    fs.changes.at(-1)?.itemId === 'height' && fs.changes.at(-1)?.value === '2.4' && !flyDone);
  const mobile = await page.evaluate(async () => {
    const r = document.getElementById('kb-ribbon');
    const m = r.shadowRoot.querySelector('.mobile-field-control[data-item="width"]');
    const count = r.shadowRoot.querySelectorAll('.mobile-field-control').length;
    m.dispatchEvent(new CustomEvent('change', { detail: { value: '6' }, bubbles: true, composed: true }));
    m.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    await new Promise((res) => setTimeout(res, 30));
    return `${count}/${JSON.stringify(window.__kbChanges.at(-1))}/${r.getFieldValue('width')}`;
  });
  check(`the mobile list holds the inputs, and a value there is reported (${mobile})`, mobile === '5/{"tabId":"home","groupId":"size","itemId":"width","value":"6"}/6');

  // Unpinned: the ribbon stays open while a box is typed in.
  await mountF(1100, 'expanded');
  await focusField('width');
  await page.mouse.move(600, 500);
  await pauseF(500);
  const stillOpen = await page.evaluate(() => document.getElementById('kb-ribbon').hasAttribute('expanded'));
  check(`an unpinned ribbon does not close under a box being typed in (${stillOpen})`, stillOpen);
  await selectAll();
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await pauseF();
  const shut = await page.evaluate(() => document.getElementById('kb-ribbon').hasAttribute('expanded'));
  check(`and closes once Enter reports the value, as after a command (${shut})`, !shut && (await fState()).changes.at(-1)?.value === '3');
  await page.evaluate(() => document.getElementById('kb-host').remove());
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nkeyboard-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
