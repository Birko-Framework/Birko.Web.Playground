// Birko.Web Playground — component gallery + live design-token editor + theme-CSS export.
// Import the barrel AS A NAMESPACE and reference it so the bundler can't tree-shake away the
// category modules — every `b-*` custom element registers via its module's customElements.define()
// side effect, and touching the namespace forces all those modules to be included.
import * as BirkoWebComponents from 'birko-web-components';
void Object.keys(BirkoWebComponents).length;

// EPIC-002 backport smoke — the Birko.Web backports' regression harness. Gated to verify.mjs (which
// loads /?smoke=1) so the interactive gallery console stays clean; the regression gate is preserved.
if (new URLSearchParams(location.search).has('smoke')) {
  void import('./backport-smoke.js');
}

// ── BMobileAppShell demo (EPIC-016 / TASK-049) ───────────────────────────────
// BMobileAppShell is abstract (needs surfaces + brand/user/t/onSignOut), so the playground
// supplies a tiny concrete subclass — a consumer, not framework code — registered as
// <pg-mobile-shell> and shown phone-framed in the Navigation section.
import { BMobileAppShell, type Surface } from 'birko-web-shell';

class PgMobileShell extends BMobileAppShell {
  protected get brandName(): string { return 'Reps'; }
  protected getUserName(): string { return ''; }
  protected t(key: string): string { return key; }
  protected onSignOut(): void { /* demo: no auth */ }
  protected get surfaces(): readonly Surface[] {
    return [
      { id: 'home', route: '/', icon: '🏠', label: 'Home' },
      { id: 'log', route: '/log', icon: '➕', label: 'Log' },
      { id: 'stats', route: '/stats', icon: '📊', label: 'Stats' },
    ];
  }
}
if (!customElements.get('pg-mobile-shell')) customElements.define('pg-mobile-shell', PgMobileShell);

// ── Component catalogue ──────────────────────────────────────────────────────
// Maintained manifest. Each entry renders one representative instance plus controls
// that flip a common attribute live. Keep in sync with the Birko.Web.Components catalogue;
// `reportMissing()` warns about manifest tags that didn't register.
interface ControlDef {
  label: string;
  attr: string;
  options: string[]; // first value is the default
}
interface ComponentDef {
  tag: string;
  label: string;
  category: 'inputs' | 'layout' | 'data' | 'feedback' | 'nav' | 'command';
  render?: () => string;            // inner markup for one instance
  attrs?: Record<string, string>;   // static attributes applied to the instance
  controls?: ControlDef[];          // live attribute toggles
  setup?: (el: any) => void;        // populate via JS data methods (setData/setItems/…); deferred + guarded
  note?: string;                    // shown when the component needs runtime config to populate
  launch?: { label: string; run: (el: any) => void }; // overlay opener (modal/drawer/dialog show themselves on demand)
}

const SIZE: ControlDef = { label: 'size', attr: 'size', options: ['', 'sm', 'lg'] };
const VARIANT: ControlDef = { label: 'variant', attr: 'variant', options: ['primary', 'secondary', 'danger', 'ghost'] };
const STATUS: ControlDef = { label: 'variant', attr: 'variant', options: ['', 'success', 'warning', 'danger', 'info'] };
const DISABLED: ControlDef = { label: 'disabled', attr: 'disabled', options: ['', 'disabled'] };
const PROGRESS_TYPE: ControlDef = { label: 'type', attr: 'type', options: ['linear', 'circular'] };

