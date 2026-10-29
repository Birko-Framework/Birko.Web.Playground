// Birko.Web Playground — component gallery + live design-token editor + theme-CSS export.
// Import the barrel AS A NAMESPACE and reference it so the bundler can't tree-shake away the
// category modules — every `b-*` custom element registers via its module's customElements.define()
// side effect, and touching the namespace forces all those modules to be included.
import * as BirkoWebComponents from 'birko-web-components';
void Object.keys(BirkoWebComponents).length;

// EPIC-002 backport smoke — the Birko.Web backports' regression harness. Gated to verify.mjs (which
// loads /?smoke=1) so the interactive gallery console stays clean; the regression gate is preserved.
// TASK-545 — fixtures keyboard-check.mjs drives with trusted input (the toast manager, an undo-mode list page).
if (new URLSearchParams(location.search).has('kb')) void import('./undo-delete-kb.js');

if (new URLSearchParams(location.search).has('smoke')) {
  // `?smoke=1&only=a-smoke,b-smoke` runs just those suites, to tell a suite's own flake from one another suite causes
  // (TASK-745). Without `only`, every suite runs, as verify.mjs needs.
  const only = new URLSearchParams(location.search).get('only')?.split(',').filter(Boolean);
  // The suites started, for one that must run alone after the others (i18n-chain-smoke, TASK-750).
  const started: string[] = [];
  (window as unknown as { __smokeSuites: string[] }).__smokeSuites = started;
  const runs = (name: string) => { const on = !only || only.includes(name); if (on) started.push(name); return on; };
  if (runs('backport-smoke')) void import('./backport-smoke.js');
  // STORY-001 / TASK-001 — `bare` attribute on the form controls.
  if (runs('bare-smoke')) void import('./bare-smoke.js');
  // TASK-499 — `b-table` header escaping: a plain `label` stays escaped, `headerRender` is the
  // HTML opt-in, and `b-data-table`'s select-all checkbox renders and works.
  if (runs('table-header-smoke')) void import('./table-header-smoke.js');
  // `b-select` `creatable`, standalone and through a b-form schema.
  if (runs('select-creatable-smoke')) void import('./select-creatable-smoke.js');
  // TASK-489 — `b-select` searchable mode as an ARIA combobox: roles, arrow keys, focus.
  if (runs('select-combobox-smoke')) void import('./select-combobox-smoke.js');
  // TASK-490 — a creatable b-multi-select commits unless a `create` listener vetoes it.
  if (runs('multi-select-create-smoke')) void import('./multi-select-create-smoke.js');
  // TASK-497 — every b-range thumb sits on its track (range mode hung below it).
  if (runs('range-geometry-smoke')) void import('./range-geometry-smoke.js');
  // TASK-496 — picker triggers announce their popup; the popup is keyboard-usable.
  if (runs('picker-popup-smoke')) void import('./picker-popup-smoke.js');
  // TASK-484 — b-input prefix / suffix slots and clearable: geometry at every size, clear semantics.
  if (runs('input-adornment-smoke')) void import('./input-adornment-smoke.js');
  // TASK-548 — b-qty-stepper: exact steps, snap on commit, keyboard, form association.
  if (runs('qty-stepper-smoke')) void import('./qty-stepper-smoke.js');
  // TASK-549 — b-carousel: controls, inert slides, swipe/drag, per-view from CSS, autoplay rules.
  if (runs('carousel-smoke')) void import('./carousel-smoke.js');
  // TASK-550 — b-gallery: thumbnails, index start vs leash, zoom dialog and focus return, narrow dots.
  if (runs('gallery-smoke')) void import('./gallery-smoke.js');
  // TASK-551 — {placeholders} filled in one pass, by one function, on every i18n path.
  if (runs('i18n-interpolate-smoke')) void import('./i18n-interpolate-smoke.js');
  // TASK-750 — I18n fallback chains (cs → sk → en), and no change without them.
  if (runs('i18n-chain-smoke')) void import('./i18n-chain-smoke.js');
  // TASK-547 — SseClient: one retry loop, a growing delay schedule and the _failing signal.
  if (runs('sse-retry-smoke')) void import('./sse-retry-smoke.js');
  // TASK-582 — BasePage renders a page's tour ? beside the title, named, wired once.
  if (runs('page-tour-smoke')) void import('./page-tour-smoke.js');
  // TASK-579 — b-rating: names, form association, read-only, Home/End, contrast in every theme.
  if (runs('rating-smoke')) void import('./rating-smoke.js');
  // TASK-545 — b-toast action (Undo) and base-crud-page's deleteMode 'undo' with its required restore.
  if (runs('undo-delete-smoke')) void import('./undo-delete-smoke.js');
  // TASK-597 — a toast's message and icon are text: markup in them is shown, never parsed or run.
  if (runs('toast-escape-smoke')) void import('./toast-escape-smoke.js');
  // TASK-581 — SyncManager backoff, retry cap, dead state, per-entity ordering, retry/discard.
  if (runs('sync-retry-smoke')) void import('./sync-retry-smoke.js');
  // TASK-583 — BaseListPage liveRefresh: debounced reload on entity-changed, deferred under the modal.
  if (runs('live-refresh-smoke')) void import('./live-refresh-smoke.js');
  // TASK-523 — WsClient.request: id correlation, error replies, timeout, close/disconnect rejection.
  if (runs('ws-request-smoke')) void import('./ws-request-smoke.js');
  // TASK-526 — RuntimeConfig: defaults < server < local, declared keys/types only, secrets never stored.
  if (runs('runtime-config-smoke')) void import('./runtime-config-smoke.js');
  // TASK-552 — b-editable-table shows its data after setData() and a row removal, typed cells included.
  if (runs('editable-table-sync-smoke')) void import('./editable-table-sync-smoke.js');
  // TASK-580 — b-modal's title is a heading (h2 or heading-level), labels the dialog, and is text.
  if (runs('modal-title-smoke')) void import('./modal-title-smoke.js');
  // TASK-598 — SyncManager recovers a write a closed tab left `syncing`, and one tab drains at a time.
  if (runs('sync-interrupt-smoke')) void import('./sync-interrupt-smoke.js');
  // TASK-524 — OAuth redirect sign-in: auth fragment, JWT expiry, scheduled and 401 refresh, the clients' token.
  if (runs('auth-session-smoke')) void import('./auth-session-smoke.js');
  // TASK-525 — b-tabs reorder, b-split-panel resize with persisted sizes, captureLayout / applyLayout.
  if (runs('layout-persist-smoke')) void import('./layout-persist-smoke.js');
  // TASK-725 — diffJson (paths, ignore, normalize, array matching) and b-json-diff (tree, only changes, side by side).
  if (runs('json-diff-smoke')) void import('./json-diff-smoke.js');
  // TASK-725 follow-up — a component's .sr-only text scrolls with the page's scroll container, never stretches the document.
  if (runs('sr-only-contain-smoke')) void import('./sr-only-contain-smoke.js');
  // TASK-727 — xmlToTree / xmlToLines and b-json-diff format="xml" (original XML in the side-by-side view).
  if (runs('xml-diff-smoke')) void import('./xml-diff-smoke.js');
  // Birko TASK-769 — the shared diff vectors (also run by the C# port in Birko.Xaml.Core) against the web engine.
  if (runs('diff-vectors-smoke')) void import('./diff-vectors-smoke.js');
  // STORY-023 / TASK-035 — ElementInternals form association.
  if (runs('form-assoc-smoke')) void import('./form-assoc-smoke.js');
  // EPIC-001 — the `description` help-text row.
  if (runs('description-smoke')) void import('./description-smoke.js');
  // STORY-002 / TASK-002 — the raw-vs-bare grid benchmark that gates the b-editable-table migration.
  if (runs('grid-bench-smoke')) void import('./grid-bench-smoke.js');
  // STORY-049 / TASK-097 — the ribbon's overflow affordance (tab strip + panel, incl. resize-only).
  if (runs('ribbon-overflow-smoke')) void import('./ribbon-overflow-smoke.js');
  // STORY-049 / TASK-099 — the scaling policy (parity with the C# original) and the rendered variants.
  if (runs('ribbon-scaling-smoke')) void import('./ribbon-scaling-smoke.js');
  // TASK-730 — b-ribbon groups are one height, rows line up across groups, labels sit under their group.
  if (runs('ribbon-layout-smoke')) void import('./ribbon-layout-smoke.js');
  // TASK-732 — b-ribbon split and menu buttons: parts, ARIA, events with parentId, text labels, large, folded, mobile.
  if (runs('ribbon-menu-smoke')) void import('./ribbon-menu-smoke.js');
  // TASK-738 — b-tooltip light theme and structured text; b-ribbon commands described, no native title.
  if (runs('tooltip-theme-smoke')) void import('./tooltip-theme-smoke.js');
  // TASK-744 — the base pages' empty-filter state is renderEmptyFilter(): default markup unchanged, overridable.
  if (runs('empty-filter-smoke')) void import('./empty-filter-smoke.js');
  // TASK-739 — b-ribbon toggle buttons and one-of sets: ARIA, clicks, setPressed, re-render, mobile.
  if (runs('ribbon-toggle-smoke')) void import('./ribbon-toggle-smoke.js');
  // TASK-734 — b-ribbon contextual tabs: shown sets, band / pill / edge, colours, hide returns to the previous tab.
  if (runs('ribbon-contextual-smoke')) void import('./ribbon-contextual-smoke.js');
  // TASK-747 — every size in b-ribbon's stylesheet is a design token.
  if (runs('ribbon-tokens-smoke')) void import('./ribbon-tokens-smoke.js');
  // STORY-052 / TASK-137 — control-side validation messages resolve through i18n. Registers global
  // translations, so it serialises itself after backport-smoke (which asserts them in English).
  if (runs('i18n-message-smoke')) void import('./i18n-message-smoke.js');
  // EPIC-001 / TASK-568 — b-modal starts on its slotted content and never cancels Tab. Opens a modal, so it
  // serialises itself after the suites a modal would disturb.
  if (runs('modal-focus-smoke')) void import('./modal-focus-smoke.js');
}

