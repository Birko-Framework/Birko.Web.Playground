// What a screen reader gets from b-ribbon (FEATURE-019 sign-off): the role, name, group, description, shortcut and
// state Chromium computes for every part, read from the accessibility tree, the same tree NVDA and Narrator read.
//
//   node build.js && node ribbon-a11y-check.mjs        (exit 1 on any FAIL; prints the tree it read)
//
// Attribute checks cannot see a name that never reaches the tree (TASK-494, a11y-name-check.mjs), and the ribbon is
// three shadow roots deep in places (b-ribbon > b-select > input), which only the tree flattens. Chromium only: Firefox
// speaks WebDriver BiDi, which exposes no accessibility tree to puppeteer.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${base}?kb=1`, { waitUntil: 'networkidle0' });
  const cdp = await page.createCDPSession();

  const mount = (width) => page.evaluate(async (w) => {
    document.getElementById('ax-host')?.remove();
    const host = document.createElement('div');
    host.id = 'ax-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = `<b-ribbon id="ax" expanded pinned qat-key="ax-check" style="width:${w}px"></b-ribbon>`;
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    try { localStorage.removeItem('birko-ribbon-qat:ax-check'); } catch { /* private mode */ }
    const r = document.getElementById('ax');
    const opts = (vs) => vs.map((v) => ({ value: v, label: v }));
    r.setTabs([
      { id: 'home', label: 'Home', groups: [
        { id: 'clip', label: 'Clipboard', icon: '📋', items: [
          { id: 'paste', label: 'Paste', icon: '📋', description: 'Add content from the clipboard.', shortcut: 'Ctrl+V', split: true,
            menu: [{ id: 'paste-text', label: 'Paste as text', shortcut: 'Ctrl+Shift+V' }, { separator: true }, { id: 'paste-pic', label: 'Paste as picture', disabled: true }] },
          { id: 'cut', label: 'Cut', icon: '✂️', shortcut: 'Ctrl+X' }] },
        { id: 'font', label: 'Font', icon: '🅰', launcher: true, items: [
          { id: 'fname', label: 'Font', field: { type: 'select', freeText: true, width: 12, value: 'Calibri', options: opts(['Arial', 'Calibri']) } },
          { id: 'height', label: 'Height', field: { type: 'number', value: '2.5', step: 0.1 } },
          { id: 'line', label: 'Line', field: { type: 'select', value: 'solid', options: opts(['solid', 'dashed']) } },
          { id: 'bold', label: 'Bold', icon: '𝐁', toggle: true, pressed: true, shortcut: 'Ctrl+B' },
          { id: 'italic', label: 'Italic', icon: '𝑰', toggle: true }] },
        { id: 'lay', label: 'Layout', icon: '▦', items: [
          { id: 'cols', label: 'Columns', icon: '▥', toggleGroup: 'o', pressed: true }, { id: 'rows', label: 'Rows', icon: '▤', toggleGroup: 'o' }] },
        { id: 'st', label: 'Styles', icon: '🅂', items: [{ id: 'styles', label: 'Styles', gallery: { selected: 'h1', visible: 3,
          items: [{ id: 'normal', label: 'Normal' }, { id: 'h1', label: 'Heading 1' }, { id: 'h2', label: 'Heading 2' }, { id: 'title', label: 'Title' }] } }] },
        { id: 'exp', label: 'Export', icon: '📤', items: [{ id: 'csv', label: 'CSV', icon: '📊', menu: [{ id: 'csv-comma', label: 'Comma separated' }] }] },
      ] },
      { id: 'insert', label: 'Insert', groups: [{ id: 'media', label: 'Media', items: [{ id: 'image', label: 'Image', icon: '🖼' }] }] },
      { id: 'table-design', label: 'Table Design', contextualSet: 'table', groups: [{ id: 'ts', label: 'Table style', items: [{ id: 'hdr', label: 'Header row', icon: '▦' }] }] },
    ]);
    r.setContextualSets([{ id: 'table', label: 'Table', color: 'success' }]);
    r.showContextual('table');
    r.setQuickAccess([{ id: 'save', label: 'Save', icon: '💾', shortcut: 'Ctrl+S' }]);
    for (let i = 0; i < 30; i++) await new Promise((res) => setTimeout(res, 25));
  }, width);

  // The subtree under the ribbon's toolbar, as { role, name, description, value, props, parent chain }.
  const tree = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const v = (x) => (x && 'value' in x ? String(x.value) : '');
    const out = nodes.filter((n) => !n.ignored).map((n) => ({
      id: n.nodeId,
      role: v(n.role),
      name: v(n.name),
      description: v(n.description),
      value: v(n.value),
      props: Object.fromEntries((n.properties ?? []).map((p) => [p.name.toLowerCase(), v(p.value)])),
      parents: (() => { const ps = []; let p = byId.get(n.parentId); while (p) { if (!p.ignored) ps.push({ role: v(p.role), name: v(p.name) }); p = byId.get(p.parentId); } return ps; })(),
    }));
    const inRibbon = out.filter((n) => n.parents.some((p) => p.role === 'toolbar' && p.name === 'Module ribbon') || (n.role === 'toolbar' && n.name === 'Module ribbon'));
    return inRibbon;
  };
  const say = (n) => [n.name || '(no name)', n.role, n.value && `value ${n.value}`, n.description && `“${n.description}”`,
    ...Object.entries(n.props).filter(([k]) => ['pressed', 'checked', 'expanded', 'haspopup', 'keyshortcuts', 'disabled', 'selected', 'readonly'].includes(k)).map(([k, x]) => `${k}=${x}`),
    n.parents.find((p) => p.role === 'group' || p.role === 'radiogroup') && `in ${n.parents.find((p) => p.role === 'group' || p.role === 'radiogroup').role} “${n.parents.find((p) => p.role === 'group' || p.role === 'radiogroup').name}”`,
  ].filter(Boolean).join(', ');
  const INTERACTIVE = new Set(['button', 'tab', 'radio', 'combobox', 'spinbutton', 'textbox', 'menuitem', 'menuitemcheckbox', 'checkbox', 'switch', 'link']);
  const find = (t, role, name) => t.find((n) => n.role === role && n.name === name);
  const groupOf = (n) => n?.parents.find((p) => p.role === 'group' || p.role === 'radiogroup');

  await mount(1300);
  let t = await tree();
  console.log('\n── What a screen reader gets, wide ribbon ──');
  for (const n of t.filter((x) => INTERACTIVE.has(x.role) || ['toolbar', 'tablist', 'tabpanel', 'group', 'radiogroup'].includes(x.role))) console.log(`  ${say(n)}`);
  console.log('');

  check('the ribbon is a toolbar named “Module ribbon”', !!find(t, 'toolbar', 'Module ribbon'));
  const tabs = t.filter((n) => n.role === 'tab');
  check(`tabs are tabs in a tablist, the active one selected (${tabs.map((x) => `${x.name}${x.props.selected === 'true' ? '*' : ''}`).join(', ')})`,
    tabs.length === 3 && tabs.every((x) => x.parents.some((p) => p.role === 'tablist')) && tabs.filter((x) => x.props.selected === 'true').map((x) => x.name).join() === 'Home');
  const ctx = find(t, 'tab', 'Table Design');
  check(`a contextual tab names its set (${ctx?.description})`, ctx?.description === 'Table');
  check(`the panel is a tabpanel named by its tab (${t.find((n) => n.role === 'tabpanel')?.name})`, t.find((n) => n.role === 'tabpanel')?.name === 'Home');
  const groups = t.filter((n) => n.role === 'group' && n.parents.some((p) => p.role === 'tabpanel')).map((n) => n.name);
  check(`each ribbon group is a named group (${groups.join(', ')})`, ['Clipboard', 'Font', 'Layout', 'Styles', 'Export'].every((g) => groups.includes(g)));

  const paste = find(t, 'button', 'Paste');
  check(`a command: name, group, description and shortcut (${paste && say(paste)})`,
    groupOf(paste)?.name === 'Clipboard' && paste.description === 'Add content from the clipboard.' && paste.props.keyshortcuts === 'Ctrl+V');
  const more = find(t, 'button', 'More options: Paste');
  check(`a split command's ▾ is its own button with a menu popup (${more && say(more)})`, more?.props.haspopup === 'menu' && more?.props.expanded === 'false');
  const csv = find(t, 'button', 'CSV');
  check(`a menu command says it opens a menu (${csv && say(csv)})`, csv?.props.haspopup === 'menu');
  const bold = find(t, 'button', 'Bold');
  const italic = find(t, 'button', 'Italic');
  check(`a toggle says whether it is on (${bold && say(bold)}; ${italic && say(italic)})`, bold?.props.pressed === 'true' && italic?.props.pressed === 'false');
  const cols = find(t, 'radio', 'Columns');
  const rows = find(t, 'radio', 'Rows');
  check(`a one-of set is radios in a radiogroup named after its group (${cols && say(cols)})`,
    cols?.props.checked === 'true' && rows?.props.checked === 'false' && groupOf(cols)?.role === 'radiogroup' && groupOf(cols)?.name === 'Layout');
  const launcher = t.find((n) => n.role === 'button' && groupOf(n)?.name === 'Font' && /font/i.test(n.name) && n.name !== 'Font');
  check(`the launcher is a named button in its group (${launcher && say(launcher)})`, !!launcher);
  const fname = find(t, 'combobox', 'Font');
  check(`a free-text dropdown is a combobox named by its label, with its value (${fname && say(fname)})`, !!fname && groupOf(fname)?.name === 'Font' && /Calibri/.test(fname.value));
  const height = find(t, 'spinbutton', 'Height');
  check(`a number box is a spinbutton with its value (${height && say(height)})`, height?.value === '2.5');
  const line = find(t, 'combobox', 'Line');
  check(`a plain dropdown is a combobox with its value (${line && say(line)})`, !!line && /solid/.test(line.value));
  const tiles = t.filter((n) => n.role === 'radio' && groupOf(n)?.name === 'Styles' && n.parents.some((p) => p.role === 'radiogroup'));
  check(`gallery tiles are radios in a radiogroup named after the gallery, the current one checked (${tiles.map((x) => `${x.name}${x.props.checked === 'true' ? '*' : ''}`).join(', ')})`,
    tiles.length === 3 && tiles.filter((x) => x.props.checked === 'true').map((x) => x.name).join() === 'Heading 1');
  const expand = find(t, 'button', 'Show all: Styles');
  check(`the gallery's ▾ says it opens a popup (${expand && say(expand)})`, !!expand?.props.haspopup && expand?.props.expanded === 'false');
  const qat = t.find((n) => n.role === 'group' && /quick access/i.test(n.name));
  const save = find(t, 'button', 'Save');
  check(`the Quick Access Toolbar is a named group of named buttons (${qat?.name}; ${save && say(save)})`, !!qat && !!save && save.parents.some((p) => p === qat || (p.role === 'group' && p.name === qat.name)));
  const unnamed = t.filter((n) => INTERACTIVE.has(n.role) && !n.name.trim());
  check(`no control is announced without a name (${unnamed.map((n) => n.role).join(', ') || 'none'})`, unnamed.length === 0);
  const emoji = t.filter((n) => (INTERACTIVE.has(n.role) || n.role === 'group') && /\p{Extended_Pictographic}/u.test(n.name));
  check(`decorative icons stay out of the names (${emoji.map((n) => n.name).join(', ') || 'none'})`, emoji.length === 0);

  // Open menus: the choices a screen reader reaches.
  await page.evaluate(() => document.getElementById('ax').shadowRoot.querySelector('.ribbon-panel-inner [data-arrow="paste"]').click());
  await new Promise((r) => setTimeout(r, 150));
  t = await tree();
  const menu = t.find((n) => n.role === 'menu');
  const items = t.filter((n) => n.role === 'menuitem');
  console.log(`  open menu: ${menu && say(menu)}; ${items.map(say).join(' | ')}`);
  check(`an open menu is a menu of menuitems named by their label alone, the shortcut said once, a disabled one disabled (${items.map((x) => `${x.name}${x.props.disabled === 'true' ? ' (disabled)' : ''}${x.props.keyshortcuts ? ` [${x.props.keyshortcuts}]` : ''}`).join(', ')})`,
    !!menu && items.length === 2 && items[0].name === 'Paste as text' && items[0].props.keyshortcuts === 'Ctrl+Shift+V' && items[1].props.disabled === 'true' && find(t, 'button', 'More options: Paste')?.props.expanded === 'true');
  await page.keyboard.press('Escape');

  // Folded: each group is one button.
  await mount(300);
  t = await tree();
  const chunks = t.filter((n) => n.role === 'button' && n.parents.some((p) => p.role === 'tabpanel') && n.props.haspopup);
  console.log(`  folded: ${chunks.map(say).join(' | ')}`);
  check(`a folded group is a button named after its group that says it opens a popup (${chunks.map((c) => c.name).join(', ')})`,
    ['Clipboard', 'Font', 'Layout', 'Styles', 'Export'].every((g) => chunks.some((c) => c.name.startsWith(g))) && chunks.every((c) => c.props.expanded === 'false'));
  const unnamedFolded = t.filter((n) => INTERACTIVE.has(n.role) && !n.name.trim());
  check(`folded, still no control without a name (${unnamedFolded.length})`, unnamedFolded.length === 0);
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nribbon-a11y-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