// Full catalogue (kept in sync with Birko.Web.Components). reportMissing() warns about any
// tag here that didn't register; a registered component absent from this list is a gap to fill.
const CATALOGUE: ComponentDef[] = [
  // ── inputs ──
  { tag: 'b-button', label: 'Button', category: 'inputs', render: () => 'Click me', controls: [VARIANT, SIZE, DISABLED] },
  { tag: 'b-checkbox', label: 'Checkbox', category: 'inputs', render: () => 'Accept terms', controls: [DISABLED] },
  { tag: 'b-radio', label: 'Radio', category: 'inputs', render: () => 'Option A', attrs: { name: 'demo-radio', value: 'a' }, controls: [DISABLED] },
  { tag: 'b-switch', label: 'Switch', category: 'inputs', render: () => 'Enabled', controls: [DISABLED] },
  { tag: 'b-input', label: 'Input', category: 'inputs', attrs: { label: 'Name', placeholder: 'Type here…' }, controls: [SIZE, DISABLED] },
  { tag: 'b-textarea', label: 'Textarea', category: 'inputs', attrs: { label: 'Notes', placeholder: 'Multi-line…' }, controls: [DISABLED] },
  { tag: 'b-search-input', label: 'Search input', category: 'inputs', attrs: { placeholder: 'Search…' }, controls: [SIZE] },
  { tag: 'b-select', label: 'Select', category: 'inputs', attrs: { label: 'Pick one', placeholder: 'Choose…' }, render: () => '<option value="1">One</option><option value="2">Two</option><option value="3">Three</option>' },
  { tag: 'b-multi-select', label: 'Multi-select', category: 'inputs', attrs: { label: 'Pick many' }, setup: (el) => el.setOptions([{ value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }]) },
  { tag: 'b-color-picker', label: 'Color picker', category: 'inputs', attrs: { value: '#25ba7a', label: 'Brand color' } },
  { tag: 'b-range', label: 'Range', category: 'inputs', attrs: { min: '0', max: '100', value: '60' } },
  { tag: 'b-date-picker', label: 'Date picker', category: 'inputs', attrs: { label: 'Date' } },
  { tag: 'b-datetime-picker', label: 'Datetime picker', category: 'inputs', attrs: { label: 'When' } },
  { tag: 'b-date-range-picker', label: 'Date range', category: 'inputs', attrs: { label: 'Range' } },
  { tag: 'b-time', label: 'Time', category: 'inputs', attrs: { label: 'Time' } },
  { tag: 'b-file-upload', label: 'File upload', category: 'inputs', attrs: { label: 'Upload a file' } },
  { tag: 'b-inline-edit', label: 'Inline edit', category: 'inputs', attrs: { value: 'Click to edit' } },
  { tag: 'b-markdown-editor', label: 'Markdown editor', category: 'inputs', attrs: { value: '# Hello\n\nMarkdown **here**.' } },
  { tag: 'b-tag-input', label: 'Tag input', category: 'inputs', attrs: { label: 'Tags', placeholder: 'add tag…' }, setup: (el) => el.setTags(['design', 'birko', 'web', 'components']) },
  { tag: 'b-segmented', label: 'Segmented', category: 'inputs', attrs: { value: 'day' }, setup: (el) => el.setOptions([{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]) },
  { tag: 'b-option-group', label: 'Option group', category: 'inputs', attrs: { label: 'Choose' }, setup: (el) => el.setOptions([{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }, { value: 'c', label: 'Option C' }]) },
  { tag: 'b-form', label: 'Form', category: 'inputs',
    setup: (el) => el.setSchema({ name: 'demo', children: [
      { name: 'fullName', type: 'text', label: 'Full name', placeholder: 'Ada Lovelace', required: true },
      { name: 'email', type: 'email', label: 'Email', placeholder: 'ada@example.com' },
      { name: 'role', type: 'select', label: 'Role', options: [{ value: 'admin', label: 'Admin' }, { value: 'user', label: 'User' }] },
    ] }) },

  // ── layout ──
  { tag: 'b-button-group', label: 'Button group', category: 'layout', render: () => '<b-button>One</b-button><b-button>Two</b-button><b-button>Three</b-button>' },
  { tag: 'b-card', label: 'Card', category: 'layout', render: () => '<span slot="header">Card title</span><p>Card body content.</p>' },
  { tag: 'b-accordion', label: 'Accordion', category: 'layout',
    render: () => '<div slot="a1">First section body.</div><div slot="a2">Second section body.</div><div slot="a3">Disabled section body.</div>',
    setup: (el) => el.setItems([{ id: 'a1', header: 'Section one', open: true }, { id: 'a2', header: 'Section two' }, { id: 'a3', header: 'Section three (disabled)', disabled: true }]) },
  { tag: 'b-toolbar', label: 'Toolbar', category: 'layout', render: () => '<b-button-group><b-button>A</b-button><b-button>B</b-button></b-button-group>' },
  { tag: 'b-split-panel', label: 'Split panel', category: 'layout', render: () => '<div slot="master" style="padding:.75rem;min-height:140px;background:var(--b-bg-secondary)">Master pane</div><div slot="detail" style="padding:.75rem;min-height:140px">Detail pane</div>' },
  { tag: 'b-tooltip', label: 'Tooltip', category: 'layout', attrs: { text: 'I am a tooltip' }, render: () => 'Hover me' },
  { tag: 'b-tabs', label: 'Tabs', category: 'layout', setup: (el) => el.setTabs([{ id: 't1', label: 'Overview' }, { id: 't2', label: 'Details' }, { id: 't3', label: 'Activity' }], 't1') },
  { tag: 'b-dropdown-menu', label: 'Dropdown menu', category: 'layout',
    render: () => '<b-button slot="trigger">Actions ▾</b-button>',
    setup: (el) => el.setItems([{ id: 'edit', label: 'Edit', icon: '✏️' }, { id: 'dup', label: 'Duplicate', icon: '📋' }, { id: 'sep', label: '', divider: true }, { id: 'del', label: 'Delete', icon: '🗑️', variant: 'danger' }]) },
  { tag: 'b-modal', label: 'Modal', category: 'layout', attrs: { title: 'Example modal' },
    render: () => '<p>Modal body content goes here.</p><b-button slot="footer" variant="primary">OK</b-button>',
    launch: { label: 'Open modal', run: (el) => el.open() } },
  { tag: 'b-drawer', label: 'Drawer', category: 'layout', attrs: { title: 'Example drawer' },
    render: () => '<p>Drawer body content goes here.</p>',
    launch: { label: 'Open drawer', run: (el) => el.open() } },
  { tag: 'b-confirm-dialog', label: 'Confirm dialog', category: 'layout', attrs: { title: 'Delete item?', message: 'This action cannot be undone.', variant: 'danger' },
    launch: { label: 'Open dialog', run: (el) => el.show() } },
  { tag: 'b-chat', label: 'Chat', category: 'layout', setup: (el) => el.setMessages([{ id: '1', role: 'assistant', content: 'Hi! How can I help?' }, { id: '2', role: 'user', content: 'Show me the gallery.' }]) },
  { tag: 'b-tour', label: 'Tour', category: 'layout',
    launch: { label: 'Start tour', run: (el) => el.start([
      { target: '.pg-header .pg-brand', title: 'Welcome', body: 'This is the Birko.Web playground.', placement: 'bottom' },
      { target: '#pg-nav', title: 'Sections', body: 'Switch component categories here.', placement: 'bottom' },
      { target: '#open-tokens', title: 'Design tokens', body: 'Tweak design tokens live.', placement: 'bottom' },
    ], { id: 'pg-demo-tour' }) } },

  // ── data ──
  { tag: 'b-badge', label: 'Badge', category: 'data', render: () => 'New', controls: [STATUS] },
  { tag: 'b-tag', label: 'Tag', category: 'data', render: () => 'tag', controls: [STATUS] },
  { tag: 'b-stat', label: 'Stat', category: 'data', attrs: { label: 'Revenue', value: '$12.4k', delta: '+8%', trend: 'up', sentiment: 'positive' } },
  { tag: 'b-pagination', label: 'Pagination', category: 'data', attrs: { page: '2', 'total-pages': '10', 'total-count': '195', 'page-size': '20' } },
  { tag: 'b-pre', label: 'Pre', category: 'data', render: () => 'preformatted\n  text block' },
  { tag: 'b-code-block', label: 'Code block', category: 'data', attrs: { language: 'js' }, render: () => 'const x = 42;\nconsole.log(x);' },
  { tag: 'b-definition-list', label: 'Definition list', category: 'data', render: () => '<dt>Term</dt><dd>A definition</dd><dt>Another</dt><dd>Its value</dd>' },
  { tag: 'b-json-viewer', label: 'JSON viewer', category: 'data', render: () => '{ "name": "birko", "version": 1, "ok": true }' },
  { tag: 'b-xml-viewer', label: 'XML viewer', category: 'data', setup: (el) => el.setSource('<root><item id="1">hello</item><item id="2">world</item></root>') },
  { tag: 'b-table', label: 'Table', category: 'data', setup: (el) => { el.setColumns([{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'city', label: 'City' }]); el.setData([{ name: 'Ada', role: 'Admin', city: 'London' }, { name: 'Linus', role: 'User', city: 'Helsinki' }, { name: 'Grace', role: 'User', city: 'New York' }]); } },
  { tag: 'b-data-table', label: 'Data table', category: 'data', setup: (el) => {
    // b-data-table is endpoint-driven; a duck-typed in-memory apiClient feeds it static rows.
    const rows = [{ name: 'Ada', role: 'Admin' }, { name: 'Linus', role: 'User' }, { name: 'Grace', role: 'User' }];
    const apiClient = { get: async () => ({ ok: true, status: 200, data: rows, headers: new Headers() }) };
    el.setConfig({ endpoint: '/demo', apiClient, columns: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }] });
    el.load(); // setConfig configures but doesn't fetch; load() pulls the first page
  } },
  { tag: 'b-editable-table', label: 'Editable table', category: 'data', setup: (el) => { el.setConfig({ columns: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }] }); el.setData([{ name: 'Widget', qty: 3 }, { name: 'Gadget', qty: 7 }]); } },
  { tag: 'b-chart', label: 'Chart', category: 'data', attrs: { type: 'bar', height: '220px' },
    controls: [{ label: 'type', attr: 'type', options: ['bar', 'line', 'area', 'pie', 'donut', 'gauge'] }],
    setup: (el) => el.setData({ labels: ['Jan', 'Feb', 'Mar', 'Apr'], series: [{ id: 'sales', label: 'Sales', data: [{ y: 65 }, { y: 40 }, { y: 80 }, { y: 55 }] }] }) },
  { tag: 'b-kanban', label: 'Kanban', category: 'data', setup: (el) => el.setConfig({ columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress' }, { id: 'done', label: 'Done' }], cards: [{ id: '1', columnId: 'todo', title: 'Task A' }, { id: '2', columnId: 'doing', title: 'Task B' }, { id: '3', columnId: 'done', title: 'Task C' }] }) },
  { tag: 'b-object-tree', label: 'Object tree', category: 'data', setup: (el) => el.setData({ name: 'birko', version: 1, active: true, tags: ['a', 'b'], nested: { x: 1, y: [2, 3] } }) },

  // ── feedback ──
  { tag: 'b-empty', label: 'Empty state', category: 'feedback', attrs: { icon: '📭', message: 'Nothing here yet' } },
  { tag: 'b-progress', label: 'Progress', category: 'feedback', attrs: { value: '65', max: '100', 'show-value': '', label: 'Uploading' }, controls: [PROGRESS_TYPE, STATUS] },
  { tag: 'b-spinner', label: 'Spinner', category: 'feedback', controls: [SIZE] },
  { tag: 'b-skeleton', label: 'Skeleton', category: 'feedback', attrs: { width: '180px', height: '1rem' } },
  { tag: 'b-stale-banner', label: 'Stale banner', category: 'feedback', render: () => 'Data may be out of date.', note: 'Typically shown when cached data is stale.' },
  { tag: 'b-toast-item', label: 'Toast item', category: 'feedback', attrs: { variant: 'success' }, render: () => 'Saved successfully', note: 'Normally emitted through the toast service.' },

  // ── nav ──
  { tag: 'b-breadcrumb', label: 'Breadcrumb', category: 'nav', setup: (el) => el.setItems([{ label: 'Home', href: '#' }, { label: 'Section', href: '#' }, { label: 'Page' }]) },
  { tag: 'b-tree-menu', label: 'Tree menu', category: 'nav', setup: (el) => el.setItems([{ id: 'r', label: 'Reports', children: [{ id: 'r1', label: 'Sales' }, { id: 'r2', label: 'Inventory' }] }, { id: 's', label: 'Settings' }]) },
  { tag: 'b-sidebar', label: 'Sidebar', category: 'nav', setup: (el) => el.setItems([{ id: 'home', label: 'Home', icon: '🏠' }, { id: 'data', label: 'Data', icon: '📊', children: [{ id: 'd1', label: 'Tables' }] }, { id: 'settings', label: 'Settings', icon: '⚙️' }]) },
  { tag: 'pg-mobile-shell', label: 'Mobile app shell', category: 'nav',
    note: 'BMobileAppShell — fixed top-bar + safe-area bottom-nav driven by a Surface[] nav-model. Tap a bottom-nav item to switch surfaces; the active item highlights (updates window.location.hash).',
    render: () => '<div style="padding:1rem"><h3 style="margin:.2rem 0 .5rem">Today</h3><p style="margin:0;color:var(--b-text-secondary)">Content projects through the shell’s default slot. Tap the bottom-nav below to switch surfaces — the active item turns primary.</p></div>' },
  { tag: 'b-ribbon', label: 'Ribbon', category: 'nav', attrs: { expanded: '' }, setup: (el) => el.setTabs([
    { id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', items: [{ id: 'paste', label: 'Paste', icon: '📋' }, { id: 'cut', label: 'Cut', icon: '✂️' }, { id: 'copy', label: 'Copy', icon: '📄' }] },
      { id: 'font', label: 'Font', items: [{ id: 'bold', label: 'Bold', icon: '𝐁' }, { id: 'italic', label: 'Italic', icon: '𝑰' }] },
    ] },
    { id: 'insert', label: 'Insert', groups: [
      { id: 'media', label: 'Media', items: [{ id: 'image', label: 'Image', icon: '🖼️' }, { id: 'table', label: 'Table', icon: '▦' }] },
    ] },
  ]) },

  // ── command ──
  { tag: 'b-command-palette', label: 'Command palette', category: 'command',
    note: 'Also opens with ⌘K / Ctrl+K anywhere in the app.',
    launch: { label: 'Open palette', run: () => {
      BirkoWebComponents.registerProvider({ id: 'pg-demo', label: 'Demo', order: 0, search: (q: string) => [
        { id: '1', label: 'Go to Dashboard', category: 'Navigation', icon: '🏠' },
        { id: '2', label: 'Create item', category: 'Actions', icon: '➕' },
        { id: '3', label: 'Open settings', category: 'Navigation', icon: '⚙️' },
      ].filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())) });
      BirkoWebComponents.openCommandPalette();
    } } },
];