// ── BMobileAppShell demo (EPIC-016 / TASK-049) ───────────────────────────────
// BMobileAppShell is abstract (needs surfaces + brand/user/t/onSignOut), so the playground
// supplies a tiny concrete subclass — a consumer, not framework code — registered as
// <pg-mobile-shell> and shown phone-framed in the Navigation section.
import { BMobileAppShell, BasePage, type Surface } from 'birko-web-shell';
import { tour, type TourStep } from 'birko-web-components/layout';
import { createWakeLockManager, createAudioCue, registerServiceWorker, getI18n } from 'birko-web-core';
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

/**
 * The service-worker URL, resolved from the bundle's own location rather than the web root.
 *
 * `import.meta.url` is this module's URL, so `new URL('sw.js', …)` lands beside it however the app is
 * served — the web root locally, `/Birko.Web.Playground/` on the project GitHub Page. A literal
 * '/sw.js' 404s there, and a page-relative 'sw.js' would resolve against the current route rather
 * than the app root, so neither is safe.
 */
function swUrl(): string {
  return new URL('sw.js', import.meta.url).href;
}

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
    on('sw-on', () => { void registerServiceWorker(swUrl()).then((reg) => say(reg ? 'SW registered — see DevTools → Application; go Offline + reload' : 'SW registration failed / unsupported')); });
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
             3.77:1 in finstat (theme-token limit, shared with the label). (Same control as the one in the
             header — it sets <code>data-theme</code> on &lt;html&gt;, so it re-themes the whole gallery.)</p>
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

    // Theme switcher for case 4 — the same control the header carries, bound through the one setter so
    // the two stay in step whichever you use.
    bindThemeSwitcher(this.querySelector<Seg>('#pgd-theme'));

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

