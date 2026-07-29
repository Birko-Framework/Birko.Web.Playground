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
  // STORY-001 / TASK-001 — `bare` attribute on the form controls.
  void import('./bare-smoke.js');
  // STORY-023 / TASK-035 — ElementInternals form association.
  void import('./form-assoc-smoke.js');
  // EPIC-001 — the `description` help-text row.
  void import('./description-smoke.js');
  // STORY-002 / TASK-002 — the raw-vs-bare grid benchmark that gates the b-editable-table migration.
  void import('./grid-bench-smoke.js');
  // STORY-049 / TASK-097 — the ribbon's overflow affordance (tab strip + panel, incl. resize-only).
  void import('./ribbon-overflow-smoke.js');
}

// ── BMobileAppShell demo (EPIC-016 / TASK-049) ───────────────────────────────
// BMobileAppShell is abstract (needs surfaces + brand/user/t/onSignOut), so the playground
// supplies a tiny concrete subclass — a consumer, not framework code — registered as
// <pg-mobile-shell> and shown phone-framed in the Navigation section.
import { BMobileAppShell, type Surface } from 'birko-web-shell';
import { createWakeLockManager, createAudioCue, registerServiceWorker } from 'birko-web-core';
// Imperative dialog helpers (TASK-063) — the lean subpath, not the layout/inputs barrels.
import {
  confirm as dlgConfirm, confirmDelete, alert as dlgAlert, prompt as dlgPrompt,
  choose, promptForm, busy, notify,
} from 'birko-web-components/dialogs';

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