const CATEGORY_LABELS: Record<string, string> = {
  inputs: 'Inputs', layout: 'Layout', data: 'Data', feedback: 'Feedback', nav: 'Navigation', command: 'Command',
};

// ── App shell ────────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function renderApp(root: HTMLElement): void {
  root.innerHTML = `
    <header class="pg-header">
      <div class="pg-brand">
        <strong>Birko.Web Playground</strong>
        <span class="pg-sub">component gallery · live token editor</span>
      </div>
      <b-segmented id="pg-nav" class="pg-nav"></b-segmented>
      <div class="pg-actions">
        <b-button id="open-tokens" size="sm">🎨 Design tokens</b-button>
        <b-button id="open-export" size="sm" variant="primary">Generate CSS</b-button>
      </div>
    </header>
    <main class="pg-main">
      <div id="pg-gallery" class="pg-gallery"></div>
    </main>

    <b-drawer id="tokens-drawer" title="Design tokens" modal>
      <div class="pg-tokens-head">
        <b-search-input id="token-filter" placeholder="filter --b-…"></b-search-input>
      </div>
      <div id="token-list" class="pg-token-list">Loading tokens…</div>
      <div slot="footer" class="pg-drawer-foot">
        <b-button id="reset-btn" size="sm">Reset edits</b-button>
        <b-button id="open-export-2" size="sm" variant="primary">Generate CSS…</b-button>
      </div>
    </b-drawer>

    <b-modal id="export-modal" title="Generate theme CSS">
      <div class="pg-export">
        <b-select id="export-mode" size="sm" value="theme"></b-select>
        <pre id="export-out" class="pg-export-out">Edit a token, then Generate CSS…</pre>
      </div>
      <div slot="footer" class="pg-modal-foot">
        <b-button id="export-btn" size="sm" variant="primary">Generate CSS</b-button>
        <b-button id="copy-btn" size="sm">Copy</b-button>
      </div>
    </b-modal>`;
  injectStyles();
  setupGallery(root);
  void initTokenEditor(root);
  reportMissing();
}