// ── Page tour button (TASK-582) ──────────────────────────────────────────────
// BasePage renders a page's tour `?` beside its title. Two real pages side by side, one with no header action and
// one with a Create button, so the placement can be judged on both (TASK-582's human test plan).
const PG_TOUR_STEPS: TourStep[] = [
  { title: 'Page tour', body: 'This tour was started from the ? beside the page title.' },
  { title: 'Replays', body: 'Close it and press ? again: it starts over every time.' },
];
class PgTourReadOnly extends BasePage {
  protected get pageTitle() { return 'Orders'; }
  protected tourSteps() { return PG_TOUR_STEPS; }
  protected get tourId() { return 'pg-tour-read-only'; }
  protected renderContent() { return '<p>Read-only: no header actions.</p>'; }
}
class PgTourWithCreate extends BasePage {
  protected get pageTitle() { return 'Products'; }
  protected tourSteps() { return PG_TOUR_STEPS; }
  protected get tourId() { return 'pg-tour-with-create'; }
  protected renderHeaderActions() { return '<b-button variant="primary" size="sm">New product</b-button>'; }
  protected renderContent() { return '<p>With a Create action.</p>'; }
}
if (!customElements.get('pg-tour-read-only')) customElements.define('pg-tour-read-only', PgTourReadOnly);
if (!customElements.get('pg-tour-with-create')) customElements.define('pg-tour-with-create', PgTourWithCreate);
class PgPageTour extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    const frame = 'flex:1 1 16rem;min-width:0;border:var(--b-border-width,1px) solid var(--b-border);'
      + 'border-radius:var(--b-radius,.375rem);padding:var(--b-space-md,.75rem)';
    this.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:var(--b-space-md,.75rem)">
      <pg-tour-read-only style="${frame}"></pg-tour-read-only>
      <pg-tour-with-create style="${frame}"></pg-tour-with-create></div>`;
  }
}
if (!customElements.get('pg-page-tour')) customElements.define('pg-page-tour', PgPageTour);



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
  /**
   * `lab` is not a component category: it holds the harnesses that exist to verify Birko.Web (a benchmark, device
   * probes, a wiring check), kept out of the gallery a first-time visitor reads and shown under the ribbon's Lab tab.
   */
  category: 'inputs' | 'layout' | 'data' | 'feedback' | 'nav' | 'command' | 'lab';
  /** One sentence under the card title: what it is and what it is for. `ABOUT` supplies it when unset. */
  about?: string;
  render?: () => string;            // inner markup for one instance
  attrs?: Record<string, string>;   // static attributes applied to the instance
  controls?: ControlDef[];          // live attribute toggles
  setup?: (el: any) => void;        // populate via JS data methods (setData/setItems/…); deferred + guarded
  note?: string;                    // shown when the component needs runtime config to populate
  launch?: { label: string; run: (el: any) => void }; // overlay opener (modal/drawer/dialog show themselves on demand)
  /**
   * Give this component the full row instead of one ~400px grid cell.
   *
   * For a ribbon, a data table or a kanban board the width IS the component: squeezed into a
   * quarter-width card a ribbon spends the whole time in its most-degraded state, so the gallery
   * shows the fallback and never the thing itself. Reviewing "does this look right?" against that
   * is reviewing the wrong artefact.
   *
   * Used sparingly — every wide card pushes the rest of the catalogue further down the page.
   */
  wide?: boolean;
}

const SIZE: ControlDef = { label: 'size', attr: 'size', options: ['', 'sm', 'lg'] };
const VARIANT: ControlDef = { label: 'variant', attr: 'variant', options: ['primary', 'secondary', 'danger', 'ghost'] };
const STATUS: ControlDef = { label: 'variant', attr: 'variant', options: ['', 'success', 'warning', 'danger', 'info'] };
const DISABLED: ControlDef = { label: 'disabled', attr: 'disabled', options: ['', 'disabled'] };
// STORY-001/TASK-001 — flip the stacked .field chrome off to review the inline (toolbar / table-cell) form.
const BARE: ControlDef = { label: 'bare', attr: 'bare', options: ['', 'bare'] };
// TASK-550 — opt-in: a click on the empty space around the zoomed image closes it.
const ZOOM_CLOSE_OUTSIDE: ControlDef = { label: 'zoom-close-outside', attr: 'zoom-close-outside', options: ['', 'zoom-close-outside'] };
const PROGRESS_TYPE: ControlDef = { label: 'type', attr: 'type', options: ['linear', 'circular'] };
// Overlay width ladder — flip before hitting the launch button. b-modal adds `full`
// (viewport minus --b-modal-full-inset, both axes) for editor surfaces; b-drawer has no `full`.
const OVERLAY_SIZE: ControlDef = { label: 'size', attr: 'size', options: ['', 'sm', 'lg', 'xl', 'xxl'] };
const MODAL_SIZE: ControlDef = { label: 'size', attr: 'size', options: ['', 'sm', 'lg', 'xl', 'xxl', 'full'] };
// b-tag has no `variant` — its real knobs are `color` (the leading dot), `size` and `removable`.
const TAG_COLOR: ControlDef = { label: 'color', attr: 'color', options: ['', '#25ba7a', '#0091ff', '#f5a623', '#e5484d', '#8e4ec6'] };
const REMOVABLE: ControlDef = { label: 'removable', attr: 'removable', options: ['', 'removable'] };
const CLEARABLE: ControlDef = { label: 'clearable', attr: 'clearable', options: ['', 'clearable'] }; // TASK-484
const RATING_MAX: ControlDef = { label: 'max', attr: 'max', options: ['5', '3', '7', '10'] }; // b-rating; 5 is its default

// Full catalogue (kept in sync with Birko.Web.Components). reportMissing() warns about any
// tag here that didn't register; a registered component absent from this list is a gap to fill.
const CATALOGUE: ComponentDef[] = [
  // ── inputs ──
  { tag: 'b-button', label: 'Button', category: 'inputs', render: () => 'Click me', controls: [VARIANT, SIZE, DISABLED] },
  { tag: 'b-checkbox', label: 'Checkbox', category: 'inputs', render: () => 'Accept terms', controls: [DISABLED] },
  { tag: 'b-radio', label: 'Radio', category: 'inputs', render: () => 'Option A', attrs: { name: 'demo-radio', value: 'a' }, controls: [DISABLED] },
  { tag: 'b-switch', label: 'Switch', category: 'inputs', render: () => 'Enabled', controls: [DISABLED] },
  { tag: 'b-input', label: 'Input', category: 'inputs', attrs: { label: 'Name', placeholder: 'Type here…', description: 'Shown as-is under the control (the `description` attribute)' }, controls: [SIZE, DISABLED, BARE, CLEARABLE] },
  { tag: 'b-textarea', label: 'Textarea', category: 'inputs', attrs: { label: 'Notes', placeholder: 'Multi-line…' }, controls: [DISABLED, BARE] },
  { tag: 'b-search-input', label: 'Search input', category: 'inputs', attrs: { placeholder: 'Search…' }, controls: [SIZE] },
  { tag: 'b-select', label: 'Select', category: 'inputs', attrs: { label: 'Pick one', placeholder: 'Choose…' }, render: () => '<option value="1">One</option><option value="2">Two</option><option value="3">Three</option>', controls: [SIZE, BARE] },
  { tag: 'b-multi-select', label: 'Multi-select', category: 'inputs', attrs: { label: 'Pick many' }, controls: [BARE], setup: (el) => el.setOptions([{ value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }]) },
  { tag: 'b-color-picker', label: 'Color picker', category: 'inputs', attrs: { value: '#25ba7acc', label: 'Brand color', alpha: '' } },
  { tag: 'b-range', label: 'Range', category: 'inputs', attrs: { min: '0', max: '100', value: '60' },
    controls: [{ label: 'orientation', attr: 'orientation', options: ['horizontal', 'vertical'] }] },
  { tag: 'pg-description', label: 'Help text — the `description` row', category: 'lab',
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
  { tag: 'b-qty-stepper', label: 'Quantity stepper', category: 'inputs', attrs: { label: 'Fabric', name: 'qty', min: '0.5', step: '0.5', max: '10', value: '1.5', unit: 'm' },
    note: 'Decimal step anchored at min; typed text snaps on blur / Enter; arrow keys, PageUp/PageDown, Home/End (TASK-548).' },
  // TASK-579 — whole-star rating: native radios behind the stars; readonly is an image with no tab stop.
  { tag: 'b-rating', label: 'Rating', category: 'inputs', attrs: { label: 'Your rating', name: 'stars', value: '3' }, controls: [RATING_MAX, SIZE, DISABLED] },
  // TASK-592 — the same input with a consumer's icon in the `icon` slot; the component still paints it.
  { tag: 'b-rating', label: 'Rating — custom icon (heart)', category: 'inputs', attrs: { label: 'How much do you like it?', name: 'hearts', value: '4' }, controls: [RATING_MAX, SIZE, DISABLED],
    render: () => '<svg slot="icon" viewBox="0 0 24 24"><path d="M12 21s-7-4.4-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.6-9.5 9-9.5 9z"/></svg>' },
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
  { tag: 'b-carousel', label: 'Carousel', category: 'layout', attrs: { label: 'Featured', loop: '' },
    render: () => '<div style="display:grid;place-items:center;height:8rem;border-radius:var(--b-radius);background:var(--b-bg-tertiary);color:var(--b-text)">Slide 1</div><div style="display:grid;place-items:center;height:8rem;border-radius:var(--b-radius);background:var(--b-color-primary-light, var(--b-bg-tertiary));color:var(--b-text)">Slide 2</div><div style="display:grid;place-items:center;height:8rem;border-radius:var(--b-radius);background:var(--b-bg-secondary);color:var(--b-text)">Slide 3</div><div style="display:grid;place-items:center;height:8rem;border-radius:var(--b-radius);background:var(--b-bg-tertiary);color:var(--b-text)">Slide 4</div><div style="display:grid;place-items:center;height:8rem;border-radius:var(--b-radius);background:var(--b-bg-secondary);color:var(--b-text)">Slide 5</div>',
    note: 'Slotted light-DOM slides; arrows, dots, swipe and mouse drag; off-screen slides inert. Add per-view="2" or set --b-carousel-per-view in CSS; autoplay="5000" adds a stop/start control and never runs under reduced motion (TASK-549).' },
  { tag: 'b-gallery', label: 'Gallery', category: 'layout', attrs: { label: 'Product images' }, controls: [ZOOM_CLOSE_OUTSIDE],
    render: () => '<img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22600%22%20height%3D%22600%22%3E%3Crect%20width%3D%22600%22%20height%3D%22600%22%20fill%3D%22%23f4d9c6%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22100%22%20font-size%3D%2272%22%20font-family%3D%22sans-serif%22%3ENatural%3C/text%3E%3C/svg%3E" alt="Linen, natural"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22600%22%20height%3D%22600%22%3E%3Crect%20width%3D%22600%22%20height%3D%22600%22%20fill%3D%22%23c6d9f4%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22100%22%20font-size%3D%2272%22%20font-family%3D%22sans-serif%22%3EBlue%3C/text%3E%3C/svg%3E" alt="Linen, blue"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22600%22%20height%3D%22600%22%3E%3Crect%20width%3D%22600%22%20height%3D%22600%22%20fill%3D%22%23c6f4d9%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22100%22%20font-size%3D%2272%22%20font-family%3D%22sans-serif%22%3ESage%3C/text%3E%3C/svg%3E" alt="Linen, sage"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22600%22%20height%3D%22600%22%3E%3Crect%20width%3D%22600%22%20height%3D%22600%22%20fill%3D%22%23e0e0e0%22/%3E%3Ctext%20x%3D%2240%22%20y%3D%22100%22%20font-size%3D%2272%22%20font-family%3D%22sans-serif%22%3EGrey%3C/text%3E%3C/svg%3E" alt="Linen, grey">',
    note: 'Slotted <img> (data-thumb / data-full optional); thumbnails become dots in a narrow container; click the image or the corner button to zoom (Escape closes); show(i) switches image for a variant (TASK-550).' },
  { tag: 'b-card', label: 'Card', category: 'layout', render: () => '<span slot="header">Card title</span><p>Card body content.</p>' },
  { tag: 'b-accordion', label: 'Accordion', category: 'layout',
    render: () => '<div slot="a1">First section body.</div><div slot="a2">Second section body.</div><div slot="a3">Disabled section body.</div>',
    setup: (el) => el.setItems([{ id: 'a1', header: 'Section one', open: true }, { id: 'a2', header: 'Section two' }, { id: 'a3', header: 'Section three (disabled)', disabled: true }]) },
  { tag: 'b-toolbar', label: 'Toolbar', category: 'layout', render: () => '<b-button-group><b-button>A</b-button><b-button>B</b-button></b-button-group>' },
  { tag: 'b-split-panel', label: 'Split panel', category: 'layout', wide: true, render: () => '<div slot="master" style="padding:.75rem;min-height:140px;background:var(--b-bg-secondary)">Master pane</div><div slot="detail" style="padding:.75rem;min-height:140px">Detail pane</div>' },
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
  { tag: 'b-chat', label: 'Chat', category: 'layout', wide: true, setup: (el) => el.setMessages([{ id: '1', role: 'assistant', content: 'Hi! How can I help?' }, { id: '2', role: 'user', content: 'Show me the gallery.' }]) },
  { tag: 'b-tour', label: 'Tour', category: 'layout',
    launch: { label: 'Start tour', run: (el) => el.run([
      { target: '.pg-header .pg-brand', title: 'Welcome', body: 'This is the Birko.Web playground.', placement: 'bottom' },
      { target: '#pg-ribbon', title: 'Sections', body: 'Switch component categories, themes and tokens on the ribbon.', placement: 'bottom' },
      { title: 'Design tokens', body: 'Appearance → Design tokens edits the --b-* set live.' },
    ], () => { /* done: nothing to remember for a demo */ }) } }, // the element's run(); start() is the `tour` manager's

  { tag: 'pg-page-tour', label: 'Page tour button (BasePage)', category: 'lab', wide: true,
    note: 'TASK-582: a Birko.Web.Shell page that returns tourSteps() gets a ? beside its title, with or without header actions. Press it to start the tour; it replays every time.' },

  // ── data ──
  { tag: 'pg-grid-bench', label: 'Grid benchmark — raw vs bare cells', category: 'lab',
    note: 'STORY-002/TASK-002: the benchmark that gates migrating b-editable-table cells onto <b-input bare size=\"sm\">. Button-driven (allocates 3000 cells). Measures build, re-render, 50-keystroke edit latency, caret survival and node/shadow-root count for both variants.' },
  { tag: 'b-badge', label: 'Badge', category: 'data', render: () => 'New', controls: [STATUS] },
  { tag: 'b-tag', label: 'Tag', category: 'data', render: () => 'tag', controls: [TAG_COLOR, SIZE, REMOVABLE] },
  { tag: 'b-stat', label: 'Stat', category: 'data', attrs: { label: 'Revenue', value: '$12.4k', delta: '+8%', trend: 'up', sentiment: 'positive' } },
  { tag: 'b-pagination', label: 'Pagination', category: 'data', attrs: { page: '2', 'total-pages': '10', 'total-count': '195', 'page-size': '20' } },
  { tag: 'b-pre', label: 'Pre', category: 'data', render: () => 'preformatted\n  text block' },
  { tag: 'b-code-block', label: 'Code block', category: 'data', attrs: { language: 'js' }, render: () => 'const x = 42;\nconsole.log(x);' },
  { tag: 'b-definition-list', label: 'Definition list', category: 'data', render: () => '<dt>Term</dt><dd>A definition</dd><dt>Another</dt><dd>Its value</dd>' },
  { tag: 'b-json-viewer', label: 'JSON viewer', category: 'data', render: () => '{ "name": "birko", "version": 1, "ok": true }' },
  { tag: 'b-json-diff', label: 'JSON diff', category: 'data', wide: true, attrs: { 'label-a': 'production', 'label-b': 'localhost' }, setup: (el) => {
    el.setOptions({ ignore: ['**.Url'], arrays: [{ path: 'Items', key: 'Id' }] });
    el.setData({ Name: 'Birko', Version: 1, Url: 'https://a', Items: [{ Id: 1, Price: 10 }, { Id: 2, Price: 20 }], Legacy: true },
      { Name: 'Birko', Version: 2, Url: 'https://b', Items: [{ Id: 2, Price: 20 }, { Id: 1, Price: 12 }, { Id: 3, Price: 5 }], Tags: ['new'] });
  } },
  { tag: 'b-xml-viewer', label: 'XML viewer', category: 'data', setup: (el) => el.setSource('<root><item id="1">hello</item><item id="2">world</item></root>') },
  { tag: 'b-table', label: 'Table', category: 'data', wide: true, setup: (el) => { el.setColumns([{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'city', label: 'City' }]); el.setData([{ name: 'Ada', role: 'Admin', city: 'London' }, { name: 'Linus', role: 'User', city: 'Helsinki' }, { name: 'Grace', role: 'User', city: 'New York' }]); } },
  { tag: 'b-data-table', label: 'Data table', category: 'data', wide: true, setup: (el) => {
    // b-data-table is endpoint-driven; a duck-typed in-memory apiClient feeds it static rows.
    const rows = [{ name: 'Ada', role: 'Admin' }, { name: 'Linus', role: 'User' }, { name: 'Grace', role: 'User' }];
    const apiClient = { get: async () => ({ ok: true, status: 200, data: rows, headers: new Headers() }) };
    el.setConfig({ endpoint: '/demo', apiClient, columns: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }] });
    el.load(); // setConfig configures but doesn't fetch; load() pulls the first page
  } },
  { tag: 'b-editable-table', label: 'Editable table', category: 'data', wide: true, setup: (el) => { el.setConfig({ columns: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }] }); el.setData([{ name: 'Widget', qty: 3 }, { name: 'Gadget', qty: 7 }]); } },
  { tag: 'b-chart', label: 'Chart', category: 'data', attrs: { type: 'bar', height: '220' },
    controls: [{ label: 'type', attr: 'type', options: ['bar', 'line', 'area', 'pie', 'donut', 'gauge'] }],
    setup: (el) => el.setData({ labels: ['Jan', 'Feb', 'Mar', 'Apr'], series: [{ id: 'sales', label: 'Sales', data: [{ y: 65 }, { y: 40 }, { y: 80 }, { y: 55 }] }] }) },
  { tag: 'b-kanban', label: 'Kanban', category: 'data', wide: true, setup: (el) => el.setConfig({ columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress' }, { id: 'done', label: 'Done' }], cards: [{ id: '1', columnId: 'todo', title: 'Task A' }, { id: '2', columnId: 'doing', title: 'Task B' }, { id: '3', columnId: 'done', title: 'Task C' }] }) },
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
  { tag: 'pg-device-demo', label: 'Device utils (wake lock / audio cue / SW)', category: 'lab',
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
  { tag: 'b-ribbon', label: 'Ribbon', category: 'nav', wide: true, attrs: { expanded: '', pinned: '', 'qat-key': 'playground' }, setup: (el) => { el.setTabs([
    { id: 'home', label: 'Home', groups: [
      // Priorities set deliberately so the degrade ORDER is visible while resizing: a LOWER
      // scalingPriority gives way first, so Export collapses long before Clipboard is touched. Clipboard
      // is floored at 'small' so it never folds into a flyout however narrow it gets — the hero group
      // stays directly clickable. Mirrors the Avalonia gallery's demo, for side-by-side review, except Paste's split
      // menu and CSV's menu (TASK-732): the Avalonia ribbon has no menus yet (TASK-742).
      { id: 'clip', label: 'Clipboard', icon: '📋', scalingPriority: 100, minSize: 'small', items: [{ id: 'paste', label: 'Paste', icon: '📋', description: 'Add content from the clipboard.', shortcut: 'Ctrl+V', split: true, menu: [{ id: 'paste-text', label: 'Paste as text', icon: '📝', shortcut: 'Ctrl+Shift+V' }, { id: 'paste-picture', label: 'Paste as picture', icon: '🖼' }, { separator: true }, { id: 'paste-special', label: 'Paste special…', shortcut: 'Ctrl+Alt+V' }] }, { id: 'cut', label: 'Cut', icon: '✂️', description: 'Remove the selection and put it on the clipboard.', shortcut: 'Ctrl+X' }, { id: 'copy', label: 'Copy', icon: '📄', description: 'Put a copy of the selection on the clipboard.', shortcut: 'Ctrl+C' }] },
      { id: 'records', label: 'Records', icon: '🗃', scalingPriority: 80, items: [{ id: 'new', label: 'New', icon: '➕' }, { id: 'del', label: 'Delete', icon: '🗑' }, { id: 'dup', label: 'Duplicate', icon: '⧉' }] },
      { id: 'font', label: 'Font', icon: '🅰', scalingPriority: 60, launcher: true, items: [{ id: 'font-name', label: 'Font', description: 'Pick a font, or type its name.', field: { type: 'select', freeText: true, width: 12, value: 'Calibri', options: ['Calibri', 'Arial', 'Georgia', 'Segoe UI', 'Times New Roman', 'Verdana'].map((f) => ({ value: f, label: f })) } }, { id: 'font-size', label: 'Font size', field: { type: 'select', freeText: true, width: 3, value: '11', options: ['8', '9', '10', '11', '12', '14', '16', '18', '24', '36'].map((v) => ({ value: v, label: v })) } }, { id: 'bold', label: 'Bold', icon: '𝐁', description: 'Make the selected text bold.', shortcut: 'Ctrl+B', toggle: true, pressed: true }, { id: 'italic', label: 'Italic', icon: '𝑰', toggle: true }, { id: 'colour', label: 'Colour', icon: '🎨' }] },
      { id: 'size', label: 'Size', icon: '⇲', scalingPriority: 50, items: [{ id: 'height', label: 'Height', field: { type: 'number', value: '2.5', min: 0, step: 0.1, width: 4 } }, { id: 'width', label: 'Width', field: { type: 'number', value: '4.0', min: 0, step: 0.1, width: 4 } }] },
      { id: 'layout', label: 'Layout', icon: '▥', scalingPriority: 40, items: [{ id: 'cols', label: 'Columns', icon: '▥', toggleGroup: 'orient', pressed: true }, { id: 'rows', label: 'Rows', icon: '▤', toggleGroup: 'orient' }] },
      { id: 'styles', label: 'Styles', icon: '🅂', scalingPriority: 30, items: [{ id: 'style-gallery', label: 'Styles', gallery: { selected: 'normal', visible: 4, items: [
        { id: 'normal', label: 'Normal', preview: 'Aa' }, { id: 'nospace', label: 'No spacing', preview: 'Aa' }, { id: 'h1', label: 'Heading 1', preview: 'H1' },
        { id: 'h2', label: 'Heading 2', preview: 'H2' }, { id: 'title', label: 'Title', preview: 'T' }, { id: 'subtitle', label: 'Subtitle', preview: 'S' },
        { id: 'quote', label: 'Quote', preview: '“”' }, { id: 'list', label: 'List', preview: '•' }] } }] },
      { id: 'review', label: 'Review', icon: '💬', scalingPriority: 20, items: [{ id: 'comment', label: 'Comment', icon: '💬' }, { id: 'track', label: 'Track', icon: '✓' }] },
      { id: 'export', label: 'Export', icon: '📤', scalingPriority: 0, items: [{ id: 'pdf', label: 'PDF', icon: '📄' }, { id: 'csv', label: 'CSV', icon: '📊', menu: [{ id: 'csv-comma', label: 'Comma separated' }, { id: 'csv-semicolon', label: 'Semicolon separated' }, { id: 'csv-utf8', label: 'UTF-8 with BOM', disabled: true }] }, { id: 'print', label: 'Print', icon: '🖨' }] },
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
    { id: 'table-design', label: 'Table Design', contextualSet: 'table', groups: [
      { id: 'tstyle', label: 'Table style', items: [{ id: 'header-row', label: 'Header row', icon: '▦', toggle: true, pressed: true }, { id: 'banded', label: 'Banded rows', icon: '▤', toggle: true }] },
    ] },
    { id: 'table-layout', label: 'Layout', contextualSet: 'table', groups: [
      { id: 'rowscols', label: 'Rows & columns', items: [{ id: 'ins-row', label: 'Insert row', icon: '➕' }, { id: 'del-row', label: 'Delete row', icon: '➖' }] },
    ] },
  ]); el.setContextualSets([{ id: 'table', label: 'Table', color: 'success' }]); el.showContextual('table'); el.setQuickAccess([{ id: 'save', label: 'Save', icon: '💾', shortcut: 'Ctrl+S' }, { id: 'undo', label: 'Undo', icon: '↶', shortcut: 'Ctrl+Z' }, { id: 'redo', label: 'Redo', icon: '↷', shortcut: 'Ctrl+Y' }]); } },

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
  inputs: 'Inputs', layout: 'Layout', data: 'Data', feedback: 'Feedback', nav: 'Navigation', command: 'Command', lab: 'Lab',
};

const CATEGORY_ICONS: Record<string, string> = {
  inputs: '⌨', layout: '▦', data: '▤', feedback: '◔', nav: '☰', command: '⌘', lab: '⚗',
};

// What each section is for — the ribbon shows it as the category command's tooltip.
const CATEGORY_ABOUT: Record<string, string> = {
  inputs: 'Form controls: every one is form-associated, labelled and keyboard-operable.',
  layout: 'Structure and overlays: cards, tabs, panels, modals, drawers and guided tours.',
  data: 'Showing data: tables, charts, JSON and XML viewers, a kanban board.',
  feedback: 'Telling the user what is happening: progress, empty and stale states, toasts, sync.',
  nav: 'Getting around an app: breadcrumbs, trees, a sidebar, a ribbon and a mobile shell.',
  command: 'The Ctrl+K command palette.',
  lab: 'Test harnesses used to verify Birko.Web — not components you ship.',
};

/**
 * The visible line under each card title, keyed by catalogue `label` (unique, unlike `tag`: b-rating appears twice).
 * Curated presentation copy, so it is written here rather than scraped; the ⓘ tooltip carries the reference half
 * (attributes, methods, events), generated from Birko.Web.Components' own README and API.md at build time.
 * `reportMissing()` warns about a catalogue entry without one.
 */
const ABOUT: Record<string, string> = {
  'Button': 'The standard action button, in four variants and three sizes; can submit its form.',
  'Checkbox': 'A form-associated on/off choice with a label.',
  'Radio': 'One choice out of a named group.',
  'Switch': 'An on/off toggle for settings that apply at once.',
  'Input': 'A labelled text field with help text, validation, adornments and a clear button.',
  'Textarea': 'A labelled multi-line text field.',
  'Search input': 'A search box that reports the query after a short pause in typing.',
  'Select': 'A dropdown with optional search and creatable values.',
  'Multi-select': 'Pick several values from a list, shown as removable chips.',
  'Color picker': 'Pick a colour, with optional alpha, as hex.',
  'Range': 'A slider for one value or a from–to range.',
  'Range — vertical (equalizer)': 'The same b-range turned vertical: a bank of sliders like an equalizer.',
  'Date picker': 'A calendar dropdown for a date, in the current locale.',
  'Datetime picker': 'A date and a time in one control.',
  'Date range': 'Pick a from–to date range on one calendar.',
  'Time': 'A time-only picker with hour and minute steppers.',
  'File upload': 'Pick or drop files, with type, size and count limits.',
  'Inline edit': 'Text that turns into a field when clicked and saves on Enter.',
  'Markdown editor': 'A split-view Markdown editor with a toolbar and live preview.',
  'Tag input': 'Type free-form tags; Enter adds one, duplicates are refused.',
  'Quantity stepper': 'A number with − / + steps that never drift (0.1 × 3 is exactly 0.3), with a unit.',
  'Rating': 'A star rating input; arrow keys move and pick.',
  'Rating — custom icon (heart)': 'The same rating with any icon in place of the star.',
  'Segmented': 'A row of connected buttons that picks one of 2–4 short options.',
  'Option group': 'A labelled single choice shown as a list of options.',
  'Form': 'A form built from a schema, with validation and error messages.',
  'Button group': 'Buttons joined into one cluster.',
  'Carousel': 'A row of slides with arrows, dots, swipe and optional auto-rotation.',
  'Gallery': 'Product images: one large, thumbnails, swipe and a zoom view.',
  'Card': 'A bordered surface with a header, body and footer.',
  'Accordion': 'Sections that expand and collapse.',
  'Toolbar': 'A horizontal bar that lays out button groups, with an end slot.',
  'Split panel': 'Master and detail side by side, resizable, collapsing on narrow screens.',
  'Tooltip': 'A short hint shown on hover or keyboard focus.',
  'Tabs': 'Switch between panels of content.',
  'Dropdown menu': 'A button that opens a menu of actions.',
  'Modal': 'A dialog over the page that keeps focus inside it until closed.',
  'Drawer': 'A panel that slides in from the edge.',
  'Confirm dialog': 'Ask "are you sure?" before a destructive action.',
  'Chat': 'A message list with a composer, for assistants, support and team chat.',
  'Tour': 'A step-by-step guided tour that spotlights parts of the page.',
  'Badge': 'A small status label.',
  'Tag': 'A label with an optional colour dot that can be removed.',
  'Stat': 'A KPI tile: caption, large value and a change chip.',
  'Pagination': 'Page through a long list, with the total count.',
  'Pre': 'A preformatted text block that scrolls when it is long.',
  'Code block': 'Highlighted code with a copy button and line numbers.',
  'Definition list': 'Term and description pairs in four layouts.',
  'JSON viewer': 'Read a JSON value as a tree you can expand, collapse and copy.',
  'JSON diff': 'Compare two JSON or XML bodies as a tree of changes or side by side.',
  'XML viewer': 'Read XML as a collapsible, coloured tree.',
  'Table': 'A client-side table with sorting, row clicks and row actions.',
  'Data table': 'A server-fed table with search, filters, paging, bulk actions and inline editing.',
  'Editable table': 'A table where every cell is an input, for data entry.',
  'Chart': 'Line, bar, area, pie, donut and scatter charts, drawn as SVG or canvas.',
  'Kanban': 'A board of columns with drag-and-drop cards and nested sub-tasks.',
  'Object tree': 'Any JavaScript value as an expandable property tree.',
  'Empty state': 'What to show when there is nothing to show, with an action.',
  'Progress': 'A determinate or indeterminate bar or ring.',
  'Spinner': 'An indeterminate loading indicator.',
  'Skeleton': 'Grey placeholder shapes while content loads.',
  'Stale banner': 'A warning that the data on screen came from the cache.',
  'Toast item': 'One notification toast, with an optional Undo action.',
  'Sync status': 'How many offline changes are still waiting to be sent.',
  'Dialogs (imperative helpers)': 'confirm, prompt, alert, choose, busy and notify as awaitable functions — no markup.',
  'Breadcrumb': 'Where you are, as a trail of links.',
  'Tree menu': 'A nested menu with expand, collapse and keyboard navigation.',
  'Sidebar': 'Side navigation that collapses to a narrow rail.',
  'Mobile app shell': 'A phone layout: top bar, content and bottom navigation, from birko-web-shell.',
  'Ribbon': 'An Office-style ribbon: tabs, groups, menus, toggles and a Quick Access Toolbar. The header above is one.',
  'Command palette': 'Ctrl+K search over commands from pluggable providers.',
  // ── lab ──
  'Help text — the `description` row': 'Checks the help-text row under inputs: announced, beside an error, wrapping, legible.',
  'Page tour button (BasePage)': 'Checks that a birko-web-shell page with tour steps shows a ? beside its title.',
  'Grid benchmark — raw vs bare cells': 'Times building and editing a large grid of raw versus bare inputs.',
  'Device utils (wake lock / audio cue / SW)': 'Probes the device helpers: screen wake lock, an audio cue and the service worker.',
};

function aboutOf(def: ComponentDef): string {
  return def.about ?? ABOUT[def.label] ?? '';
}

// ── Component reference (the ⓘ tooltip) ─────────────────────────────────────
// Generated by build.js from Birko.Web.Components/README.md and API.md, so it cannot drift from the library.
interface ComponentDoc { summary?: string; attributes?: string[]; methods?: string[]; events?: string[]; slots?: string }
import COMPONENT_DOCS from 'pg:component-docs';
const DOCS = COMPONENT_DOCS as Record<string, ComponentDoc>;

const API_URL = 'https://github.com/Birko-Framework/Birko.Web/blob/main/Birko.Web.Components/API.md';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// Up to `max` names, then "+N more" — a tooltip that lists 26 attributes is a page, not a hint.
function listOf(names: string[] | undefined, max = 8): string {
  if (!names?.length) return '';
  const shown = names.slice(0, max).map((n) => `<code>${escapeHtml(n)}</code>`).join(', ');
  return names.length > max ? `${shown} <em>+${names.length - max} more</em>` : shown;
}

/** Markup for a card's ⓘ tooltip, and the same facts as plain text for its aria-description. */
function infoFor(def: ComponentDef): { html: string; text: string } {
  const doc = def.tag.startsWith('b-') ? DOCS[def.tag] : undefined;
  const lead = aboutOf(def);
  const rows: [string, string][] = [];
  if (doc?.summary && doc.summary !== lead) rows.push(['From the docs', escapeHtml(doc.summary)]);
  if (doc?.attributes?.length) rows.push(['Attributes', listOf(doc.attributes)]);
  if (doc?.methods?.length) rows.push(['Methods', listOf(doc.methods)]);
  if (doc?.events?.length) rows.push(['Events', listOf(doc.events)]);
  if (doc?.slots) rows.push(['Slots', escapeHtml(doc.slots)]);
  // A pg-* entry is the playground's own markup: it has no API to list, and its `note` (shown on the card already) is
  // written for the library's maintainers.
  if (!doc) rows.push(['Source', 'built for this playground, in <code>src/app.ts</code>']);
  const html = `<strong>&lt;${escapeHtml(def.tag)}&gt;</strong><br>${escapeHtml(lead)}`
    + rows.map(([k, v]) => `<br><span class="pg-tip-k">${k}:</span> ${v}`).join('');
  const text = [lead, ...rows.map(([k, v]) => `${k}: ${v.replace(/<[^>]+>/g, '')}`)].join('. ');
  return { html, text };
}

// ── Theme switch ─────────────────────────────────────────────────────────────
// The shipped themes are linked in index.html and each activates on a `data-theme` value on <html>
// (base/light is the :root block in tokens.css, i.e. no override). ONE setter owns the attribute, so
// the header switcher, the description-card switcher and the token editor cannot disagree — everything
// else binds through `bindThemeSwitcher` / `onThemeChange` rather than reading or writing the DOM.
type Seg = HTMLElement & { setOptions(o: { value: string; label: string }[]): void; value: string };

const PG_THEMES: { value: string; label: string }[] = [
  { value: 'light', label: '☀ Light' },
  { value: 'dark', label: '☾ Dark' },
  { value: 'neon', label: '⚡ Neon' },
  { value: 'finstat', label: '◆ Finstat' },
  // Partial theme: surfaces/text only, brand colours inherit — shipped for SCOPED regions (dark header
  // on a light page), not really a page theme. Offered here anyway because checking contrast under it
  // is exactly what a gallery is for.
  { value: 'inverse', label: '◐ Inverse' },
];
const THEME_KEY = 'pg-theme'; // mirrors the shell's `{storagePrefix}-theme` convention

function activeTheme(): string {
  return document.documentElement.getAttribute('data-theme') ?? 'light';
}

function setTheme(id: string): void {
  if (activeTheme() === id) return;
  document.documentElement.setAttribute('data-theme', id);
  try { localStorage.setItem(THEME_KEY, id); } catch { /* storage disabled — the switch still works */ }
  document.dispatchEvent(new CustomEvent('pg-theme', { detail: { value: id } }));
}

function onThemeChange(fn: (id: string) => void): void {
  document.addEventListener('pg-theme', (e) => fn((e as CustomEvent<{ value: string }>).detail.value));
}

// Two-way bind for any b-segmented used as a theme switch. `.value` is a plain attribute setter (no
// `change` re-emit), so echoing the event back into the control cannot loop.
function bindThemeSwitcher(seg: Seg | null): void {
  if (!seg) return;
  seg.setOptions(PG_THEMES);
  seg.value = activeTheme();
  seg.addEventListener('change', (e) =>
    setTheme((e as CustomEvent<{ value?: string }>).detail?.value ?? 'light'));
  onThemeChange((id) => { if (seg.value !== id) seg.value = id; });
}

// ── App shell ────────────────────────────────────────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function renderApp(root: HTMLElement): void {
  root.innerHTML = `
    <!-- The header is a b-ribbon, dogfooded: the playground's own commands are the best live demo of it. Tabs are
         grouped by task (FEATURE decision 2026-10-28): Gallery picks a category, Appearance holds theme / locale /
         tokens / CSS export, Lab holds the test harnesses, Help the intro and the docs. Every command carries a
         description, which the ribbon shows as its tooltip. -->
    <header class="pg-header">
      <!-- collapse-shortcut / keytip-shortcut off: both are page-wide keys, and the Ribbon card in the gallery is the
           one demonstrating them — a second ribbon answering Ctrl+F1 and Alt+Win would take them over. -->
      <b-ribbon id="pg-ribbon" pinned label-ribbon="Playground" collapse-shortcut="none" keytip-shortcut="none">
        <a slot="before-tabs" class="pg-brand" href="./" aria-label="Birko.Web Playground, home">
          <span class="pg-logo" aria-hidden="true">B</span>
          <span class="pg-brand-text"><strong>Birko.Web</strong><span class="pg-sub">Playground</span></span>
        </a>
      </b-ribbon>
    </header>
    <main class="pg-main">
      <!-- Published at https://birko-framework.github.io/Birko.Web.Playground/, so most people who open this have
           never seen Birko.Web and arrive with no context. The introduction lives in Help → About (the #pg-about
           modal below), not above the gallery, where it pushed every component down on every visit (decision
           2026-10-28). A first-time visitor gets this one line pointing at it; dismissing it is per-browser and
           deliberately NOT synced — a returning developer should not see it, a first-time visitor always should. -->
      <div id="pg-hint" class="pg-hint" role="note" hidden>
        <span class="pg-hint-text">ℹ New here? Every card is a live <code>b-*</code> component — hover ⓘ for its API.</span>
        <button id="pg-hint-about" class="pg-hint-link" type="button">About this playground</button>
        <button id="pg-hint-close" class="pg-hint-close" type="button" aria-label="Dismiss the hint">&times;</button>
      </div>
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
        <b-button id="download-btn" size="sm">Download .css</b-button>
      </div>
    </b-modal>

    <b-modal id="pg-about" title="Birko.Web — the component library, running">
      <div class="pg-about">
        <p>
          Every <code>b-*</code> component in the gallery is the real thing, built from source: flip its attributes
          with the selects under it and watch the live instance react. The line under each name says what it is;
          <strong>ⓘ</strong> lists its attributes, methods and events, straight from the library's API reference.
        </p>
        <p>
          <strong>Appearance → Design tokens</strong> opens the <code>--b-*</code> set and restyles the whole gallery
          as you edit; <strong>Generate CSS</strong> hands you a paste-ready theme file from whatever you changed.
          The <strong>Lab</strong> tab holds the test harnesses used to verify the library.
        </p>
        <p class="pg-about-muted">
          Framework-agnostic custom elements — no build step required to consume them, and no runtime dependency to
          take on.
        </p>
        <div class="pg-about-links">
          <a href="https://github.com/Birko-Framework/Birko.Web" target="_blank" rel="noopener">Birko.Web source</a>
          <a href="${API_URL}" target="_blank" rel="noopener">Component API</a>
          <a href="https://github.com/Birko-Framework/Birko.Framework/wiki/Web-UI" target="_blank" rel="noopener">Usage guide</a>
          <a href="https://github.com/Birko-Framework/Birko.Web.Playground" target="_blank" rel="noopener">This playground</a>
        </div>
      </div>
      <div slot="footer" class="pg-modal-foot">
        <b-button id="pg-about-tour" size="sm" variant="secondary">🧭 Take the tour</b-button>
        <b-button id="pg-about-close" size="sm" variant="primary">Start exploring</b-button>
      </div>
    </b-modal>`;
  injectStyles();
  const gallery = setupGallery(root);
  setupRibbon(root, gallery);
  setupAbout(root);
  void initTokenEditor(root);
  reportMissing();
}

// ── Ribbon header ────────────────────────────────────────────────────────────
// Every command the old header had, plus the docs, as ribbon commands. The app listens to the ribbon's own
// `item-click` / `item-change` / `tab-change`, which is also what verify.mjs and subpath-check.mjs dispatch — so the
// checks drive the same listener a click does, not a side door.
type Ribbon = HTMLElement & {
  setTabs(tabs: unknown[]): void;
  setPressed(itemId: string, pressed: boolean, tabId?: string): void;
  setFieldValue(itemId: string, value: string, tabId?: string): void;
};

const THEME_ABOUT: Record<string, string> = {
  light: 'The base theme — tokens.css with no override.',
  dark: 'Dark surfaces for low light.',
  neon: 'A high-contrast dark theme with saturated accents.',
  finstat: 'A branded theme: the tokens a product would ship.',
  inverse: 'A partial theme (surfaces only) for scoped regions such as a dark header on a light page.',
};

const LOCALES = [{ value: 'en', label: 'EN' }, { value: 'cs', label: 'CS' }, { value: 'sk', label: 'SK' }];

// The pick survives a reload, as the theme does (`pg-theme`). Saved only by the ribbon's click, not through I18n's own
// `storageKey`: the smoke suites switch the shared I18n's locale, and Lab → Run smoke suites in a visitor's browser
// would otherwise change their language for good.
const LOCALE_KEY = 'pg-locale';

function savedLocale(): string | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v && LOCALES.some((l) => l.value === v) ? v : null;
  } catch { return null; /* storage disabled — English, as before */ }
}

function pickLocale(id: string): void {
  try { localStorage.setItem(LOCALE_KEY, id); } catch { /* storage disabled — the switch still works */ }
  void getI18n().setLocale(id);
}

const HELP_LINKS: Record<string, { label: string; url: string; icon: string; about: string }> = {
  'doc:source': { label: 'Birko.Web source', icon: '⌥', url: 'https://github.com/Birko-Framework/Birko.Web', about: 'The library on GitHub: Core, Components and Shell.' },
  'doc:api': { label: 'Component API', icon: '📘', url: API_URL, about: 'Every attribute, method and event of every b-* component.' },
  'doc:guide': { label: 'Usage guide', icon: '📖', url: 'https://github.com/Birko-Framework/Birko.Framework/wiki/Web-UI', about: 'How to use Birko.Web in an app, on the framework wiki.' },
  'doc:repo': { label: 'This playground', icon: '⚙', url: 'https://github.com/Birko-Framework/Birko.Web.Playground', about: 'The source of this page and its verification scripts.' },
};

function setupRibbon(root: HTMLElement, gallery: Gallery): void {
  const ribbon = root.querySelector<Ribbon>('#pg-ribbon');
  if (!ribbon) return;
  const shownCats = gallery.cats.filter((c) => c !== 'lab');
  const labCount = registeredInCategory('lab').length;

  const build = (): void => ribbon.setTabs([
    { id: 'gallery', label: 'Gallery', groups: [
      { id: 'category', label: 'Category', items: shownCats.map((c) => ({
        id: `cat:${c}`, label: `${CATEGORY_LABELS[c] ?? c} (${registeredInCategory(c).length})`, icon: CATEGORY_ICONS[c],
        toggle: true, toggleGroup: 'cat', pressed: c === gallery.current(), description: CATEGORY_ABOUT[c] })) },
      { id: 'find', label: 'Find', items: [
        { id: 'filter', label: 'Filter', field: { type: 'text', value: '', width: 16, caption: 'beside', placeholder: 'name, tag or text…' },
          description: 'Show only the cards whose name, tag or description contains this text, as you type.' },
        { id: 'filter-clear', label: 'Clear', icon: '✕', description: 'Show every card again.' },
      ] },
    ] },
    { id: 'appearance', label: 'Appearance', groups: [
      { id: 'theme', label: 'Theme', items: PG_THEMES.map((t) => ({
        id: `theme:${t.value}`, label: t.label.replace(/^\S+\s/, ''), icon: t.label.split(' ')[0],
        toggle: true, toggleGroup: 'theme', pressed: t.value === activeTheme(), description: THEME_ABOUT[t.value] })) },
      { id: 'locale', label: 'Locale', items: LOCALES.map((l) => ({
        id: `locale:${l.value}`, label: l.label, toggle: true, toggleGroup: 'locale', pressed: l.value === (bootLocale ?? getI18n().locale),
        description: 'Components re-render and format numbers and dates in this locale (b-qty-stepper shows 1,5 under CS and SK).' })) },
      { id: 'design', label: 'Design', items: [
        { id: 'tokens', label: 'Design tokens', icon: '🎨',
          description: 'Edit the --b-* tokens; the whole gallery restyles as you type.' },
        { id: 'export', label: 'Generate CSS', icon: '⤓',
          description: 'A paste-ready theme file from whatever tokens you changed.' },
      ] },
    ] },
    { id: 'lab', label: 'Lab', groups: [
      { id: 'harnesses', label: 'Test harnesses', items: [
        { id: 'cat:lab', label: `Harnesses (${labCount})`, icon: '⚗',
          description: CATEGORY_ABOUT.lab },
        { id: 'smoke', label: 'Run smoke suites', icon: '▶',
          description: 'Opens the page with every in-page smoke suite running (what verify.mjs loads); results are in the console.' },
      ] },
    ] },
    { id: 'help', label: 'Help', groups: [
      { id: 'start', label: 'Start', items: [
        { id: 'about', label: 'About', icon: 'ℹ', description: 'What this page is and how to use it.' },
        { id: 'tour', label: 'Tour', icon: '🧭', description: 'A three-step tour of the playground.' },
      ] },
      { id: 'docs', label: 'Documentation', items: Object.entries(HELP_LINKS).map(([id, l]) => ({
        id, label: l.label, icon: l.icon, description: l.about })) },
    ] },
  ]);
  requestAnimationFrame(build);

  ribbon.addEventListener('item-click', (e) => {
    const id = (e as CustomEvent<{ itemId?: string }>).detail?.itemId ?? '';
    if (id.startsWith('cat:')) {
      gallery.show(id.slice(4));
      if (id !== 'cat:lab') ribbon.setPressed(id, true, 'gallery');
    } else if (id.startsWith('theme:')) setTheme(id.slice(6));
    // No locale bundles beyond the partial cs / sk ones, so mostly number and date formatting changes.
    else if (id.startsWith('locale:')) pickLocale(id.slice(7));
    else if (id === 'tokens') root.dispatchEvent(new CustomEvent('pg-open-tokens'));
    else if (id === 'export') root.dispatchEvent(new CustomEvent('pg-open-export'));
    else if (id === 'filter-clear') { ribbon.setFieldValue('filter', '', 'gallery'); gallery.filter(''); }
    else if (id === 'smoke') window.open('?smoke=1', '_blank', 'noopener');
    else if (id === 'about') openAbout(root);
    else if (id === 'tour') startPlaygroundTour();
    else if (HELP_LINKS[id]) window.open(HELP_LINKS[id].url, '_blank', 'noopener');
  });
  // Filter as you type. The ribbon reports a field only on commit (Enter, leaving it); the native `input` event is
  // composed, so it reaches the ribbon host, and its path names the field box it came from.
  ribbon.addEventListener('input', (e) => {
    const path = e.composedPath();
    const box = path.find((n) => n instanceof HTMLElement && n.dataset.item === 'filter');
    const input = path[0];
    if (box && input instanceof HTMLInputElement) gallery.filter(input.value);
  });
  ribbon.addEventListener('item-change', (e) => {
    const d = (e as CustomEvent<{ itemId?: string; value?: string }>).detail;
    if (d?.itemId === 'filter') gallery.filter(d.value ?? '');
  });
  // Opening the Lab tab shows the harnesses; going back to Gallery shows the category it left.
  ribbon.addEventListener('tab-change', (e) => {
    const tab = (e as CustomEvent<{ tab?: string | { id?: string } }>).detail?.tab;
    const id = typeof tab === 'string' ? tab : tab?.id;
    if (id === 'lab') gallery.show('lab');
    else if (id === 'gallery') gallery.show(gallery.lastCategory());
  });
  onThemeChange((t) => ribbon.setPressed(`theme:${t}`, true, 'appearance'));
}

// ── About + first-visit hint ─────────────────────────────────────────────────
// The introduction is the Help → About dialog. A first-time visitor gets one line under the ribbon pointing at it,
// rendered `hidden` and revealed here rather than the reverse, so a browser with storage disabled (the read throws)
// gets the line rather than a flash of it disappearing. The key keeps its old name, so a visitor who dismissed the old
// intro panel is not shown the hint again.
const HINT_KEY = 'pg-intro-dismissed';

function openAbout(root: HTMLElement): void {
  root.querySelector<HTMLElement & { open?: () => void }>('#pg-about')?.open?.();
}

function setupAbout(root: HTMLElement): void {
  const hint = root.querySelector<HTMLElement>('#pg-hint');
  const modal = root.querySelector<HTMLElement & { close?: () => void }>('#pg-about');
  let dismissed = false;
  try { dismissed = localStorage.getItem(HINT_KEY) === '1'; } catch { /* storage disabled */ }
  if (hint && !dismissed) hint.hidden = false;
  const dismiss = (): void => {
    if (hint) hint.hidden = true;
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage disabled: it comes back next load */ }
  };
  root.querySelector('#pg-hint-close')?.addEventListener('click', dismiss);
  // Reading the About is what the hint asks for, so it also retires the hint.
  root.querySelector('#pg-hint-about')?.addEventListener('click', () => { dismiss(); openAbout(root); });
  root.querySelector('#pg-about-close')?.addEventListener('click', () => modal?.close?.());
  root.querySelector('#pg-about-tour')?.addEventListener('click', () => { modal?.close?.(); startPlaygroundTour(); });
}

// The playground's own tour, from Help → Tour. Targets are light-DOM elements: a ribbon command lives in the
// ribbon's shadow root, which a selector cannot reach.
function startPlaygroundTour(): void {
  // `once: false`: asked for from Help, so it replays every time rather than only on a first visit.
  // The card targets are scoped to the shown section: the hidden ones come first in the DOM.
  tour.start([
    { target: '#pg-ribbon', title: 'The ribbon', body: 'Gallery picks a category, Appearance changes the theme and tokens, Lab holds the test harnesses, Help the docs.', placement: 'bottom' },
    { target: '#pg-gallery .pg-grid[data-active] .pg-item', title: 'A live component', body: 'Each card is the real component. The line under its name says what it is; ⓘ lists its attributes, methods and events.', placement: 'bottom' },
    { target: '#pg-gallery .pg-grid[data-active] .pg-controls', title: 'Try it', body: 'These selects flip the component\u2019s attributes live.', placement: 'top' },
  ], { id: 'pg-playground-tour', once: false });
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
  // The Lab says what it is before its first card: these exist to verify the library, not to be shipped.
  if (cat === 'lab') {
    sec.appendChild(el('div', 'pg-lab-banner',
      '<strong>⚗ Lab — test harnesses, not components.</strong> These cards exist to verify Birko.Web: a benchmark, '
      + 'device probes and wiring checks that the automated suites and the human test plans drive. Nothing here is '
      + 'something you would put in an app.'));
  }
  for (const def of entries) {
    try { sec.appendChild(renderItem(def)); }
    catch (e) { console.warn(`[playground] failed to render ${def.tag}:`, (e as Error).message); }
  }
  console.info(`[playground] section "${cat}" — ${entries.length} components`);
}

/** The gallery as the ribbon drives it: which section shows, and the Find filter over its cards. */
interface Gallery {
  cats: string[];
  show(cat: string): void;
  filter(query: string): void;
  current(): string;
  /** The last component category shown — what the Gallery tab returns to after the Lab. */
  lastCategory(): string;
}

// The sections live in the body grids, not in tabs/panels — b-tabs hard-couples its strip to its panels, so the
// strip cannot sit in the header. The ribbon (setupRibbon) is the switcher.
function setupGallery(root: HTMLElement): Gallery {
  const gallery = root.querySelector<HTMLElement>('#pg-gallery')!;
  const cats = [...new Set(CATALOGUE.map((d) => d.category))].filter((c) => registeredInCategory(c).length > 0);
  let current = cats.find((c) => c !== 'lab') ?? '';
  let lastCategory = current;
  let query = '';

  const sections = new Map<string, HTMLElement>();
  for (const c of cats) {
    const sec = el('div', 'pg-grid');
    sec.dataset.cat = c;
    sec.style.display = 'none';
    sections.set(c, sec);
    gallery.appendChild(sec);
  }
  const empty = el('div', 'pg-filter-empty');
  empty.hidden = true;
  gallery.appendChild(empty);

  const applyFilter = (): void => {
    const sec = sections.get(current);
    if (!sec) return;
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const card of sec.querySelectorAll<HTMLElement>(':scope > .pg-item')) {
      const hit = !q || (card.dataset.search ?? '').includes(q);
      card.hidden = !hit;
      if (hit) shown++;
    }
    empty.hidden = !q || shown > 0;
    empty.textContent = `Nothing in ${CATEGORY_LABELS[current] ?? current} matches “${query.trim()}”.`;
  };

  const show = (cat: string): void => {
    if (!sections.has(cat)) return;
    current = cat;
    if (cat !== 'lab') lastCategory = cat;
    for (const [c, sec] of sections) {
      const on = c === cat;
      sec.style.display = on ? '' : 'none';
      sec.toggleAttribute('data-active', on);
    }
    buildSection(sections.get(cat)!, cat);
    applyFilter();
  };

  if (current) show(current);
  return {
    cats, show,
    filter: (q) => { query = q; applyFilter(); },
    current: () => current,
    lastCategory: () => lastCategory,
  };
}

function renderItem(def: ComponentDef): HTMLElement {
  const card = el('div', def.wide ? 'pg-item pg-item-wide' : 'pg-item');
  const about = aboutOf(def);
  card.dataset.search = `${def.label} ${def.tag} ${about}`.toLowerCase();

  // Title row: the name, the tag, and an ⓘ whose b-tooltip is the component's reference (README + API.md).
  const head = el('div', 'pg-item-head');
  head.appendChild(el('div', 'pg-item-label', `<span class="pg-item-name">${escapeHtml(def.label).replace(/`([^`]+)`/g, '<code>$1</code>')}</span> <code class="pg-item-tag">&lt;${def.tag}&gt;</code>`));
  const info = infoFor(def);
  const tip = document.createElement('b-tooltip');
  tip.setAttribute('theme', 'light');
  tip.setAttribute('position', 'left'); // the ⓘ sits at the card's right edge: opening leftward keeps it on screen
  tip.setAttribute('text', info.html);
  const infoBtn = document.createElement('button');
  infoBtn.type = 'button';
  infoBtn.className = 'pg-info';
  infoBtn.textContent = 'ⓘ';
  infoBtn.setAttribute('aria-label', `About ${def.label.replace(/`/g, '')}`);
  infoBtn.setAttribute('aria-description', info.text);
  tip.appendChild(infoBtn);
  head.appendChild(tip);
  card.appendChild(head);
  if (about) card.appendChild(el('p', 'pg-item-about', escapeHtml(about)));

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
  // A card without its description line is the "component dump" this page used to be.
  const undescribed = CATALOGUE.filter((d) => !aboutOf(d)).map((d) => d.label);
  if (undescribed.length) console.warn(`[playground] catalogue entries without an ABOUT line: ${undescribed.join(', ')}`);
}

// ── Token editor ─────────────────────────────────────────────────────────────
const baseTokens = new Map<string, string>();               // name -> base value (tokens.css :root)
const themeTokens = new Map<string, Map<string, string>>(); // theme id -> the tokens THAT theme overrides
const edits = new Map<string, string>();                    // name -> edited value
const tokenGroups = new Map<string, string[]>();            // group label -> token names
let exportMode = 'theme';
let tokensBuilt = false;
let tokenListEl: HTMLElement | null = null;
const GROUP_ORDER = ['Color & surface', 'Typography', 'Spacing', 'Radius', 'Sizing', 'Shadow', 'Motion', 'Z-index', 'Other'];

async function initTokenEditor(root: HTMLElement): Promise<void> {
  const listEl = root.querySelector<HTMLElement>('#token-list')!;
  tokenListEl = listEl;
  const drawer = root.querySelector<HTMLElement & { open?: () => void }>('#tokens-drawer');
  const modal = root.querySelector<HTMLElement & { open?: () => void }>('#export-modal');
  try {
    const css = await (await fetch('css/tokens.css')).text();
    for (const [k, v] of parseTokenBlock(css, /:root\s*\{([\s\S]*?)\}/)) baseTokens.set(k, v);
    listEl.textContent = '';
  } catch (e) {
    listEl.textContent = `Could not load css/tokens.css (${(e as Error).message}). Run the build first.`;
  }
  await loadThemeTokens();

  // A theme change moves what "base" means for every token it overrides, so the rows have to be
  // re-read — otherwise the drawer shows light's values while the page is dark. Only if already built
  // (this costs the accordion's open/filter state, which is why it isn't done eagerly).
  onThemeChange(() => { if (tokensBuilt) buildTokenAccordion(listEl); });

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
  // Opened from the ribbon's Appearance → Design commands (setupRibbon re-dispatches them on the root).
  root.addEventListener('pg-open-tokens', () => {
    if (baseTokens.size && !tokensBuilt) buildTokenAccordion(listEl);
    drawer?.open?.();
  });
  // Generate CSS lives in a modal; render the current export on open (from the ribbon or the drawer footer).
  const openExport = (): void => { out.textContent = generateCss(exportMode); modal?.open?.(); };
  root.addEventListener('pg-open-export', openExport);
  root.querySelector('#open-export-2')?.addEventListener('click', openExport);

  root.querySelector('#token-filter')?.addEventListener('search', (e) => {
    applyFilter(listEl, (e as CustomEvent<{ value?: string }>).detail?.value ?? '');
  });
  root.querySelector('#export-btn')?.addEventListener('click', () => { out.textContent = generateCss(exportMode); });
  root.querySelector('#reset-btn')?.addEventListener('click', () => {
    edits.clear(); applyTokenEdits(); tokensBuilt = false; buildTokenAccordion(listEl); out.textContent = placeholder;
  });
  root.querySelector('#copy-btn')?.addEventListener('click', () => {
    const t = out.textContent ?? '';
    if (t && t !== placeholder) void navigator.clipboard?.writeText(t);
  });
  // TASK-038's export criterion is "copy-to-clipboard AND download-as-file"; only the clipboard half
  // existed. Named for the shape being exported, because the two are wired differently at the far end:
  // a theme block needs registerThemes(), a :root override needs only to be linked.
  root.querySelector('#download-btn')?.addEventListener('click', () => {
    const t = out.textContent ?? '';
    if (!t || t === placeholder) return;
    const url = URL.createObjectURL(new Blob([t], { type: 'text/css' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportMode === 'theme' ? 'my-brand.theme.css' : 'tokens.override.css';
    a.click();
    // Revoked on the next turn rather than immediately. DEFENSIVE, not witnessed: a synchronous revoke
    // is documented to be able to beat a click the browser has not yet processed, but no empty file was
    // observed here — said explicitly so nobody later reads this as a fixed bug.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
}

// Comments are stripped first: the block is matched up to its first `}`, and the theme files carry long
// prose comments — one `}` inside one of them would silently truncate the token list.
function parseTokenBlock(css: string, selector: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const block = css.replace(/\/\*[\s\S]*?\*\//g, '').match(selector);
  if (!block) return out;
  const re = /(--b-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1])) !== null) out.set(m[1], m[2].trim());
  return out;
}

// Each alternate theme is a diff over :root, so its file holds only the tokens it changes.
async function loadThemeTokens(): Promise<void> {
  await Promise.all(PG_THEMES.filter((t) => t.value !== 'light').map(async (t) => {
    try {
      const css = await (await fetch(`css/themes/${t.value}.css`)).text();
      themeTokens.set(t.value, parseTokenBlock(css, new RegExp(`\\[data-theme="${t.value}"\\]\\s*\\{([\\s\\S]*?)\\}`)));
    } catch { /* theme CSS absent from this build — its tokens simply fall through to the base */ }
  }));
}

/** What the token is worth in the ACTIVE theme, before any live edit. */
function baseValue(name: string): string {
  return themeTokens.get(activeTheme())?.get(name) ?? baseTokens.get(name) ?? '';
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
  const base = baseValue(name);
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
    applyTokenEdits();
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

// Live edits layer ON TOP of the selected theme, so they must not own `data-theme` — an element has only
// one, and claiming it (as this did) dropped the user back to light the moment they touched a token, and
// let a theme switch wipe the edits. They get their own attribute instead: `:root[data-pg-edits]` is
// (0,2,0) against the themes' `[data-theme="x"]` (0,1,0), and the block is last in <head> either way.
function applyTokenEdits(): void {
  const style = document.getElementById('playground-theme')!;
  if (edits.size === 0) {
    style.textContent = '';
    document.documentElement.removeAttribute('data-pg-edits');
    return;
  }
  const body = [...edits].map(([n, v]) => `  ${n}: ${v};`).join('\n');
  style.textContent = `:root[data-pg-edits] {\n${body}\n}`;
  document.documentElement.setAttribute('data-pg-edits', '');
}

function generateCss(mode: string): string {
  if (edits.size === 0) return '/* No token edits — change a token, then Generate CSS. */';
  const body = [...edits].map(([n, v]) => `  ${n}: ${v};`).join('\n');
  const header =
    `/* Birko.Web theme export — ${edits.size} token(s) changed from the "${activeTheme()}" base.\n` +
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
    .pg-hint { display:flex; align-items:center; gap:.75rem; margin:0 0 1rem; padding:.5rem .85rem; font-size:.85rem;
      background:var(--b-color-primary-light,#dbeafe); color:var(--b-text,#0f172a); border-radius:var(--b-radius,6px); }
    .pg-hint[hidden] { display:none; }
    .pg-hint code { font-size:.85em; }
    .pg-hint-text { flex:1 1 auto; min-width:0; }
    .pg-hint-link { flex:0 0 auto; background:none; border:0; padding:0; cursor:pointer; font:inherit; font-weight:600;
      color:var(--b-color-primary,#2563eb); }
    .pg-hint-link:hover { text-decoration:underline; }
    .pg-hint-close { flex:0 0 auto; background:none; border:0; font-size:1.2rem; line-height:1; cursor:pointer;
      color:var(--b-text-secondary,#64748b); padding:0 .2rem; }
    .pg-about { font-size:.92rem; line-height:1.55; max-width:62ch; }
    .pg-about p { margin:0 0 .75rem; }
    .pg-about code { background:var(--b-bg-secondary,#f3f3f3); padding:.05rem .3rem; border-radius:4px; font-size:.85em; }
    .pg-about-muted { color:var(--b-text-secondary,#64748b); }
    .pg-about-links { display:flex; flex-wrap:wrap; gap:1rem; font-size:.88rem; }
    .pg-about-links a { color:var(--b-color-primary,#2563eb); text-decoration:none; }
    .pg-about-links a:hover { text-decoration:underline; }
    /* The ribbon is the whole header; it owns its own height, scrolling and mobile menu. */
    .pg-header { position:sticky; top:0; z-index:10; background:var(--b-bg,#fff); box-shadow:var(--b-shadow-sm,0 1px 2px rgba(0,0,0,.05)); }
    .pg-header b-ribbon { display:block; }
    .pg-brand { display:flex; align-items:center; gap:.5rem; padding:0 .75rem 0 .25rem; color:inherit; text-decoration:none; white-space:nowrap; }
    .pg-logo { display:grid; place-items:center; width:1.6rem; height:1.6rem; border-radius:var(--b-radius,6px);
      background:var(--b-color-primary,#2563eb); color:var(--b-text-inverse,#fff); font-weight:700; font-size:.9rem; }
    .pg-brand-text { display:flex; flex-direction:column; line-height:1.1; }
    .pg-brand-text strong { font-size:.9rem; }
    .pg-sub { color:var(--b-text-secondary,#888); font-size:.7rem; }
    .pg-main { padding:1.25rem; max-width:110rem; margin:0 auto; }
    .pg-gallery { min-width:0; }
    /* min(100%, 400px): a bare 400px minimum made every card 400px on a 390px phone, so the whole page overflowed
       sideways (433px) and anything sized in vw — the gallery zoom — no longer covered it (TASK-550 walkthrough). */
    .pg-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px),1fr)); gap:1.5rem; }
    .pg-note { font-size:.7rem; color:var(--b-text-secondary,#999); font-style:italic; margin-top:.4rem; }
    /* A wide card takes the whole row whatever the viewport, so the component is measured against a
       realistic width rather than a grid cell. 1 / -1 rather than a column count: the grid is
       auto-fill, so the number of columns is not known here.
       (No backticks in this block -- these styles live in a template literal.) */
    .pg-item-wide { grid-column: 1 / -1; }
    .pg-item { display:flex; flex-direction:column; background:var(--b-bg,#fff); border:1px solid var(--b-border,#ddd);
      border-radius:var(--b-radius-lg,10px); padding:1rem; box-shadow:var(--b-shadow-sm,none);
      transition:border-color var(--b-transition,150ms), box-shadow var(--b-transition,150ms); }
    .pg-item:hover { border-color:var(--b-border-hover,#cbd5e1); box-shadow:var(--b-shadow,0 1px 3px rgba(0,0,0,.1)); }
    .pg-item[hidden] { display:none; }
    .pg-item-head { display:flex; align-items:flex-start; justify-content:space-between; gap:.5rem; }
    .pg-item-label { font-size:.8rem; color:var(--b-text-secondary,#888); min-width:0; }
    .pg-item-name { font-size:.95rem; font-weight:600; color:var(--b-text,#0f172a); }
    .pg-item-tag { font-size:.75rem; color:var(--b-color-primary,#2563eb); }
    .pg-item-about { margin:.3rem 0 .75rem; font-size:.85rem; line-height:1.45; color:var(--b-text-secondary,#475569); }
    .pg-info { flex:0 0 auto; width:1.6rem; height:1.6rem; border-radius:999px; border:1px solid var(--b-border,#ddd);
      background:var(--b-bg,#fff); color:var(--b-text-secondary,#64748b); cursor:help; font-size:.9rem; line-height:1; }
    .pg-info:hover, .pg-info:focus-visible { color:var(--b-color-primary,#2563eb); border-color:var(--b-color-primary,#2563eb); }
    .pg-tip-k { font-weight:600; }
    .pg-lab-banner { grid-column:1 / -1; padding:.85rem 1rem; border-radius:var(--b-radius-lg,10px); font-size:.88rem; line-height:1.5;
      background:var(--b-color-warning-light,#fef3c7); color:var(--b-text,#0f172a);
      border:1px dashed var(--b-color-warning,#d97706); }
    .pg-grid[data-cat="lab"] .pg-item { border-style:dashed; }
    .pg-filter-empty { padding:2rem; text-align:center; color:var(--b-text-secondary,#888); }
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
      b-chart,b-json-viewer,b-json-diff,b-xml-viewer,b-object-tree,b-definition-list,b-code-block,b-pre,b-stat,b-card,
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
// The visitor's saved locale — not under ?smoke / ?kb, whose suites assert English labels and formatting.
const bootParams = new URLSearchParams(location.search);
// Relative, not I18n's default '/locales': published at /Birko.Web.Playground/, an absolute path asked the site root
// (birko-framework.github.io/locales/cs.json, a 404), so a locale switch changed number formats but no text.
getI18n().setBasePath('locales');
const bootLocale = bootParams.has('smoke') || bootParams.has('kb') ? null : savedLocale();
if (bootLocale && bootLocale !== getI18n().locale) void getI18n().setLocale(bootLocale);
if (app) renderApp(app);