// Device-utils demo card (EPIC-016 backports): Screen Wake Lock, iOS-safe audio cue, and opt-in PWA
// service-worker register/unregister — the interactive coverage promoted out of the old review panel.
class PgDeviceDemo extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:center">
        <b-button variant="secondary" data-act="wake">Acquire wake lock</b-button>
        <b-button variant="ghost" data-act="wake-off">Release</b-button>
        <b-button variant="secondary" data-act="beep">Beep</b-button>
        <b-button variant="secondary" data-act="sw-on">Register SW</b-button>
        <b-button variant="ghost" data-act="sw-off">Unregister SW</b-button>
      </div>
      <p data-status style="font-size:.8rem;color:var(--b-text-secondary);min-height:1.2em;margin:.5rem 0 0"></p>`;
    const wake = createWakeLockManager();
    const cue = createAudioCue();
    const say = (m: string): void => { const s = this.querySelector('[data-status]'); if (s) s.textContent = m; };
    const on = (act: string, fn: () => void): void => {
      this.querySelector(`[data-act="${act}"]`)?.addEventListener('click', fn);
    };
    on('wake', () => { wake.acquire(); say(`wake lock: ${wake.held ? 'held' : 'requested (may be denied off-gesture)'}`); });
    on('wake-off', () => { wake.release(); say('wake lock released'); });
    on('beep', () => { cue.prime(); cue.beep({ frequency: 660, durationMs: 120, vibrate: 20 }); say('beep'); });
    on('sw-on', () => { void registerServiceWorker('/sw.js').then((reg) => say(reg ? 'SW registered — see DevTools → Application; go Offline + reload' : 'SW registration failed / unsupported')); });
    on('sw-off', () => { void (async () => {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      say(`unregistered ${regs.length} service worker(s) — reload to clear`);
    })(); });
  }
}
if (!customElements.get('pg-device-demo')) customElements.define('pg-device-demo', PgDeviceDemo);

// Vertical-range equalizer bank (TASK-053) — a row of slider-only vertical b-ranges.
class PgEqualizer extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.style.display = 'flex';
    this.style.gap = '1rem';
    this.style.height = '180px';
    this.innerHTML = [30, 55, 80, 45, 65]
      .map((v) => `<b-range orientation="vertical" display="slider" min="0" max="100" value="${v}"></b-range>`)
      .join('');
  }
}
if (!customElements.get('pg-equalizer')) customElements.define('pg-equalizer', PgEqualizer);

// ── Imperative dialogs demo (TASK-063) ───────────────────────────────────────
// The dialog helpers are functions, not components, so the gallery hosts them in a small
// local element: a button per helper + a readout of the last awaited result. Each button also
// logs `[playground] dialogs: <name> => <result>` so verify.mjs can assert behaviour headlessly.
class PgDialogs extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-start';
    const out = document.createElement('code');
    out.className = 'pg-dialogs-out';
    out.style.cssText = 'flex:1 1 100%;margin-top:.5rem;color:var(--b-text-secondary);font-size:var(--b-text-sm)';
    out.textContent = 'result: —';
    const report = (name: string, value: unknown) => {
      const s = JSON.stringify(value);
      out.textContent = `result: ${name} → ${s}`;
      out.setAttribute('data-last', `${name}:${s}`);
      console.info(`[playground] dialogs: ${name} => ${s}`);
    };
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement('b-button');
      b.setAttribute('size', 'sm');
      b.setAttribute('variant', 'secondary');
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    this.append(
      mk('confirm', async () => report('confirm', await dlgConfirm('Proceed with the action?', { title: 'Confirm' }))),
      mk('confirmDelete', async () => report('confirmDelete', await confirmDelete('Delete this item? This cannot be undone.'))),
      mk('alert', async () => { await dlgAlert('Your changes have been saved.', { title: 'Saved' }); report('alert', 'ok'); }),
      mk('prompt', async () => report('prompt', await dlgPrompt('What is your name?', { defaultValue: 'Ada', placeholder: 'name' }))),
      mk('choose', async () => report('choose', await choose('Export format', [
        { label: 'PDF', value: 'pdf' }, { label: 'CSV', value: 'csv' }, { label: 'Excel', value: 'xlsx', variant: 'primary' },
      ]))),
      mk('promptForm', async () => report('promptForm', await promptForm([
        { name: 'first', type: 'text', label: 'First name', required: true, rules: [{ type: 'required' }] },
        { name: 'age', type: 'number', label: 'Age' },
      ], { title: 'Person' }))),
      mk('busy', async () => { await busy(() => new Promise((r) => setTimeout(r, 1200)), { message: 'Working…' }); report('busy', 'done'); }),
      mk('notify', () => { notify('This is a toast notification', 'success'); report('notify', 'toast'); }),
      out,
    );
  }
}
if (!customElements.get('pg-dialogs')) customElements.define('pg-dialogs', PgDialogs);

// ── `description` help-text row demo (STORY-029 / TASK-091) ──────────────────
// A human-test surface for the help-text row, laid out so each row answers one question from the task's
// human test plan: is it announced as the field's description, does it coexist with an error, does long
// text wrap inside a narrow column, and is the muted colour legible in the current theme.
class PgDescription extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.innerHTML = `
      <style>
        .pgd-grid { display: grid; gap: 1rem; }
        .pgd-case { border-top: 1px dashed var(--b-border); padding-top: .75rem; }
        .pgd-case:first-child { border-top: 0; padding-top: 0; }
        .pgd-q { font-size: var(--b-text-xs); color: var(--b-text-secondary); margin: 0 0 .4rem; }
        /* A deliberately narrow column: the wrap check needs a field narrower than its help text. */
        .pgd-narrow { max-width: 11rem; }
        .pgd-row { display: flex; gap: .5rem; align-items: flex-start; flex-wrap: wrap; }
        .pgd-cell { border: 1px solid var(--b-border); padding: .35rem; border-radius: var(--b-radius); }
      </style>
      <div class="pgd-grid">
        <div class="pgd-case">
          <p class="pgd-q">1 — Announced as the field's description? Focus it with a screen reader on.</p>
          <b-input label="Steps" type="number" inputmode="numeric" min="0"
                   description="Goal 8000 steps"></b-input>
        </div>

        <div class="pgd-case">
          <p class="pgd-q">2 — Error + description together: BOTH announced, error first. Type a negative
             value, or press the button to set an error.</p>
          <b-input id="pgd-err" label="Steps" type="number" inputmode="numeric" min="0"
                   description="Goal 8000 steps"></b-input>
          <div class="pgd-row" style="margin-top:.4rem">
            <b-button size="sm" variant="secondary" data-act="err-on">Set error</b-button>
            <b-button size="sm" variant="ghost" data-act="err-off">Clear error</b-button>
          </div>
        </div>

        <div class="pgd-case">
          <p class="pgd-q">3 — Long text in a narrow column: does it wrap rather than widen the field?</p>
          <div class="pgd-narrow">
            <b-input label="Reference" description="Up to 20 characters; letters, digits and dashes only — no spaces"></b-input>
          </div>
        </div>

        <div class="pgd-case">
          <p class="pgd-q">4 — Help-row colour legible in every shipped theme? Switch below and compare the
             help row against the error row and the label. Measured: AA in light / dark / neon / inverse,
             3.77:1 in finstat (theme-token limit, shared with the label). (The switcher sets
             <code>data-theme</code> on &lt;html&gt;, so it re-themes the whole gallery, not just this card.)</p>
          <div class="pgd-row" style="margin-bottom:.5rem">
            <b-segmented id="pgd-theme"></b-segmented>
          </div>
          <b-input label="Contrast sample" description="Help text — var(--b-text-secondary) on var(--b-bg)"
                   error="Error row for comparison — var(--b-color-danger)"></b-input>
        </div>

        <div class="pgd-case">
          <p class="pgd-q">5 — hint AND description coexist: <code>?</code> tooltip beside the label,
             persistent row under the control.</p>
          <b-input label="Superset group" type="number" inputmode="numeric"
                   description="Max 10"
                   hint="Same number = performed back-to-back as a superset"></b-input>
        </div>

        <div class="pgd-case">
          <p class="pgd-q">6 — Dense layouts: <code>bare</code> drops the row entirely (hover for the
             title fallback). Both cells carry the same description.</p>
          <div class="pgd-row">
            <span class="pgd-cell">
              <b-input bare size="sm" label="Qty" type="number" min="0" inputmode="numeric"
                       description="Whole units only"></b-input>
            </span>
            <span class="pgd-cell">
              <b-input size="sm" label="Qty" type="number" min="0" inputmode="numeric"
                       description="Whole units only"></b-input>
            </span>
          </div>
        </div>

        <div class="pgd-case">
          <p class="pgd-q">7 — Every stacked-chrome control carries it, not just b-input.</p>
          <b-select id="pgd-select" label="Status" description="Draft rows are not billed"></b-select>
          <b-textarea label="Notes" rows="2" description="Markdown is not rendered here"></b-textarea>
          <b-tag-input id="pgd-tags" label="Labels" description="Enter or comma to commit a tag"></b-tag-input>
          <b-multi-select id="pgd-multi" label="Sites" description="Leave empty for all sites"></b-multi-select>
          <b-date-picker label="Start" description="Cannot precede the contract date"></b-date-picker>
          <b-datetime-picker label="Cutoff" description="Local time, not UTC"></b-datetime-picker>
        </div>
      </div>`;

    const field = this.querySelector('#pgd-err');
    this.querySelector('[data-act="err-on"]')?.addEventListener('click',
      () => field?.setAttribute('error', 'Steps cannot be negative'));
    this.querySelector('[data-act="err-off"]')?.addEventListener('click',
      () => field?.removeAttribute('error'));

    // Theme switcher for case 4. The shipped themes are linked in index.html and each activates on a
    // `data-theme` value on <html>; base/light is the absence of one.
    type Seg = HTMLElement & { setOptions(o: { value: string; label: string }[]): void; value: string };
    const theme = this.querySelector('#pgd-theme') as Seg | null;
    if (theme) {
      theme.setOptions([
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'neon', label: 'Neon' },
        { value: 'finstat', label: 'Finstat' },
        { value: 'inverse', label: 'Inverse' },
      ]);
      theme.value = document.documentElement.getAttribute('data-theme') ?? 'light';
      theme.addEventListener('change', (e) => {
        const v = (e as CustomEvent<{ value?: string }>).detail?.value ?? 'light';
        document.documentElement.setAttribute('data-theme', v);
      });
    }

    // Options are data — set them imperatively, as a consumer would.
    type Opts = HTMLElement & { setOptions(o: { value: string; label: string }[]): void };
    (this.querySelector('#pgd-select') as Opts | null)?.setOptions(
      [{ value: 'draft', label: 'Draft' }, { value: 'open', label: 'Open' }]);
    (this.querySelector('#pgd-multi') as Opts | null)?.setOptions(
      [{ value: 'a', label: 'Site A' }, { value: 'b', label: 'Site B' }]);
  }
}
if (!customElements.get('pg-description')) customElements.define('pg-description', PgDescription);
// ── Grid benchmark card (STORY-002 / TASK-002) ───────────────────────────────
// Runs the raw-vs-bare 500-row comparison on demand — it allocates thousands of nodes, so it is
// button-driven rather than built with the gallery.
class PgGridBench extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.innerHTML = `
      <p style="font-size:var(--b-text-xs);color:var(--b-text-secondary);margin:0 0 .5rem">
        500 rows × 6 columns (3000 cells), median of 3 passes. Compares the raw
        <code>&lt;input&gt;</code>/<code>&lt;select&gt;</code> cells b-editable-table renders today against
        <code>&lt;b-input bare size="sm"&gt;</code> per cell. Takes a few seconds.</p>
      <b-button variant="primary" size="sm" data-act="run">Run benchmark</b-button>
      <pre class="pgb-out" style="margin:.6rem 0 0;font-size:var(--b-text-xs);white-space:pre-wrap"></pre>
      <div class="pgb-stage" style="position:absolute;left:-9999px;top:0"></div>`;
    const out = this.querySelector('.pgb-out')!;
    const stage = this.querySelector('.pgb-stage') as HTMLElement;
    this.querySelector('[data-act="run"]')?.addEventListener('click', async () => {
      out.textContent = 'running…';
      const { runGridBench } = await import('./grid-bench.js');
      const res = await runGridBench(stage, 3);
      out.textContent = res.map((r) =>
        `${r.variant.padEnd(5)} build ${String(r.buildMs).padStart(7)}ms   rerender ${String(r.rerenderMs).padStart(7)}ms` +
        `   edit×50 ${String(r.editMs).padStart(6)}ms   caret ${r.caretKept ? 'kept' : 'LOST'}` +
        `   ${r.elements} elements, ${r.shadowRoots} shadow roots`).join('\n');
    });
  }
}
if (!customElements.get('pg-grid-bench')) customElements.define('pg-grid-bench', PgGridBench);



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
// STORY-001/TASK-001 — flip the stacked .field chrome off to review the inline (toolbar / table-cell) form.
const BARE: ControlDef = { label: 'bare', attr: 'bare', options: ['', 'bare'] };
const PROGRESS_TYPE: ControlDef = { label: 'type', attr: 'type', options: ['linear', 'circular'] };
// Overlay width ladder — flip before hitting the launch button. b-modal adds `full`
// (viewport minus --b-modal-full-inset, both axes) for editor surfaces; b-drawer has no `full`.
const OVERLAY_SIZE: ControlDef = { label: 'size', attr: 'size', options: ['', 'sm', 'lg', 'xl', 'xxl'] };
const MODAL_SIZE: ControlDef = { label: 'size', attr: 'size', options: ['', 'sm', 'lg', 'xl', 'xxl', 'full'] };
// b-tag has no `variant` — its real knobs are `color` (the leading dot), `size` and `removable`.
const TAG_COLOR: ControlDef = { label: 'color', attr: 'color', options: ['', '#25ba7a', '#0091ff', '#f5a623', '#e5484d', '#8e4ec6'] };
const REMOVABLE: ControlDef = { label: 'removable', attr: 'removable', options: ['', 'removable'] };

// Full catalogue (kept in sync with Birko.Web.Components). reportMissing() warns about any
// tag here that didn't register; a registered component absent from this list is a gap to fill.
const CATALOGUE: ComponentDef[] = [
  // ── inputs ──
  { tag: 'b-button', label: 'Button', category: 'inputs', render: () => 'Click me', controls: [VARIANT, SIZE, DISABLED] },
  { tag: 'b-checkbox', label: 'Checkbox', category: 'inputs', render: () => 'Accept terms', controls: [DISABLED] },
  { tag: 'b-radio', label: 'Radio', category: 'inputs', render: () => 'Option A', attrs: { name: 'demo-radio', value: 'a' }, controls: [DISABLED] },
  { tag: 'b-switch', label: 'Switch', category: 'inputs', render: () => 'Enabled', controls: [DISABLED] },
  { tag: 'b-input', label: 'Input', category: 'inputs', attrs: { label: 'Name', placeholder: 'Type here…', description: 'Shown as-is under the control (the `description` attribute)' }, controls: [SIZE, DISABLED, BARE] },
  { tag: 'b-textarea', label: 'Textarea', category: 'inputs', attrs: { label: 'Notes', placeholder: 'Multi-line…' }, controls: [DISABLED, BARE] },
  { tag: 'b-search-input', label: 'Search input', category: 'inputs', attrs: { placeholder: 'Search…' }, controls: [SIZE] },
  { tag: 'b-select', label: 'Select', category: 'inputs', attrs: { label: 'Pick one', placeholder: 'Choose…' }, render: () => '<option value="1">One</option><option value="2">Two</option><option value="3">Three</option>', controls: [SIZE, BARE] },
  { tag: 'b-multi-select', label: 'Multi-select', category: 'inputs', attrs: { label: 'Pick many' }, controls: [BARE], setup: (el) => el.setOptions([{ value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }]) },
  { tag: 'b-color-picker', label: 'Color picker', category: 'inputs', attrs: { value: '#25ba7acc', label: 'Brand color', alpha: '' } },
  { tag: 'b-range', label: 'Range', category: 'inputs', attrs: { min: '0', max: '100', value: '60' },
    controls: [{ label: 'orientation', attr: 'orientation', options: ['horizontal', 'vertical'] }] },
  { tag: 'pg-description', label: 'Help text — the `description` row', category: 'inputs',
    note: 'STORY-029/TASK-091: persistent help text under a control, wired into aria-describedby (a page-rendered sibling cannot be, since the control is in shadow DOM). Each numbered row answers one human-test question — SR announcement, error+description together, wrapping in a narrow column, help-row contrast per theme (with a live theme switcher — the shipped themes were never linked in index.html before, so the gallery could only be seen in light), hint+description coexisting, and bare dropping the row.' },
  { tag: 'pg-equalizer', label: 'Range — vertical (equalizer)', category: 'inputs',
    note: 'A row of vertical b-range sliders (orientation="vertical", display="slider") — the equalizer/mixer layout (TASK-053).' },
  { tag: 'b-date-picker', label: 'Date picker', category: 'inputs', attrs: { label: 'Date' }, controls: [BARE] },
  { tag: 'b-datetime-picker', label: 'Datetime picker', category: 'inputs', attrs: { label: 'When' }, controls: [BARE] },
  { tag: 'b-date-range-picker', label: 'Date range', category: 'inputs', attrs: { label: 'Range' } },
  { tag: 'b-time', label: 'Time', category: 'inputs', attrs: { label: 'Time' } },
  { tag: 'b-file-upload', label: 'File upload', category: 'inputs', attrs: { label: 'Upload a file' }, controls: [BARE] },
  { tag: 'b-inline-edit', label: 'Inline edit', category: 'inputs', attrs: { value: 'Click to edit' } },
  { tag: 'b-markdown-editor', label: 'Markdown editor', category: 'inputs', attrs: { value: '# Hello\n\nMarkdown **here**.' } },
  { tag: 'b-tag-input', label: 'Tag input', category: 'inputs', attrs: { label: 'Tags', placeholder: 'add tag…' }, controls: [BARE], setup: (el) => el.setTags(['design', 'birko', 'web', 'components']) },
  { tag: 'b-segmented', label: 'Segmented', category: 'inputs', attrs: { value: 'day' }, setup: (el) => el.setOptions([{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]) },
  { tag: 'b-option-group', label: 'Option group', category: 'inputs', attrs: { label: 'Choose' }, controls: [BARE], setup: (el) => el.setOptions([{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }, { value: 'c', label: 'Option C' }]) },
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
    controls: [MODAL_SIZE],
    launch: { label: 'Open modal', run: (el) => el.open() } },
  { tag: 'b-drawer', label: 'Drawer', category: 'layout', attrs: { title: 'Example drawer' },
    render: () => '<p>Drawer body content goes here.</p>',
    controls: [OVERLAY_SIZE],
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
  { tag: 'pg-grid-bench', label: 'Grid benchmark — raw vs bare cells', category: 'data',
    note: 'STORY-002/TASK-002: the benchmark that gates migrating b-editable-table cells onto <b-input bare size=\"sm\">. Button-driven (allocates 3000 cells). Measures build, re-render, 50-keystroke edit latency, caret survival and node/shadow-root count for both variants.' },
  { tag: 'b-badge', label: 'Badge', category: 'data', render: () => 'New', controls: [STATUS] },
  { tag: 'b-tag', label: 'Tag', category: 'data', render: () => 'tag', controls: [TAG_COLOR, SIZE, REMOVABLE] },
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
  { tag: 'b-chart', label: 'Chart', category: 'data', attrs: { type: 'bar', height: '220' },
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
  { tag: 'b-sync-status', label: 'Sync status', category: 'feedback',
    note: 'Offline / syncing / synced chip bound to an outbox SyncSource (EPIC-002 backport). Shown with 2 pending writes (syncing); it hides when online + idle and shows "offline" when disconnected.',
    setup: (el) => el.bind({ get pendingCount() { return 2; }, onChange() { return () => {}; } }) },
  { tag: 'pg-device-demo', label: 'Device utils (wake lock / audio cue / SW)', category: 'feedback',
    note: 'EPIC-016 backports: Screen Wake Lock, iOS-safe audio cue, and opt-in PWA service-worker register/unregister. Buttons drive each; the playground never auto-registers a SW.' },
  { tag: 'pg-dialogs', label: 'Dialogs (imperative helpers)', category: 'feedback',
    note: 'TASK-063: birko-web-components/dialogs — confirm / confirmDelete / alert / prompt / choose / promptForm / busy / notify. Click a button; the awaited result shows below. All are themed native <dialog> (top layer).' },

  // ── nav ──
  { tag: 'b-breadcrumb', label: 'Breadcrumb', category: 'nav', setup: (el) => el.setItems([{ label: 'Home', href: '#' }, { label: 'Section', href: '#' }, { label: 'Page' }]) },
  { tag: 'b-tree-menu', label: 'Tree menu', category: 'nav', setup: (el) => el.setItems([{ id: 'r', label: 'Reports', children: [{ id: 'r1', label: 'Sales' }, { id: 'r2', label: 'Inventory' }] }, { id: 's', label: 'Settings' }]) },
  { tag: 'b-sidebar', label: 'Sidebar', category: 'nav', setup: (el) => el.setItems([{ id: 'home', label: 'Home', icon: '🏠' }, { id: 'data', label: 'Data', icon: '📊', children: [{ id: 'd1', label: 'Tables' }] }, { id: 'settings', label: 'Settings', icon: '⚙️' }]) },
  { tag: 'pg-mobile-shell', label: 'Mobile app shell', category: 'nav',
    note: 'BMobileAppShell — fixed top-bar + safe-area bottom-nav driven by a Surface[] nav-model. Tap a bottom-nav item to switch surfaces; the active item highlights (updates window.location.hash).',
    render: () => '<div style="padding:1rem"><h3 style="margin:.2rem 0 .5rem">Today</h3><p style="margin:0;color:var(--b-text-secondary)">Content projects through the shell’s default slot. Tap the bottom-nav below to switch surfaces — the active item turns primary.</p></div>' },
  // Deliberately dense — an Office-sized ribbon (8 tabs, 5 groups on the active tab), so the overflow
  // behaviour is observable: narrow the browser and the tab-strip and panel chevrons appear
  // (STORY-049/TASK-097). The old 2-tab / 2-group demo never overflowed, so the fix could not be
  // reviewed by hand.
  { tag: 'b-ribbon', label: 'Ribbon', category: 'nav', attrs: { expanded: '', pinned: '' }, setup: (el) => el.setTabs([
    { id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', items: [{ id: 'paste', label: 'Paste', icon: '📋' }, { id: 'cut', label: 'Cut', icon: '✂️' }, { id: 'copy', label: 'Copy', icon: '📄' }] },
      { id: 'font', label: 'Font', items: [{ id: 'bold', label: 'Bold', icon: '𝐁' }, { id: 'italic', label: 'Italic', icon: '𝑰' }] },
      { id: 'records', label: 'Records', items: [{ id: 'new', label: 'New', icon: '➕' }, { id: 'del', label: 'Delete', icon: '🗑' }] },
      { id: 'review', label: 'Review', items: [{ id: 'comment', label: 'Comment', icon: '💬' }, { id: 'track', label: 'Track', icon: '✓' }] },
      { id: 'export', label: 'Export', items: [{ id: 'pdf', label: 'PDF', icon: '📄' }, { id: 'csv', label: 'CSV', icon: '📊' }, { id: 'print', label: 'Print', icon: '🖨' }] },
    ] },
    { id: 'insert', label: 'Insert', groups: [
      { id: 'media', label: 'Media', items: [{ id: 'image', label: 'Image', icon: '🖼️' }, { id: 'table', label: 'Table', icon: '▦' }] },
    ] },
    { id: 'design', label: 'Design', groups: [
      { id: 'themes', label: 'Themes', items: [{ id: 'palette', label: 'Palette', icon: '🎨' }, { id: 'fonts', label: 'Fonts', icon: '🅰' }] },
    ] },
    { id: 'data', label: 'Data', groups: [
      { id: 'query', label: 'Query', items: [{ id: 'filter', label: 'Filter', icon: '🔍' }, { id: 'sort', label: 'Sort', icon: '↕' }] },
    ] },
    { id: 'view', label: 'View', groups: [
      { id: 'zoom', label: 'Zoom', items: [{ id: 'zin', label: 'Zoom In', icon: '🔍' }, { id: 'reset', label: 'Reset', icon: '↺' }] },
    ] },
    { id: 'automate', label: 'Automate', groups: [
      { id: 'macros', label: 'Macros', items: [{ id: 'rec', label: 'Record', icon: '⏺' }, { id: 'run', label: 'Run', icon: '▶' }] },
    ] },
    { id: 'developer', label: 'Developer', groups: [
      { id: 'tools', label: 'Tools', items: [{ id: 'console', label: 'Console', icon: '🖥' }, { id: 'inspect', label: 'Inspect', icon: '🔎' }] },
    ] },
    { id: 'help', label: 'Help', groups: [
      { id: 'support', label: 'Support', items: [{ id: 'docs', label: 'Docs', icon: '📘' }, { id: 'contact', label: 'Contact', icon: '✉' }] },
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
  // Alpha-carrying hex (#rgba or #rrggbbaa) → show the opacity slider so the alpha byte is editable.
  // rgba()/hsla() tokens still fall to a text b-input (b-color-picker is hex-based) — tracked follow-up.
  if (colorish && /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(current)) input.setAttribute('alpha', '');
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
    /* The ribbon's unpinned panel is an absolutely-positioned flyout that deliberately escapes the
       ribbon's own box. In an overflow:auto stage that makes the stage scrollable, and the resulting
       vertical scrollbar steals ~15px of width from the ribbon every time the panel opens -- so
       hovering the tabs jittered the ribbon's width. Real app shells host a ribbon at the top of the
       page, not in a scrolling card, so the stage is what is unrealistic here. (b-ribbon is also
       hardened against a jittering container -- see STORY-049/TASK-097 -- but the demo should not be
       creating the jitter in the first place.) */
    .pg-stage:has(> b-ribbon) { overflow:visible; }
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
