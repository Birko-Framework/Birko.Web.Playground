// EPIC-002 web backport smoke — exercises the new Birko.Web.Core APIs in a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
// This is how the framework's frontend backports are verified (no in-framework unit runner).
import { getFormatter, createWakeLockManager, createAudioCue, MirrorStore, readThrough, define, registerServiceWorker } from 'birko-web-core';
import { BSyncStatus, type SyncSource } from 'birko-web-components/feedback';
import { BMobileAppShell, type Surface } from 'birko-web-shell';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // TASK-041 — Formatter.duration + Intl options passthrough
    const fmt = getFormatter();
    check('duration 0 -> 0:00', fmt.duration(0) === '0:00');
    check('duration 65 -> 1:05', fmt.duration(65) === '1:05');
    check('duration 3661 -> 1:01:01', fmt.duration(3661) === '1:01:01');
    check('duration -5 -> 0:00', fmt.duration(-5) === '0:00');
    check('duration alwaysHours 65 -> 0:01:05', fmt.duration(65, { alwaysHours: true }) === '0:01:05');
    check('date options passthrough contains year', fmt.date('2026-07-06', 'short', { year: 'numeric' }).includes('2026'));

    // TASK-039 — Wake Lock manager (acquire/release must not throw even when denied/unsupported)
    const wake = createWakeLockManager();
    wake.acquire();
    wake.release();
    check('wakeLock acquire/release no-throw', true);

    // TASK-040 — iOS-safe audio cue (prime/beep must not throw)
    const cue = createAudioCue();
    cue.prime();
    cue.beep({ frequency: 440, durationMs: 40, vibrate: 10 });
    check('audioCue prime/beep no-throw', true);

    // TASK-036 — offline read-through mirror
    const mirror = new MirrorStore<{ id: string; n: number }>({ dbName: 'pg_backport_smoke', storeName: 'items', keyPath: 'id' });
    await mirror.clear();
    await mirror.replaceAll([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
    check('mirror replaceAll/readAll = 2', (await mirror.readAll()).length === 2);

    const fresh = await readThrough({ key: 'a', mirror, fetch: async () => ({ ok: true, status: 200, data: { id: 'a', n: 9 } }) });
    check('readThrough online refreshes to n=9', fresh?.n === 9);

    const cached = await readThrough({ key: 'a', mirror, fetch: async () => ({ ok: false, status: 0, data: null }) });
    check('readThrough offline falls back to mirror (n=9)', cached?.n === 9);

    const gone = await readThrough({ key: 'a', mirror, fetch: async () => ({ ok: false, status: 404, data: null }) });
    check('readThrough 404 evicts + returns undefined', gone === undefined && (await mirror.get('a')) === undefined);

    await mirror.clear();

    // TASK-037 — <b-sync-status> chip bound to a fake SyncSource (headless is online, so we exercise
    // the idle→hidden and pending→syncing transitions; the offline visual is a gallery/manual check).
    let notify: (n: number) => void = () => {};
    let pending = 0;
    const source: SyncSource = { get pendingCount() { return pending; }, onChange(fn) { notify = fn; return () => {}; } };
    const chip = document.createElement('b-sync-status') as BSyncStatus;
    document.body.appendChild(chip);
    chip.bind(source);
    await new Promise((r) => setTimeout(r, 0));
    check('sync chip hidden when online + idle', chip.hasAttribute('hidden'));
    pending = 3;
    notify(3);
    await new Promise((r) => setTimeout(r, 0));
    const chipText = chip.shadowRoot?.querySelector('.chip')?.textContent ?? '';
    check('sync chip shows syncing count', !chip.hasAttribute('hidden') && chipText.includes('3'));
    chip.remove();

    // TASK-038 — BMobileAppShell: subclass with surfaces, mount, assert bottom-nav + active state.
    const surfaces: Surface[] = [
      { id: 'home', route: '/', icon: '⌂', label: 'Home' },
      { id: 'log', route: '/log', icon: '≣', label: 'Log' },
      { id: 'me', route: '/me', icon: '☺', label: 'Me' },
    ];
    class SmokeMobileShell extends BMobileAppShell {
      protected get brandName(): string { return 'Smoke'; }
      protected getUserName(): string { return ''; }
      protected onSignOut(): void { /* none */ }
      protected t(key: string): string { return key; }
      protected get surfaces(): readonly Surface[] { return surfaces; }
    }
    if (!customElements.get('smoke-mobile-shell')) define('smoke-mobile-shell', SmokeMobileShell);
    const prevHash = window.location.hash;
    window.location.hash = '#/log';
    const shell = document.createElement('smoke-mobile-shell');
    document.body.appendChild(shell);
    await new Promise((r) => setTimeout(r, 10));
    const navItems = shell.shadowRoot?.querySelectorAll('.mobile-navitem') ?? [];
    check('mobile shell renders one nav item per surface', navItems.length === surfaces.length);
    const active = shell.shadowRoot?.querySelector('.mobile-navitem.active');
    check('mobile shell active item reflects hash /log', active?.getAttribute('data-surface') === 'log');
    shell.remove();
    window.location.hash = prevHash;

    // TASK-035 — client SW registration is best-effort: a missing SW script must resolve to null,
    // never throw (localhost is a secure context, so serviceWorker is available in the verify run).
    const reg = await registerServiceWorker('/no-such-sw-smoke.js');
    check('registerServiceWorker best-effort → null on missing script', reg === null);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] backport-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] backport-smoke ${r}`);
})();

// ── Visible review surface (for the human review of the EPIC-002 web backports) ───────────────────
// A phone-framed BMobileAppShell with a live <b-sync-status>, plus buttons to drive the sync chip,
// wake lock, and audio cue. Register the SW so the PWA (offline shell, cache prune) can be reviewed
// in DevTools → Application. Appended after the gallery; harmless to the smoke above.
const REVIEW_SURFACES: Surface[] = [
  { id: 'today', route: '/', icon: '📅', label: 'Today' },
  { id: 'log', route: '/log', icon: '📝', label: 'Log' },
  { id: 'progress', route: '/progress', icon: '📈', label: 'Progress' },
  { id: 'plans', route: '/plans', icon: '🗂️', label: 'Plans' },
];

class ReviewShell extends BMobileAppShell {
  protected get brandName(): string { return 'Reps demo'; }
  protected getUserName(): string { return ''; }
  protected onSignOut(): void { /* none */ }
  protected t(key: string): string { return key; } // labels fall back to Surface.label
  protected get surfaces(): readonly Surface[] { return REVIEW_SURFACES; }
}
if (!customElements.get('pg-review-shell')) define('pg-review-shell', ReviewShell);

function renderBackportReview(): void {
  const style = document.createElement('style');
  style.textContent = `
    #backport-review { max-width: 900px; margin: 2rem auto; padding: 0 1rem; font-family: var(--b-font, system-ui, sans-serif); }
    #backport-review h2 { font-size: 1.1rem; }
    .rv-phone { width: 360px; height: 620px; margin: 1rem 0; border: 8px solid #222; border-radius: 28px; overflow: hidden; background: var(--b-bg, #fff); box-shadow: 0 8px 30px rgba(0,0,0,.2); }
    .rv-page { padding: 1rem; display: flex; flex-direction: column; gap: .5rem; }
    .rv-controls { display: flex; flex-wrap: wrap; gap: .5rem; }
    .rv-controls button { padding: .4rem .7rem; border: 1px solid var(--b-border, #ccc); border-radius: var(--b-radius, 6px); background: var(--b-bg-elevated, #fff); cursor: pointer; }
    #rv-status { font-size: .8rem; color: var(--b-text-muted, #888); min-height: 1.2em; }
  `;
  document.head.appendChild(style);

  const section = document.createElement('section');
  section.id = 'backport-review';
  section.innerHTML = `
    <h2>EPIC-002 backport review</h2>
    <p>Mobile shell (BMobileAppShell) + sync chip (&lt;b-sync-status&gt;). Buttons drive the chip, wake lock, and audio cue.</p>
    <p><strong>PWA review (opt-in):</strong> click <em>Register SW</em>, wait for DevTools → Application → Service Workers to show "activated", then tick "Offline" and reload — the shell serves from cache. Click <em>Unregister SW</em> to remove it (the playground does <strong>not</strong> register a service worker on its own, so normal gallery use is never cached).</p>
    <div class="rv-phone">
      <pg-review-shell>
        <b-sync-status slot="actions" id="rv-sync"></b-sync-status>
        <div class="rv-page">
          <div class="rv-controls">
            <button id="rv-queue" type="button">Queue write (+1)</button>
            <button id="rv-drain" type="button">Drain</button>
            <button id="rv-wake" type="button">Acquire wake lock</button>
            <button id="rv-wake-off" type="button">Release</button>
            <button id="rv-beep" type="button">Beep</button>
            <button id="rv-sw-on" type="button">Register SW</button>
            <button id="rv-sw-off" type="button">Unregister SW</button>
          </div>
          <p id="rv-status"></p>
        </div>
      </pg-review-shell>
    </div>
  `;
  document.body.appendChild(section);

  // Drive <b-sync-status> from a fake outbox.
  let pending = 0;
  let notify: (n: number) => void = () => {};
  const source: SyncSource = { get pendingCount() { return pending; }, onChange(fn) { notify = fn; return () => {}; } };
  const chip = document.getElementById('rv-sync') as BSyncStatus | null;
  chip?.bind(source);

  const status = document.getElementById('rv-status');
  const say = (msg: string): void => { if (status) status.textContent = msg; };
  const bump = (delta: number): void => { pending = Math.max(0, pending + delta); notify(pending); say(`pending = ${pending}`); };

  const wake = createWakeLockManager();
  const cue = createAudioCue();

  document.getElementById('rv-queue')?.addEventListener('click', () => bump(1));
  document.getElementById('rv-drain')?.addEventListener('click', () => { pending = 0; notify(0); say('drained'); });
  document.getElementById('rv-wake')?.addEventListener('click', () => { wake.acquire(); say(`wake lock: ${wake.held ? 'held' : 'requested (may be denied off-gesture)'}`); });
  document.getElementById('rv-wake-off')?.addEventListener('click', () => { wake.release(); say('wake lock released'); });
  document.getElementById('rv-beep')?.addEventListener('click', () => { cue.prime(); cue.beep({ frequency: 660, durationMs: 120, vibrate: 20 }); say('beep'); });

  // PWA review is opt-in — the playground does NOT auto-register a SW (that caused stale-shell / port
  // confusion during normal gallery dev). Register/unregister on demand here.
  document.getElementById('rv-sw-on')?.addEventListener('click', async () => {
    const reg = await registerServiceWorker('/sw.js');
    say(reg ? 'SW registered — wait for "activated" in DevTools, then go Offline + reload' : 'SW registration failed / unsupported');
  });
  document.getElementById('rv-sw-off')?.addEventListener('click', async () => {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    say(`unregistered ${regs.length} service worker(s) — reload to fully clear`);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderBackportReview);
} else {
  renderBackportReview();
}