// ── Gallery ──────────────────────────────────────────────────────────────────
function registeredInCategory(cat: string): ComponentDef[] {
  return CATALOGUE.filter((d) => d.category === cat && customElements.get(d.tag));
}

// Each category's gallery is a hidden grid in the body; the header switcher toggles which shows.
// Grids populate lazily on first activation.
function buildSection(sec: HTMLElement, cat: string): void {
  if (sec.dataset.populated) return;
  sec.dataset.populated = '1';
  const entries = registeredInCategory(cat);
  if (!entries.length) { sec.appendChild(el('div', 'pg-note', 'No registered components in this section.')); return; }
  for (const def of entries) {
    try { sec.appendChild(renderItem(def)); }
    catch (e) { console.warn(`[playground] failed to render ${def.tag}:`, (e as Error).message); }
  }
  console.info(`[playground] section "${cat}" — ${entries.length} components`);
}

// b-segmented is the section switcher (emits change {value}); content lives in the body grids, not
// in tabs/panels — b-tabs hard-couples its strip to its panels, so the strip can't sit in the header.
function setupGallery(root: HTMLElement): void {
  const nav = root.querySelector<HTMLElement & { setOptions?: (o: unknown[]) => void }>('#pg-nav');
  const gallery = root.querySelector<HTMLElement>('#pg-gallery');
  if (!nav || !gallery) return;
  const cats = [...new Set(CATALOGUE.map((d) => d.category))].filter((c) => registeredInCategory(c).length > 0);

  const sections = new Map<string, HTMLElement>();
  for (const c of cats) {
    const sec = el('div', 'pg-grid');
    sec.dataset.cat = c;
    sec.style.display = 'none';
    sections.set(c, sec);
    gallery.appendChild(sec);
  }

  const show = (cat: string): void => {
    for (const [c, sec] of sections) sec.style.display = c === cat ? '' : 'none';
    buildSection(sections.get(cat)!, cat);
  };

  if (cats[0]) nav.setAttribute('value', cats[0]);
  requestAnimationFrame(() => nav.setOptions?.(cats.map((c) => ({ value: c, label: `${CATEGORY_LABELS[c] ?? c} (${registeredInCategory(c).length})` }))));
  nav.addEventListener('change', (e: Event) => {
    const cat = (e as CustomEvent<{ value?: string }>).detail?.value;
    if (cat && sections.has(cat)) show(cat);
  });
  if (cats[0]) show(cats[0]);
}

