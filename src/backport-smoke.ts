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

// Visible review moved to first-class gallery cards (b-sync-status + pg-device-demo) in app.ts.