function renderItem(def: ComponentDef): HTMLElement {
  const card = el('div', 'pg-item');
  card.appendChild(el('div', 'pg-item-label', `${def.label} <code>&lt;${def.tag}&gt;</code>`));

  const stage = el('div', 'pg-stage');
  const instance = document.createElement(def.tag);
  if (def.attrs) for (const [k, v] of Object.entries(def.attrs)) instance.setAttribute(k, v);
  if (def.render) instance.innerHTML = def.render();
  stage.appendChild(instance);

  // Overlays render nothing inline — give them a trigger so they can be demonstrated.
  if (def.launch) {
    const btn = document.createElement('b-button');
    btn.className = 'pg-launch';
    btn.setAttribute('variant', 'primary');
    btn.setAttribute('size', 'sm');
    btn.textContent = def.launch.label;
    btn.addEventListener('click', () => {
      try { def.launch!.run(instance); }
      catch (e) { console.warn(`[playground] ${def.tag} launch failed:`, (e as Error).message); }
    });
    stage.appendChild(btn);
  }
  card.appendChild(stage);

  // Populate data-driven components after they upgrade + connect (rAF), guarded so a
  // shape mismatch only warns rather than breaking the gallery.
  if (def.setup) {
    requestAnimationFrame(() => {
      try { def.setup!(instance); }
      catch (e) { console.warn(`[playground] ${def.tag} setup failed:`, (e as Error).message); }
    });
  }

  if (def.note) card.appendChild(el('div', 'pg-note', def.note));

  if (def.controls?.length) {
    const controls = el('div', 'pg-controls');
    for (const c of def.controls) {
      const wrap = el('label', 'pg-control');
      wrap.append(`${c.label} `);
      // Dogfood: the control itself is a b-select (emits 'change' { value }).
      const sel = document.createElement('b-select') as HTMLElement & { setOptions?: (o: unknown[]) => void };
      sel.setAttribute('size', 'sm');
      sel.setAttribute('value', c.options[0]);
      const opts = c.options.map((o) => ({ value: o, label: o === '' ? '(none)' : o }));
      requestAnimationFrame(() => { try { sel.setOptions?.(opts); } catch { /* not upgraded */ } });
      sel.addEventListener('change', (e: Event) => {
        applyControl(instance, c.attr, (e as CustomEvent<{ value?: string }>).detail?.value ?? '');
      });
      applyControl(instance, c.attr, c.options[0]);
      wrap.appendChild(sel);
      controls.appendChild(wrap);
    }
    card.appendChild(controls);
  }
  return card;
}

function applyControl(node: Element, attr: string, value: string): void {
  if (value === '') node.removeAttribute(attr);
  else node.setAttribute(attr, value);
}

function reportMissing(): void {
  const missing = CATALOGUE.filter((d) => !customElements.get(d.tag)).map((d) => d.tag);
  if (missing.length) console.warn(`[playground] catalogue tags not registered: ${missing.join(', ')}`);
}

// ── Token editor ─────────────────────────────────────────────────────────────
const baseTokens = new Map<string, string>();    // name -> base value (from tokens.css :root)
const edits = new Map<string, string>();         // name -> edited value
const tokenGroups = new Map<string, string[]>(); // group label -> token names
let exportMode = 'theme';
let tokensBuilt = false;
const GROUP_ORDER = ['Color & surface', 'Typography', 'Spacing', 'Radius', 'Sizing', 'Shadow', 'Motion', 'Z-index', 'Other'];

async function initTokenEditor(root: HTMLElement): Promise<void> {
  const listEl = root.querySelector<HTMLElement>('#token-list')!;
  const drawer = root.querySelector<HTMLElement & { open?: () => void }>('#tokens-drawer');
  const modal = root.querySelector<HTMLElement & { open?: () => void }>('#export-modal');
  try {
    const css = await (await fetch('css/tokens.css')).text();
    parseRootTokens(css);
    listEl.textContent = '';
  } catch (e) {
    listEl.textContent = `Could not load css/tokens.css (${(e as Error).message}). Run the build first.`;
  }

  const out = root.querySelector<HTMLElement>('#export-out')!;
  const placeholder = 'Edit a token, then Generate CSS…';

  // Dogfooded chrome: b-select (change {value}), b-search-input (search {value}), b-button (click).
  const mode = root.querySelector<HTMLElement & { setOptions?: (o: unknown[]) => void }>('#export-mode');
  requestAnimationFrame(() => mode?.setOptions?.([
    { value: 'theme', label: '[data-theme] block' },
    { value: 'root', label: ':root override' },
  ]));
  mode?.addEventListener('change', (e) => { exportMode = (e as CustomEvent<{ value?: string }>).detail?.value ?? 'theme'; });

  // Tokens live in a drawer; build the accordion the first time it opens.
  root.querySelector('#open-tokens')?.addEventListener('click', () => {
    if (baseTokens.size && !tokensBuilt) buildTokenAccordion(listEl);
    drawer?.open?.();
  });
  // Generate CSS lives in a modal; render the current export on open (from header or drawer footer).
  const openExport = (): void => { out.textContent = generateCss(exportMode); modal?.open?.(); };
  root.querySelector('#open-export')?.addEventListener('click', openExport);
  root.querySelector('#open-export-2')?.addEventListener('click', openExport);

  root.querySelector('#token-filter')?.addEventListener('search', (e) => {
    applyFilter(listEl, (e as CustomEvent<{ value?: string }>).detail?.value ?? '');
  });
  root.querySelector('#export-btn')?.addEventListener('click', () => { out.textContent = generateCss(exportMode); });
  root.querySelector('#reset-btn')?.addEventListener('click', () => {
    edits.clear(); applyTheme(); tokensBuilt = false; buildTokenAccordion(listEl); out.textContent = placeholder;
  });
  root.querySelector('#copy-btn')?.addEventListener('click', () => {
    const t = out.textContent ?? '';
    if (t && t !== placeholder) void navigator.clipboard?.writeText(t);
  });
}

function parseRootTokens(css: string): void {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) return;
  const re = /(--b-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(root[1])) !== null) baseTokens.set(m[1], m[2].trim());
}

function isColor(v: string): boolean {
  return /^#([0-9a-f]{3,8})$/i.test(v) || /^(rgb|hsl)a?\(/i.test(v);
}

function tokenGroup(name: string): string {
  const n = name.replace(/^--b-/, '');
  if (n.includes('radius')) return 'Radius';
  if (n.startsWith('space')) return 'Spacing';
  if (n.includes('shadow')) return 'Shadow';
  if (n.startsWith('z-')) return 'Z-index';
  if (/(animation|transition|duration|speed|ease)/.test(n)) return 'Motion';
  if (/(font|line-height|leading|letter)/.test(n) || /^text-(xs|sm|base|md|lg|xl|\d)/.test(n)) return 'Typography';
  if (/(control|icon|width|height|-size)/.test(n)) return 'Sizing';
  if (/(color|bg|text|border|focus|overlay|backdrop|primary|secondary|tertiary|danger|success|warning|info|brand|surface|hover|disabled|inverse|row-|table-)/.test(n)) return 'Color & surface';
  return 'Other';
}

function groupSlug(g: string): string {
  return 'g-' + g.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Grouped + collapsible via b-accordion (multiple-open) — the editor dogfoods the component library
// it documents. Rows are eager (modest token count); built on first drawer open and on reset.
function buildTokenAccordion(container: HTMLElement): void {
  container.innerHTML = '';
  tokenGroups.clear();
  for (const name of baseTokens.keys()) {
    const g = tokenGroup(name);
    if (!tokenGroups.has(g)) tokenGroups.set(g, []);
    tokenGroups.get(g)!.push(name);
  }
  const acc = document.createElement('b-accordion') as HTMLElement & { setItems?: (i: unknown[]) => void };
  acc.setAttribute('multiple', '');
  acc.id = 'token-acc';
  const items = GROUP_ORDER.filter((g) => tokenGroups.has(g)).map((g, i) => {
    const slug = groupSlug(g);
    const body = el('div', 'pg-tgroup-body');
    body.setAttribute('slot', slug);
    for (const name of tokenGroups.get(g)!) body.appendChild(renderTokenRow(name));
    acc.appendChild(body);
    return { id: slug, header: `${g} (${tokenGroups.get(g)!.length})`, open: i === 0 };
  });
  container.appendChild(acc);
  requestAnimationFrame(() => acc.setItems?.(items));
  tokensBuilt = true;
}

function renderTokenRow(name: string): HTMLElement {
  const base = baseTokens.get(name)!;
  const current = edits.get(name) ?? base;
  const row = el('div', 'pg-token');
  row.dataset.name = name;
  row.appendChild(el('code', 'pg-token-name', name));

  const colorish = isColor(base) && /^#/.test(current);
  const input = document.createElement(colorish ? 'b-color-picker' : 'b-input');
  input.setAttribute('value', current);
  if (!colorish) input.setAttribute('size', 'sm');
  input.addEventListener('change', (e) => {
    const v = (e as CustomEvent<{ value?: string }>).detail?.value ?? '';
    if (v === base) edits.delete(name); else edits.set(name, v);
    applyTheme();
  });
  row.appendChild(input);
  return row;
}

function applyFilter(container: HTMLElement, q: string): void {
  const query = q.toLowerCase();
  const acc = container.querySelector<HTMLElement & { openAll?: () => void }>('b-accordion');
  if (!acc) return;
  if (query) acc.openAll?.(); // expand every group so matches in collapsed groups are visible
  container.querySelectorAll<HTMLElement>('.pg-token').forEach((row) => {
    row.style.display = !query || row.dataset.name!.includes(query) ? '' : 'none';
  });
}

function applyTheme(): void {
  const style = document.getElementById('playground-theme')!;
  if (edits.size === 0) {
    style.textContent = '';
    document.documentElement.removeAttribute('data-theme');
    return;
  }
  const body = [...edits].map(([n, v]) => `  ${n}: ${v};`).join('\n');
  style.textContent = `[data-theme="playground"] {\n${body}\n}`;
  document.documentElement.setAttribute('data-theme', 'playground');
}

function generateCss(mode: string): string {
  if (edits.size === 0) return '/* No token edits — change a token, then Generate CSS. */';
  const body = [...edits].map(([n, v]) => `  ${n}: ${v};`).join('\n');
  const header =
    `/* Birko.Web theme export — ${edits.size} token(s) changed from base.\n` +
    (mode === 'theme'
      ? `   Drop into your app CSS, then: registerThemes([{ id: 'my-brand', label: 'My Brand', icon: '🎨' }]). */\n`
      : `   Drop into your app's :root (overrides the base tokens.css). */\n`);
  const selector = mode === 'theme' ? '[data-theme="my-brand"]' : ':root';
  return `${header}${selector} {\n${body}\n}\n`;
}

// ── Styles (playground chrome only — components use the Birko tokens) ──────────
function injectStyles(): void {
  if (document.getElementById('pg-styles')) return;
  const s = document.createElement('style');
  s.id = 'pg-styles';
  s.textContent = `
    .pg-header { display:flex; align-items:center; gap:1rem; padding:.6rem 1rem; background:var(--b-bg,#fff); border-bottom:1px solid var(--b-border,#ddd); position:sticky; top:0; z-index:10; flex-wrap:wrap; }
    .pg-brand { display:flex; flex-direction:column; line-height:1.2; }
    .pg-sub { color:var(--b-text-secondary,#888); font-size:.78rem; }
    .pg-nav { flex:1 1 auto; min-width:0; overflow-x:auto; }
    .pg-actions { display:flex; gap:.4rem; margin-left:auto; }
    .pg-main { padding:1.25rem; }
    .pg-gallery { min-width:0; }
    .pg-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(400px,1fr)); gap:1.5rem; }
    .pg-note { font-size:.7rem; color:var(--b-text-secondary,#999); font-style:italic; margin-top:.4rem; }
    .pg-item { display:flex; flex-direction:column; background:var(--b-bg,#fff); border:1px solid var(--b-border,#ddd); border-radius:var(--b-radius,8px); padding:1rem; }
    .pg-item-label { font-size:.8rem; color:var(--b-text-secondary,#888); margin-bottom:.6rem; }
    .pg-stage { flex:1 1 auto; display:flex; flex-wrap:wrap; align-content:center; align-items:center; justify-content:center; gap:.75rem; min-height:200px; overflow:auto; padding:1.25rem; background:var(--b-bg-secondary,#fafafa); border-radius:var(--b-radius,6px); }
    .pg-stage > * { max-width:100%; }
    /* form inputs + wide display/nav components fill the available card width; small inline
       components (button, badge, tag, switch, spinner, …) keep their intrinsic size, centered. */
    .pg-stage > :is(b-input,b-textarea,b-select,b-search-input,b-multi-select,b-tag-input,b-color-picker,
      b-date-picker,b-datetime-picker,b-date-range-picker,b-time,b-range,b-file-upload,b-markdown-editor,
      b-inline-edit,b-segmented,b-option-group,b-form,b-progress,b-table,b-data-table,b-editable-table,
      b-chart,b-json-viewer,b-xml-viewer,b-object-tree,b-definition-list,b-code-block,b-pre,b-stat,b-card,
      b-accordion,b-tabs,b-breadcrumb,b-tree-menu,b-sidebar,b-ribbon,b-kanban,b-chat,b-pagination,
      b-stale-banner,b-toast-item,b-split-panel) { width:100%; }
    /* Mobile app-shell demo: render at phone size inside a framed device, so its full-height
       top-bar/content/bottom-nav layout reads correctly within a gallery card. */
    .pg-stage pg-mobile-shell { display:block; width:320px; height:560px; overflow:hidden;
      border:8px solid var(--b-border,#ddd); border-radius:28px; background:var(--b-bg,#fff); }
    .pg-controls { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.5rem; border-top:1px dashed var(--b-border,#eee); padding-top:.5rem; }
    .pg-control { font-size:.72rem; color:var(--b-text-secondary,#888); display:flex; flex-direction:column; align-items:flex-start; gap:.15rem; }
    .pg-control b-select { min-width:7rem; width:100%; }
    .pg-tokens-head { margin-bottom:.6rem; }
    .pg-tokens-head b-search-input { width:100%; }
    .pg-tgroup-body { padding:.2rem 0 .5rem; }
    .pg-token { display:flex; flex-direction:column; gap:.1rem; padding:.2rem 0; }
    .pg-token-name { font-size:.7rem; color:var(--b-text-secondary,#888); overflow:hidden; text-overflow:ellipsis; }
    .pg-token b-input, .pg-token b-color-picker { width:100%; }
    .pg-drawer-foot, .pg-modal-foot { display:flex; gap:.4rem; justify-content:flex-end; }
    .pg-export { display:flex; flex-direction:column; gap:.6rem; }
    .pg-export-out { width:100%; min-height:160px; max-height:50vh; overflow:auto; box-sizing:border-box; font-family:monospace; font-size:.72rem; background:var(--b-bg-secondary,#f5f5f5); border:1px solid var(--b-border,#ddd); border-radius:var(--b-radius,6px); padding:.6rem; white-space:pre-wrap; margin:0; }
  `;
  document.head.appendChild(s);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const app = document.getElementById('app');
if (app) renderApp(app);
