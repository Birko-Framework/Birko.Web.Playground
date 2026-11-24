// EPIC-002 web backport smoke — exercises the new Birko.Web.Core APIs in a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
// This is how the framework's frontend backports are verified (no in-framework unit runner).
import { BaseComponent } from 'birko-web-core';
import { parseDecimal, getFormatter, getI18n, createWakeLockManager, createAudioCue, MirrorStore, readThrough, readWindowThrough, syncWindow, inWindow, createListMirror, readAllClassifiedThrough, peekList, define, registerServiceWorker, I18n, signal, setPersistPrefix, SyncManager, ActionQueue, Store, unwrapList, apiErrorMessage, appendQuery, ApiClient, DEFAULT_REQUEST_TIMEOUT_MS } from 'birko-web-core';
import { BSyncStatus, type SyncSource } from 'birko-web-components/feedback';
import { BTreeMenu, BRibbon, type RibbonTab } from 'birko-web-components/nav';
import { BMarkdownEditor } from 'birko-web-components/inputs';
import { BPagination, BKanban, BDataTable, BChart, niceScale, tickIntervalsForHeight, formatTick } from 'birko-web-components/data';
import { confirm as dlgConfirm } from 'birko-web-components/dialogs';
import { BCard, BChat } from 'birko-web-components/layout';
import { BMobileAppShell, BAppShell, BasePage, BUILTIN_THEMES, themeBootScript, activeSurface, type Surface } from 'birko-web-shell';
import { getVisibleOptions, hasPermission, resolveModuleFromHash, createEntitySearchProvider } from 'birko-web-shell';

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

    // TASK-094 — windowed read-through (readWindowThrough / syncWindow / inWindow).
    //
    // The behaviour under test is the one `readAllThrough` gets WRONG for a dated collection read a window at
    // a time: a narrow refresh must not truncate a wider cache. Everything else here exists to pin the
    // window-scoped replace — evict inside the fetched window, preserve outside it — plus the `primed` flag,
    // which is what lets a caller tell "nothing in this range" from "this device has never synced".
    {
      interface Row { id: string; date: string; v: number }
      const dated = new MirrorStore<Row>({ dbName: 'pg_window_smoke', storeName: 'rows', keyPath: 'id' });
      await dated.clear();

      check('inWindow respects both bounds', inWindow('2026-03-05', '2026-03-01', '2026-03-31'));
      check('inWindow excludes outside', !inWindow('2026-02-28', '2026-03-01', '2026-03-31'));
      check('inWindow unbounded when both omitted', inWindow('1999-01-01') && inWindow('2999-12-31'));
      check('inWindow is inclusive on both ends',
        inWindow('2026-03-01', '2026-03-01', '2026-03-31') && inWindow('2026-03-31', '2026-03-01', '2026-03-31'));

      // Prime a wide window (Jan–Mar), then read a narrow one (March only).
      const wide = await readWindowThrough<Row>({
        fetch: async () => ({ ok: true, status: 200, data: [
          { id: 'jan', date: '2026-01-10', v: 1 },
          { id: 'feb', date: '2026-02-10', v: 2 },
          { id: 'mar', date: '2026-03-10', v: 3 },
        ] }),
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
      });
      check('readWindowThrough server read reports source=server + primed', wide.source === 'server' && wide.primed);
      check('readWindowThrough server read returns all 3', wide.rows.length === 3);

      // THE case this helper exists for: a narrow refresh must leave the wider cache intact.
      await readWindowThrough<Row>({
        fetch: async () => ({ ok: true, status: 200, data: [{ id: 'mar', date: '2026-03-10', v: 30 }] }),
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
        from: '2026-03-01', to: '2026-03-31',
      });
      const afterNarrow = await dated.readAll();
      check('narrow read does NOT truncate the wider cache (3 rows survive)', afterNarrow.length === 3);
      check('narrow read refreshed the row inside its window (v=30)',
        afterNarrow.find((r) => r.id === 'mar')?.v === 30);
      check('rows outside the fetched window are untouched (jan v=1)',
        afterNarrow.find((r) => r.id === 'jan')?.v === 1);

      // A row deleted server-side, inside the fetched window, is evicted; outside it, preserved.
      await readWindowThrough<Row>({
        fetch: async () => ({ ok: true, status: 200, data: [] }),
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
        from: '2026-03-01', to: '2026-03-31',
      });
      const afterDelete = await dated.readAll();
      check('a row that vanished from INSIDE the window is evicted', !afterDelete.some((r) => r.id === 'mar'));
      check('rows OUTSIDE the window survive that eviction', afterDelete.length === 2);

      // Offline: the mirror answers, filtered to the window and sorted oldest-first.
      const offline = await readWindowThrough<Row>({
        fetch: async () => { throw new Error('offline'); },
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
        from: '2026-01-01', to: '2026-12-31',
      });
      check('offline read reports source=mirror', offline.source === 'mirror');
      check('offline read filters to the window + sorts oldest-first',
        offline.rows.map((r) => r.id).join(',') === 'jan,feb');
      check('offline read of a primed mirror reports primed', offline.primed);

      // A non-ok response (not a throw) also falls back — a 500 must not blank the screen.
      const errored = await readWindowThrough<Row>({
        fetch: async () => ({ ok: false, status: 500, data: null }),
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
      });
      check('a non-ok response falls back to the mirror too', errored.source === 'mirror' && errored.rows.length === 2);

      // The never-primed case — an EMPTY window on a primed mirror must stay distinguishable from a mirror
      // that has never held anything. Conflating them is what makes a surface claim the user has no history.
      const emptyWindowPrimed = await readWindowThrough<Row>({
        fetch: async () => { throw new Error('offline'); },
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
        from: '2030-01-01', to: '2030-12-31',
      });
      check('an empty window on a primed mirror is still primed',
        emptyWindowPrimed.rows.length === 0 && emptyWindowPrimed.primed);

      await dated.clear();
      const neverPrimed = await readWindowThrough<Row>({
        fetch: async () => { throw new Error('offline'); },
        mirror: dated, keyOf: (r) => r.id, dateOf: (r) => r.date,
      });
      check('a never-primed mirror reports primed=false',
        neverPrimed.rows.length === 0 && !neverPrimed.primed);

      // keyOf and dateOf are deliberately separate: this collection keys by date (one row per day), the one
      // above keyed by id. Collapsing them would break whichever case it wasn't written for.
      const byDay = new MirrorStore<{ date: string; n: number }>({ dbName: 'pg_window_smoke_day', storeName: 'days', keyPath: 'date' });
      await byDay.clear();
      await readWindowThrough<{ date: string; n: number }>({
        fetch: async () => ({ ok: true, status: 200, data: [{ date: '2026-05-01', n: 7 }] }),
        mirror: byDay, keyOf: (r) => r.date, dateOf: (r) => r.date,
      });
      check('keyOf === dateOf works for a one-row-per-day collection', (await byDay.readAll()).length === 1);

      // syncWindow standalone — the merge without the fetch, for a caller that fetched on its own.
      await syncWindow(byDay, [{ date: '2026-05-02', n: 8 }], (r) => r.date, (r) => r.date, '2026-05-02', '2026-05-02');
      const merged = (await byDay.readAll()).map((r) => r.date).sort().join(',');
      check('syncWindow standalone merges without touching rows outside its window', merged === '2026-05-01,2026-05-02');

      await dated.clear();
      await byDay.clear();
    }

    // TASK-116 — the classified collection read (createListMirror / readAllClassifiedThrough / peekList).
    //
    // The behaviour under test is the one `readAllThrough` CANNOT express: it returns `T[]`, so a device that
    // has never synced and an account with nothing recorded both answer `[]`. Any screen that says something
    // about emptiness then tells one of them something false. The distinction is only detectable because the
    // cache is one wrapper row — an entity-keyed store has nowhere to record "a fetch succeeded and returned
    // nothing" — which is why the mirror factory and the read ship together.
    {
      interface Item { id: string; v: number }
      const list = createListMirror<Item>({ dbName: 'pg_classified_smoke', storeName: 'rows' });
      await list.clear();

      // Never synced: NOT an empty list.
      const cold = await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: false, status: 0, data: null }), mirror: list,
      });
      check('never synced reads as unavailable, not as empty', cold.state === 'unavailable');
      check('peekList is undefined before anything is cached', (await peekList(list)) === undefined);

      // A successful read caches and reports its source.
      const online = await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: true, status: 200, data: [{ id: 'a', v: 1 }] }), mirror: list,
      });
      check('server read is loaded/server', online.state === 'loaded' && online.source === 'server');
      check('server read returns its items', online.state === 'loaded' && online.items.length === 1);

      // Offline afterwards: the cache answers, and says so.
      const offline = await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: false, status: 0, data: null }), mirror: list,
      });
      check('offline after a sync is loaded/mirror', offline.state === 'loaded' && offline.source === 'mirror');
      check('peekList returns the cached items without a fetch', (await peekList(list))?.length === 1);

      // THE case the whole primitive exists for: a successful read of an EMPTY collection must stay a real
      // answer offline — "nothing recorded", not "never synced".
      await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: true, status: 200, data: [] }), mirror: list,
      });
      const emptyOffline = await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: false, status: 0, data: null }), mirror: list,
      });
      check('a synced-but-empty list stays loaded offline (NOT unavailable)',
        emptyOffline.state === 'loaded' && emptyOffline.items.length === 0);
      check('peekList distinguishes synced-empty ([]) from never-synced (undefined)',
        Array.isArray(await peekList(list)));

      // A transient server error must not make a synced device claim it never synced.
      const flaky = await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: false, status: 500, data: null }), mirror: list,
      });
      check('a 500 with a cached row falls back to the mirror, not to unavailable',
        flaky.state === 'loaded' && flaky.source === 'mirror');

      // A thrown fetch (hard offline) behaves as a miss, not an exception.
      const threw = await readAllClassifiedThrough<Item>({
        fetch: async () => { throw new Error('network'); }, mirror: list,
      });
      check('a thrown fetch falls back to the mirror', threw.state === 'loaded' && threw.source === 'mirror');

      // The key override exists ONLY so an existing cache can be adopted — a different key must read as a
      // different (never-synced) store rather than silently sharing rows.
      const adopted = createListMirror<Item>({ dbName: 'pg_classified_smoke', storeName: 'rows', key: 'legacy' });
      const adoptedRead = await readAllClassifiedThrough<Item>({
        fetch: async () => ({ ok: false, status: 0, data: null }), mirror: adopted,
      });
      check('a mirror on a different key does not see the default key row',
        adoptedRead.state === 'unavailable');

      await list.clear();
    }

    // TASK-122 — `hidden` must survive a page's own `display` rule.
    //
    // The UA's [hidden] rule and a class selector share specificity (0,1,0), and a page's styles are
    // concatenated AFTER BasePage's, so source order hands the win to the page. This shipped a real defect:
    // a form field the code believed was hidden stayed on screen, and a four-week date range was recorded as
    // one day with a success message. The assertion is on COMPUTED display — an attribute check was green all
    // the way through that bug, which is exactly why it survived to a device.
    {
      class PgHiddenPage extends BasePage {
        static get styles(): string {
          // The shape that caused it: an author display rule on a class, after the base styles.
          return super.styles + ' .field { display: flex; }';
        }
        protected renderContent(): string {
          return '<div class="field" id="pg-plain">plain</div>'
            + '<div class="field" id="pg-hidden" hidden>hidden</div>';
        }
      }
      customElements.define('pg-hidden-page', PgHiddenPage);

      const page = document.createElement('pg-hidden-page');
      document.body.appendChild(page);
      await new Promise((r) => setTimeout(r, 0));

      const root = (page as HTMLElement).shadowRoot;
      const plain = root?.getElementById('pg-plain');
      const hidden = root?.getElementById('pg-hidden');
      check('premise: the page display rule applies to a plain element',
        !!plain && getComputedStyle(plain).display === 'flex');
      check('an element marked hidden computes to display:none despite the page rule',
        !!hidden && getComputedStyle(hidden).display === 'none');

      page.remove();
    }

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

    // TASK-977 — a write the sync layer gave up on (`deadCount`) outranks the other states: a red button reading
    // "N not saved" that dispatches `b-sync-dead`, so the chip no longer clears the moment a write dies.
    {
      let notifyDead: (n: number) => void = () => {};
      let deadPending = 0;
      let dead = 0;
      const deadSource: SyncSource = {
        get pendingCount() { return deadPending; },
        get deadCount() { return dead; },
        onChange(fn) { notifyDead = fn; return () => {}; },
      };
      const deadChip = document.createElement('b-sync-status') as BSyncStatus;
      document.body.appendChild(deadChip);
      deadChip.bind(deadSource);
      await new Promise((r) => setTimeout(r, 0));
      const button = () => deadChip.shadowRoot?.querySelector('button.dead') as HTMLButtonElement | null;
      check('dead chip: no button while nothing is dead', !!button() && button()!.hidden && deadChip.hasAttribute('hidden'));
      dead = 2;
      deadPending = 1;
      notifyDead(1);
      await new Promise((r) => setTimeout(r, 0));
      check(`dead chip: shown online, reading "${button()?.textContent}"`,
        !deadChip.hasAttribute('hidden') && !button()!.hidden && button()!.textContent === '2 not saved');
      check('dead chip: the syncing state still shows beside it', !(deadChip.shadowRoot?.querySelector('.chip') as HTMLElement).hidden
        && (deadChip.shadowRoot?.querySelector('.chip')?.textContent ?? '').includes('1'));
      let fired: { count: number } | null = null;
      document.body.addEventListener('b-sync-dead', (e) => { fired = (e as CustomEvent<{ count: number }>).detail; }, { once: true });
      button()!.click();
      check(`dead chip: a tap dispatches b-sync-dead with the count (${JSON.stringify(fired)})`,
        (fired as { count: number } | null)?.count === 2);
      dead = 0;
      notifyDead(1);
      await new Promise((r) => setTimeout(r, 0));
      check('dead chip: back to syncing once nothing is dead', button()!.hidden
        && (deadChip.shadowRoot?.querySelector('.chip')?.textContent ?? '').includes('1'));
      deadChip.remove();
    }

    // TASK-150 — `Surface.alsoMatches`: a surface can claim a route outside its own subtree, for the nav
    // highlight only. Found in Reps, whose exercise library sits at a top-level `/library` reached from the Plans
    // surface: the exact-or-nested rule could not attribute it, so it fell to the root catch-all and every visit
    // highlighted *Today*. Moving the route under `/plans` would have fixed it and broken existing deep links.
    //
    // Asserted here rather than in the framework repo because there is no in-framework JS unit runner — the same
    // reason `readWindowThrough` et al. are checked in this file.
    const navSurfaces: Surface[] = [
      { id: 'home', route: '/', icon: '⌂', label: 'Home' },
      { id: 'plans', route: '/plans', icon: '🗂', label: 'Plans', alsoMatches: ['/library'] },
    ];
    const claims = (hash: string) => activeSurface(hash, navSurfaces)?.id;
    check('alsoMatches claims the sibling route', claims('#/library') === 'plans');
    check('alsoMatches covers its subtree', claims('#/library/new') === 'plans'
      && claims('#/library/abc-123') === 'plans');
    check('the surface still owns its own route', claims('#/plans') === 'plans'
      && claims('#/plans/new') === 'plans');
    check('an unclaimed route still falls to the root', claims('#/somewhere-else') === 'home');
    // A prefix that is not a path boundary must NOT match: `/librarian` is a different route entirely, and a naive
    // `startsWith('/library')` would hand it to Plans.
    check('alsoMatches does not match a mere string prefix', claims('#/librarian') === 'home');
    // First match wins, in array order — deterministic rather than an error, since a duplicated claim is a
    // highlight mistake and throwing would take the whole app down over one.
    // The root surface is here to make the check falsifiable, not for realism: with only the two claimants the
    // last-resort fallback is `surfaces[0]`, which is ALSO 'a', so the check passed with `alsoMatches` reverted
    // and pinned nothing. With a root present the unfixed answer is 'root'.
    check('a doubly-claimed route resolves to the earlier surface', activeSurface('#/library', [
      { id: 'root', route: '/', label: 'R' },
      { id: 'a', route: '/a', label: 'A', alsoMatches: ['/library'] },
      { id: 'b', route: '/b', label: 'B', alsoMatches: ['/library'] },
    ])?.id === 'a');

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
    // Birko TASK-930 — the top bar adds the top safe-area inset to its height AND pads by it, which only works as
    // border-box; reset.css's `*` rule does not reach the shadow DOM, so it was content-box and counted the inset twice
    // (iPhone, iOS 27.2, viewport-fit=cover: 42 + 50 + 50 = 143). env() cannot be emulated, so substitute a 50px inset.
    {
      const topbar = shell.shadowRoot?.querySelector<HTMLElement>('.mobile-topbar');
      const before = topbar?.getBoundingClientRect().height ?? 0;
      const probe = document.createElement('style');
      probe.textContent = '.mobile-topbar{height:calc(var(--b-header-height,3rem) + 50px)!important;padding-top:50px!important}';
      shell.shadowRoot?.append(probe);
      const after = topbar?.getBoundingClientRect().height ?? 0;
      probe.remove();
      check(`mobile shell top bar is border-box (${topbar ? getComputedStyle(topbar).boxSizing : 'missing'})`,
        !!topbar && getComputedStyle(topbar).boxSizing === 'border-box');
      check(`mobile shell top bar grows by the inset once, not twice (+${Math.round(after - before)}px for a 50px inset)`,
        Math.round(after - before) === 50);
    }
    shell.remove();
    window.location.hash = prevHash;

    // TASK-035 — client SW registration is best-effort: a missing SW script must resolve to null,
    // never throw (localhost is a secure context, so serviceWorker is available in the verify run).
    const reg = await registerServiceWorker('/no-such-sw-smoke.js');
    check('registerServiceWorker best-effort → null on missing script', reg === null);

    // ── STORY-026 medium-findings regression (CR-M256…M266 web track) ──────────

    // CR-M261 — I18n restores the persisted locale on construction (was write-only before).
    localStorage.setItem('pg_m261_locale', 'sk');
    check('M261 i18n restores persisted locale', new I18n({ defaultLocale: 'en', storageKey: 'pg_m261_locale' }).locale === 'sk');
    localStorage.removeItem('pg_m261_locale');
    check('M261 i18n falls back to default when nothing persisted', new I18n({ defaultLocale: 'en', storageKey: 'pg_m261_locale' }).locale === 'en');

    // CR-M262 — persisted signals use the framework-neutral 'birko_' prefix, not 'symbio_', and
    // setPersistPrefix() overrides it.
    const sig = signal(0, { persist: 'pg_m262_key' });
    sig.value = 42;
    check('M262 signal persists under birko_ prefix (not symbio_)',
      localStorage.getItem('birko_pg_m262_key') === '42' && localStorage.getItem('symbio_pg_m262_key') === null);
    localStorage.removeItem('birko_pg_m262_key');
    setPersistPrefix('pgtest_');
    const sig2 = signal(0, { persist: 'pg_m262_k2' });
    sig2.value = 7;
    check('M262 setPersistPrefix overrides the namespace', localStorage.getItem('pgtest_pg_m262_k2') === '7');
    localStorage.removeItem('pgtest_pg_m262_k2');
    setPersistPrefix('birko_'); // restore default so nothing else is disturbed

    // CR-M260 — SyncManager.dispose() unregisters the window 'online' listener (was leaked).
    let getPendingCalls = 0;
    const fakeQueue = {
      pendingCount: 0,
      getPending: async () => { getPendingCalls++; return []; },
      getDead: async () => [], // TASK-581: sync() reads the dead actions first, to hold their entities
      getAll: async () => [],  // TASK-598: and the `syncing` ones a closed tab left behind
      update: async () => {},
      remove: async () => {},
    } as unknown as ConstructorParameters<typeof SyncManager>[0];
    const sm = new SyncManager(fakeQueue, {} as ConstructorParameters<typeof SyncManager>[1], { syncInterval: 1_000_000, locks: null });   // TASK-598: no drain lock, whose acquisition outlasts the setTimeout(0) below
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));
    const callsWhileLive = getPendingCalls;
    sm.dispose();
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 0));
    check('M260 SyncManager syncs on online while live', callsWhileLive >= 1);
    check('M260 SyncManager dispose() unregisters online listener', getPendingCalls === callsWhileLive);

    // CR-M258 — b-tree-menu emits load-error (no unhandled rejection) when lazy onExpand rejects.
    if (!customElements.get('b-tree-menu')) define('b-tree-menu', BTreeMenu);
    const tree = document.createElement('b-tree-menu') as BTreeMenu;
    document.body.appendChild(tree);
    let loadErrorFired = false;
    tree.addEventListener('load-error', () => { loadErrorFired = true; });
    tree.setConfig({ items: [{ id: 'n1', label: 'Node 1' }], onExpand: async () => { throw new Error('boom'); } });
    // Before the fix this rejected (unhandled) out of the async toggle(); reaching the check proves
    // the rejection is now caught.
    await tree.toggle('n1');
    await new Promise((r) => setTimeout(r, 0));
    check('M258 b-tree-menu emits load-error on rejecting onExpand', loadErrorFired);
    tree.remove();

    // ── Test-gap coverage (CR-M259/M263/M266) — highest-risk pure functions the findings name ──

    // CR-M263 (Web.Core) — unwrapList / apiErrorMessage / I18n resolution + plural
    const resp = <D>(data: D) => ({ ok: true, status: 200, data }) as Parameters<typeof unwrapList>[0];
    check('M263 unwrapList raw array', unwrapList(resp([1, 2, 3])).length === 3);
    check('M263 unwrapList paged envelope', unwrapList(resp({ items: [1, 2], totalCount: 2, page: 1, pageSize: 10 })).length === 2);
    check('M263 unwrapList keyed override', unwrapList(resp({ results: [1] }), 'results').length === 1);
    check('M263 unwrapList null → []', unwrapList(resp(null)).length === 0);
    check('M263 apiErrorMessage ProblemDetails detail>title', apiErrorMessage({ title: 'T', detail: 'D' }) === 'D');
    check('M263 apiErrorMessage error.message', apiErrorMessage({ error: { message: 'boom' } }) === 'boom');
    check('M263 apiErrorMessage plain string', apiErrorMessage('oops') === 'oops');
    check('M263 apiErrorMessage fallback', apiErrorMessage(null, 'fb') === 'fb');
    const i18nP = new I18n({ defaultLocale: 'en' });
    i18nP.addMessages('en', { items: { one: '{count} item', other: '{count} items' } });
    check('M263 i18n plural one', i18nP.t('items', { count: 1 }) === '1 item');
    check('M263 i18n plural other', i18nP.t('items', { count: 5 }) === '5 items');
    check('M263 i18n missing key falls back to key', i18nP.t('nope.missing') === 'nope.missing');

    // CR-M259 (Web.Components) — BMarkdownEditor.renderMarkdown + b-pagination page-number logic
    check('M259 renderMarkdown heading', BMarkdownEditor.renderMarkdown('# Title').includes('<h1>Title</h1>'));
    check('M259 renderMarkdown escapes HTML (XSS-safe)', BMarkdownEditor.renderMarkdown('<script>x</script>').includes('&lt;script&gt;'));
    check('M259 renderMarkdown empty → <p></p>', BMarkdownEditor.renderMarkdown('') === '<p></p>');
    if (!customElements.get('b-pagination')) define('b-pagination', BPagination);
    const pg = document.createElement('b-pagination');
    pg.setAttribute('total-pages', '10');
    pg.setAttribute('page', '5');
    document.body.appendChild(pg);
    await new Promise((r) => setTimeout(r, 0));
    const pageNums = [...(pg.shadowRoot?.querySelectorAll('.page-btn') ?? [])].map((b) => b.getAttribute('data-page'));
    check('M259 pagination shows first + current + last',
      pageNums.includes('1') && pageNums.includes('5') && pageNums.includes('10'));
    check('M259 pagination collapses middle with ellipsis', !!pg.shadowRoot?.querySelector('.ellipsis'));
    pg.remove();

    // STORY-065 / TASK-208 (Web.Components) — b-confirm-dialog stored-XSS fix. The dialog used to
    // interpolate its caller-supplied `message`/`title` straight into innerHTML, so a confirm built
    // from user data (e.g. a member's username) was a stored/reflected-XSS sink. The message/title
    // now render as TEXT by default (matching the alert/prompt helpers), with an explicit
    // `message-html` opt-in for trusted, developer-authored markup. If the payload below ever
    // executed, its onerror would flip `__xssConfirm` to 1 — the check asserts it stays 0.
    const xssWin = window as unknown as { __xssConfirm?: number };
    xssWin.__xssConfirm = 0;
    const XSS = '<img src=x onerror="window.__xssConfirm=1">';

    // (a) component default — renders as text: no <img> node created, literal payload preserved.
    const cd = document.createElement('b-confirm-dialog');
    cd.setAttribute('message', XSS);
    document.body.appendChild(cd);
    await new Promise((r) => setTimeout(r, 0));
    const cdBody = cd.shadowRoot?.querySelector('.dialog-body');
    check('STORY-065 confirm-dialog renders message as text (no <img> node)', !cdBody?.querySelector('img'));
    check('STORY-065 confirm-dialog preserves the literal payload as text', (cdBody?.textContent ?? '') === XSS);
    cd.remove();

    // (b) explicit opt-in — `message-html` renders trusted markup as real DOM.
    const cdHtml = document.createElement('b-confirm-dialog');
    cdHtml.setAttribute('message', '<b>bold</b>');
    cdHtml.setAttribute('message-html', '');
    document.body.appendChild(cdHtml);
    await new Promise((r) => setTimeout(r, 0));
    check('STORY-065 confirm-dialog message-html opt-in renders real markup',
      !!cdHtml.shadowRoot?.querySelector('.dialog-body b'));
    cdHtml.remove();

    // (c) the confirm() helper is safe by default — no caller change required.
    const helperPromise = dlgConfirm(XSS); // fire-and-forget; inspect the element it created, then cancel it
    await new Promise((r) => setTimeout(r, 20));
    // The gallery also hosts a b-confirm-dialog — pick the helper's by its unique message payload.
    const helperEl = [...document.querySelectorAll('b-confirm-dialog')]
      .find((el) => el.getAttribute('message') === XSS);
    const helperBody = helperEl?.shadowRoot?.querySelector('.dialog-body');
    check('STORY-065 confirm() helper escapes user message by default',
      !!helperBody && !helperBody.querySelector('img') && (helperBody.textContent ?? '') === XSS);
    (helperEl?.shadowRoot?.querySelector('.btn-cancel') as HTMLElement | undefined)?.click();
    check('STORY-065 confirm-dialog XSS payload never executed', xssWin.__xssConfirm === 0);
    // Cancel resolves the helper; race a timeout so a wiring change can never hang the harness.
    await Promise.race([helperPromise, new Promise((r) => setTimeout(r, 500))]);

    // CR-M266 (Web.Shell) — permissions wildcard + module hash resolution
    const modWild = { id: 'a', label: 'A', icon: '', order: 0, permissions: ['*'],
      options: [{ id: 'o1', label: 'O1', route: '/a/o1' }, { id: 'o2', label: 'O2', route: '/a/o2', permission: 'a.secret' }] };
    const modLimited = { ...modWild, permissions: ['a.read'] };
    check('M266 getVisibleOptions wildcard returns all', getVisibleOptions(modWild).length === 2);
    check('M266 getVisibleOptions filters unpermitted option', getVisibleOptions(modLimited).length === 1);
    const shellStore = new Store({ modules: [modWild], activeModuleId: 'a', activeOptionId: null });
    check('M266 hasPermission wildcard grants any', hasPermission(shellStore, 'anything'));

    // TASK-140 (Web.Shell) — resolveModuleFromHash reads the DECLARED option routes in store.modules. It used to split
    // the hash by position and write parts[0] unconditionally, so /settings set activeModuleId='settings' (no such
    // module). The first two checks are back-compat (pass either way); the rest fail on the positional resolver.
    const opt = (id: string, route: string) => ({ id, label: id, route });
    const routeStore = new Store({
      modules: [
        { id: 'inventory', label: 'Inventory', icon: '', order: 0, permissions: ['*'],
          options: [opt('stock', '/inventory/stock'), opt('archive', '/inventory/stock/archive')] },
        { id: 'crm', label: 'CRM', icon: '', order: 1, permissions: ['*'], options: [opt('leads', '/sales/leads')] },
      ],
      activeModuleId: null as string | null, activeOptionId: null as string | null,
    });
    const conv = resolveModuleFromHash(routeStore, '/inventory/stock/42');
    check('M266 resolveModuleFromHash parses module/option/entity (back-compat)',
      conv.moduleId === 'inventory' && conv.optionId === 'stock' && conv.entityId === '42');
    check('M266 resolveModuleFromHash updates store (back-compat)',
      routeStore.get('activeModuleId') === 'inventory' && routeStore.get('activeOptionId') === 'stock');
    const unmatched = resolveModuleFromHash(routeStore, '/settings');
    check(`TASK-140 unmatched /settings is unresolved, store cleared (resolved=${unmatched.resolved}, activeModuleId=${routeStore.get('activeModuleId')})`,
      !unmatched.resolved && unmatched.moduleId === '' && routeStore.get('activeModuleId') === null && routeStore.get('activeOptionId') === null);
    const declared = resolveModuleFromHash(routeStore, '/sales/leads/7');
    check(`TASK-140 non-conventional declared route resolves to its module (got ${declared.moduleId}/${declared.optionId}/${declared.entityId})`,
      declared.moduleId === 'crm' && declared.optionId === 'leads' && declared.entityId === '7' && routeStore.get('activeModuleId') === 'crm');
    const longest = resolveModuleFromHash(routeStore, '/inventory/stock/archive');
    check(`TASK-140 longest declared route wins (got option ${longest.optionId}, entity ${longest.entityId})`,
      longest.optionId === 'archive' && longest.entityId === undefined);
    const withQuery = resolveModuleFromHash(routeStore, '/inventory/stock?tab=2');
    check(`TASK-140 query string is not part of the option (got ${withQuery.optionId})`, withQuery.optionId === 'stock');
    const moduleOnly = resolveModuleFromHash(routeStore, '/inventory');
    check('TASK-140 bare module id resolves the module with no option (back-compat)',
      moduleOnly.moduleId === 'inventory' && routeStore.get('activeOptionId') === null);
    const noModules = new Store({ modules: [], activeModuleId: 'stale' as string | null, activeOptionId: null as string | null });
    check('TASK-140 nothing loaded yet resolves nothing and clears the stale id',
      !resolveModuleFromHash(noModules, '/inventory/stock').resolved && noModules.get('activeModuleId') === null);

    // TASK-543 (Web.Components) — b-code-block re-renders when its light-DOM text changes. A parent's morph keeps the
    // element (attributes unchanged) and swaps only the text node; render() ran on attribute changes only, so the block
    // kept the previous code (Presenter, FIELD-021). The first check drives the real morph through a BaseComponent host.
    const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const shown = (el: Element | null | undefined) => el?.shadowRoot?.querySelector('code')?.textContent ?? '<none>';
    class CodeHost extends BaseComponent {
      text = 'var first = 1;';
      render() { return `<b-code-block language="csharp">${this.text}</b-code-block>`; }
      swap(t: string) { this.text = t; this.update(); }
    }
    define('smoke-code-host', CodeHost);
    const host = document.createElement('smoke-code-host') as CodeHost;
    document.body.appendChild(host);
    await settle();
    const morphed = host.shadowRoot?.querySelector('b-code-block');
    host.swap('var second = 2;');
    await settle();
    const sameEl = host.shadowRoot?.querySelector('b-code-block') === morphed;
    check(`TASK-543 parent morph keeps the element and the block shows the new code (same element=${sameEl}, shows "${shown(morphed)}")`,
      sameEl && shown(morphed).includes('second') && !shown(morphed).includes('first'));
    host.remove();

    const block = document.createElement('b-code-block');
    block.setAttribute('language', 'csharp');
    block.textContent = 'var a = 1;';
    document.body.appendChild(block);
    await settle();
    (block.firstChild as Text).data = 'var b = 2;';
    await settle();
    check(`TASK-543 in-place text edit re-renders (shows "${shown(block)}")`, shown(block) === 'var b = 2;');
    check('TASK-543 copy uses the current code', (block as unknown as { _code: string })._code === 'var b = 2;');
    block.setAttribute('code', 'from attr');
    await settle();
    block.textContent = 'var c = 3;';
    await settle();
    check(`TASK-543 (contract pin) the code attribute keeps precedence over text (shows "${shown(block)}")`, shown(block) === 'from attr');
    block.removeAttribute('code');
    await settle();
    let rendersAfterRemove = 0;
    block.remove();
    const blockUpdate = (block as unknown as { update: () => void });
    const realUpdate = blockUpdate.update.bind(block);
    blockUpdate.update = () => { rendersAfterRemove++; realUpdate(); };
    block.textContent = 'var detached = 4;';
    await settle();
    check(`TASK-543 (contract pin) a disconnected block does not observe (renders=${rendersAfterRemove})`, rendersAfterRemove === 0);

    // CR-L392 (Web.Components) — moveCard with an implicit target index reports the TRUE landing
    // index in the emitted event (regression: precedence bug made it `findIndex(...) - 1`, one too
    // low). The same toIndex expression feeds both the cross-column card-move and the same-column
    // card-reorder branches, so assert both.
    if (!customElements.get('b-kanban')) define('b-kanban', BKanban);
    const kanban = document.createElement('b-kanban') as BKanban;
    document.body.appendChild(kanban);
    kanban.setConfig({
      columns: [{ id: 'todo', label: 'Todo' }, { id: 'done', label: 'Done' }],
      cards: [
        { id: 'c1', columnId: 'todo', title: 'One' },
        { id: 'c2', columnId: 'todo', title: 'Two' },
        { id: 'c3', columnId: 'done', title: 'Three' },
      ],
    });
    let reorderToIndex: number | undefined;
    let moveToIndex: number | undefined;
    kanban.addEventListener('card-reorder', (e) => { reorderToIndex = (e as CustomEvent).detail.toIndex; });
    kanban.addEventListener('card-move', (e) => { moveToIndex = (e as CustomEvent).detail.toIndex; });
    // Same-column reorder: move c1 to the end of 'todo' with no explicit index → lands after c2, true index 1.
    kanban.moveCard('c1', 'todo');
    check('CR-L392 card-reorder implicit index reports true landing position', reorderToIndex === 1);
    // Cross-column move: move c1 into 'done' with no explicit index → lands after c3, true index 1.
    kanban.moveCard('c1', 'done');
    check('CR-L392 card-move implicit index reports true landing position', moveToIndex === 1);
    kanban.remove();

    // CR-L395 (Web.Core) — ApiClient token-refresh retry: onUnauthorized fires only on an explicit
    // 401, NOT when the post-refresh retry hits a network error (refresh succeeded → transient blip,
    // logging out would be wrong).
    const realFetch = globalThis.fetch;
    try {
      // (a) 401 → refresh succeeds → retry throws (network) → NO logout, status 0.
      let unauthorizedA = false;
      let callA = 0;
      globalThis.fetch = (async () => {
        callA += 1;
        if (callA === 1) return new Response('', { status: 401 });
        throw new TypeError('network down');
      }) as typeof fetch;
      const clientA = new ApiClient({
        baseUrl: 'https://smoke.test',
        getToken: () => 'stale',
        onRefreshToken: async () => 'fresh',
        onUnauthorized: () => { unauthorizedA = true; },
      });
      const respA = await clientA.get('items');
      check('CR-L395 retry network error does not trigger onUnauthorized', !unauthorizedA && respA.status === 0);

      // (b) 401 → refresh succeeds → retry still 401 (token rejected) → logout fires.
      let unauthorizedB = false;
      globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;
      const clientB = new ApiClient({
        baseUrl: 'https://smoke.test',
        getToken: () => 'stale',
        onRefreshToken: async () => 'fresh',
        onUnauthorized: () => { unauthorizedB = true; },
      });
      await clientB.get('items');
      check('CR-L395 explicit 401 after refresh triggers onUnauthorized', unauthorizedB);

      // CR-L398 (Web.Shell) — entity-search provider tolerates an ok response with a null/non-array
      // body (returns [] instead of throwing on resp.data.map).
      globalThis.fetch = (async () =>
        new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
      const searchClient = new ApiClient({ baseUrl: 'https://smoke.test' });
      const provider = createEntitySearchProvider({
        moduleId: 'widgets', moduleLabel: 'Widgets', icon: '', apiClient: searchClient,
      });
      let searchResult: unknown[] | 'threw';
      try {
        searchResult = await provider.search('ab');
      } catch {
        searchResult = 'threw';
      }
      check('CR-L398 entity-search null body returns [] (no throw)',
        Array.isArray(searchResult) && searchResult.length === 0);

      // TASK-493 (Web.Core) — `getHeaders` and `patch()`. The hook exists so a same-origin BFF can send
      // `X-CSRF-TOKEN` on every request without dropping ApiClient for a hand-rolled fetch (which would
      // lose the timeout, offline queue and refresh handling — FlowerFurStudio TASK-067). `patch()` was
      // simply absent.
      const seen: { method: string; headers: Headers; body: string | null }[] = [];
      const recordFetch = (make: () => Response) => {
        globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
          seen.push({
            method: init?.method ?? 'GET',
            headers: new Headers(init?.headers),
            body: (init?.body as string | undefined) ?? null,
          });
          return make();
        }) as typeof fetch;
      };
      const okJson = () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

      // (a) A sync getHeaders hook reaches a GET.
      seen.length = 0;
      recordFetch(okJson);
      const withHeaders = new ApiClient({
        baseUrl: 'https://smoke.test',
        getHeaders: () => ({ 'X-CSRF-TOKEN': 'abc' }),
      });
      await withHeaders.get('items');
      check('TASK-493 getHeaders: a custom header is sent on a GET',
        seen[0]?.headers.get('X-CSRF-TOKEN') === 'abc');

      // (b) It reaches the post-refresh RETRY too (the retry reuses the header bag the hook filled).
      seen.length = 0;
      let refreshCall = 0;
      globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
        seen.push({ method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: null });
        refreshCall += 1;
        return refreshCall === 1 ? new Response('', { status: 401 }) : okJson();
      }) as typeof fetch;
      const retryHeaders = new ApiClient({
        baseUrl: 'https://smoke.test',
        getToken: () => 'stale',
        onRefreshToken: async () => 'fresh',
        getHeaders: () => ({ 'X-CSRF-TOKEN': 'retry-abc' }),
      });
      await retryHeaders.get('items');
      check('TASK-493 getHeaders: sent on the first attempt', seen[0]?.headers.get('X-CSRF-TOKEN') === 'retry-abc');
      check('TASK-493 getHeaders: sent on the retry after a token refresh', seen[1]?.headers.get('X-CSRF-TOKEN') === 'retry-abc');

      // (c) Async hook — a consumer that must fetch its token lazily.
      seen.length = 0;
      recordFetch(okJson);
      const lazy = new ApiClient({
        baseUrl: 'https://smoke.test',
        getHeaders: async () => ({ 'X-CSRF-TOKEN': 'lazy' }),
      });
      await lazy.get('items');
      check('TASK-493 getHeaders: an async hook is awaited before the fetch',
        seen[0]?.headers.get('X-CSRF-TOKEN') === 'lazy');

      // (d) Precedence: the hook cannot clobber the framework's own auth/tenant headers.
      seen.length = 0;
      recordFetch(okJson);
      const precedence = new ApiClient({
        baseUrl: 'https://smoke.test',
        getToken: () => 'real',
        getTenant: () => 'tenant-1',
        getHeaders: () => ({ Authorization: 'Bearer bogus', 'X-Tenant-Id': 'evil' }),
      });
      await precedence.get('items');
      check('TASK-493 getHeaders: cannot override Authorization',
        seen[0]?.headers.get('Authorization') === 'Bearer real');
      check('TASK-493 getHeaders: cannot override X-Tenant-Id',
        seen[0]?.headers.get('X-Tenant-Id') === 'tenant-1');

      // (e) patch() issues PATCH with the JSON body, and is queueable like put().
      seen.length = 0;
      recordFetch(okJson);
      const patcher = new ApiClient({ baseUrl: 'https://smoke.test' });
      await patcher.patch('items/7', { name: 'x' });
      check('TASK-493 patch(): issues a PATCH request', seen[0]?.method === 'PATCH');
      check('TASK-493 patch(): sends the JSON body with Content-Type',
        seen[0]?.headers.get('Content-Type') === 'application/json' && seen[0]?.body === '{"name":"x"}');

      let queuedMethod = '';
      globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
      const patchWriter = new ApiClient({
        baseUrl: 'https://smoke.test',
        onQueueAction: async (method) => { queuedMethod = method; return 'q1'; },
      });
      const queuedPatch = await patchWriter.patch('items/7', { name: 'x' }, { moduleId: 'm', description: 'd' });
      check('TASK-493 patch(): a failed PATCH is queued for retry, not lost',
        queuedPatch.queued === true && queuedMethod === 'PATCH');
    } finally {
      globalThis.fetch = realFetch;
    }

    // TASK-508 (Web.Core) — `postForm`, the multipart upload (Symbio TASK-839's product photos). It has to live on
    // ApiClient rather than in the consumer because of the shared `_refreshPromise`: refresh tokens rotate, so a
    // second, independent refresh flow redeems a token the first already spent and `onUnauthorized` logs the user
    // out. Every await below is bounded — two of the checks are about a request that must NOT settle yet.
    {
      const realFetch5 = globalThis.fetch;
      const realSetTimeout = globalThis.setTimeout;
      const PENDING = Symbol('pending');
      const settleWithin = async <R>(p: Promise<R>, ms: number): Promise<R | typeof PENDING> =>
        Promise.race([p, new Promise<typeof PENDING>((r) => realSetTimeout(() => r(PENDING), ms))]);
      const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
      const neverAnswers = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) rej(abortError());
        else signal.addEventListener('abort', () => rej(abortError()));
      })) as typeof fetch;
      const okJson = () => new Response('{"id":1}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      const sent: { url: string; method: string; headers: Headers; body: unknown }[] = [];
      const record = (answer: (auth: string | null) => Response) => {
        globalThis.fetch = (async (u: unknown, init?: RequestInit) => {
          const headers = new Headers(init?.headers);
          sent.push({ url: String(u), method: init?.method ?? 'GET', headers, body: init?.body });
          return answer(headers.get('Authorization'));
        }) as typeof fetch;
      };
      const makeForm = () => {
        const f = new FormData();
        f.append('file', new File(['png-bytes'], 'photo.png', { type: 'image/png' }));
        f.append('altText', 'Front view');
        return f;
      };

      try {
        // (a) Headers: no Content-Type from the client, and the framework's own headers all present.
        sent.length = 0;
        record(okJson);
        const uploader = new ApiClient({
          baseUrl: 'https://smoke.test',
          getToken: () => 'tok',
          getTenant: () => 'tenant-1',
          getHeaders: () => ({ 'Accept-Language': 'sk' }),
        });
        const form = makeForm();
        const rUp = await settleWithin(uploader.postForm<{ id: number }>('products/9/images/upload', form), 1500);
        check('TASK-508 postForm: POSTs the FormData itself as the body',
          sent[0]?.method === 'POST' && sent[0]?.body === form && sent[0]?.url === 'https://smoke.test/products/9/images/upload');
        check('TASK-508 postForm: sets NO Content-Type, so the browser can add the boundary',
          sent.length === 1 && !sent[0].headers.has('Content-Type'));
        // The half a mock cannot see on its own: what the browser then puts on the wire. A Request built from
        // the same init is what fetch builds, so this is where a stray 'multipart/form-data' with no boundary
        // (or a leftover 'application/json') would show.
        const wire = new Request('https://smoke.test/x', { method: 'POST', body: form, headers: sent[0]?.headers });
        check('...and the browser then sends multipart/form-data WITH a boundary',
          /^multipart\/form-data; boundary=/.test(wire.headers.get('Content-Type') ?? ''));
        check('TASK-508 postForm: Authorization, X-Tenant-Id and getHeaders all apply',
          sent[0]?.headers.get('Authorization') === 'Bearer tok'
          && sent[0]?.headers.get('X-Tenant-Id') === 'tenant-1'
          && sent[0]?.headers.get('Accept-Language') === 'sk');
        check('TASK-508 postForm: parses the JSON response like any other call',
          rUp !== PENDING && rUp.ok && rUp.data?.id === 1 && rUp.queued === undefined);

        // (b) 401 → one refresh → the retry resends the SAME FormData with the new token.
        sent.length = 0;
        let refreshes = 0;
        record((auth) => (auth === 'Bearer fresh' ? okJson() : new Response('', { status: 401 })));
        let loggedOut = false;
        const retrier = new ApiClient({
          baseUrl: 'https://smoke.test',
          getToken: () => 'stale',
          onRefreshToken: async () => { refreshes += 1; return 'fresh'; },
          onUnauthorized: () => { loggedOut = true; },
        });
        const retryForm = makeForm();
        const rRetry = await settleWithin(retrier.postForm('products/9/images/upload', retryForm), 1500);
        check('TASK-508 postForm: a 401 refreshes exactly once', refreshes === 1);
        check('TASK-508 postForm: the retry resends the same FormData with the new token',
          sent.length === 2 && sent[1].body === retryForm && sent[1].headers.get('Authorization') === 'Bearer fresh'
          && !sent[1].headers.has('Content-Type'));
        check('...and succeeds without logging the user out',
          rRetry !== PENDING && rRetry.ok && !loggedOut);

        // (c) The reason postForm is in the framework: an upload and a GET that both hit 401 at once must share
        // ONE refresh. Two refreshes redeem the same rotating token; the second fails and logs the user out.
        // The refresh is held open, so both 401s are guaranteed to arrive while it is in flight.
        sent.length = 0;
        let sharedRefreshes = 0;
        let spent = false;
        let concurrentLogout = false;
        record((auth) => (auth === 'Bearer fresh' ? okJson() : new Response('', { status: 401 })));
        const shared = new ApiClient({
          baseUrl: 'https://smoke.test',
          getToken: () => 'stale',
          // Models rotation: the first redemption succeeds, any later one is refused.
          onRefreshToken: async () => {
            sharedRefreshes += 1;
            await new Promise((r) => realSetTimeout(r, 40));
            if (spent) return null;
            spent = true;
            return 'fresh';
          },
          onUnauthorized: () => { concurrentLogout = true; },
        });
        const both = await settleWithin(
          Promise.all([shared.postForm('products/9/images/upload', makeForm()), shared.get('products/9/images')]),
          1500,
        );
        check('TASK-508 postForm: a concurrent 401 on an upload and a GET share ONE onRefreshToken call',
          sharedRefreshes === 1);
        check('...so both retries succeed and nobody is logged out',
          both !== PENDING && both[0].ok && both[1].ok && !concurrentLogout);

        // (d) Per-call timeout. It must win in BOTH directions over the client's own timeout: shorter aborts
        // into the status-0 envelope, longer keeps an upload alive past a short client default.
        globalThis.fetch = neverAnswers;
        const defaultClient = new ApiClient({ baseUrl: 'https://smoke.test' });
        const rShort = await settleWithin(defaultClient.postForm('up', makeForm(), { timeoutMs: 60 }), 1500);
        check('TASK-508 postForm: the per-call timeout aborts into { ok: false, status: 0 }',
          rShort !== PENDING && rShort.ok === false && rShort.status === 0);

        const shortClient = new ApiClient({ baseUrl: 'https://smoke.test', timeoutMs: 60 });
        const rLong = await settleWithin(shortClient.postForm('up', makeForm(), { timeoutMs: 5_000 }), 400);
        check('TASK-508 postForm: a LONGER per-call timeout outlives the client timeout', rLong === PENDING);
        const rClient = await settleWithin(shortClient.postForm('up', makeForm()), 1500);
        check('TASK-508 postForm: without opts the client timeout applies',
          rClient !== PENDING && rClient.status === 0);
        const rGet = await settleWithin(shortClient.get('items'), 1500);
        check('TASK-508 postForm: other calls keep the client timeout', rGet !== PENDING && rGet.status === 0);
        const rOff = await settleWithin(shortClient.postForm('up', makeForm(), { timeoutMs: 0 }), 300);
        check('TASK-508 postForm: timeoutMs 0 disables the timer for that call', rOff === PENDING);

        // The client-level DEFAULT (20 s) is too long to wait out, so read the timer that was armed instead.
        const delays: number[] = [];
        globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
          delays.push(ms ?? 0);
          return realSetTimeout(fn, ms, ...rest);
        }) as typeof setTimeout;
        record(okJson);
        await settleWithin(defaultClient.postForm('up', makeForm()), 1500);
        const defaultArmed = delays.includes(DEFAULT_REQUEST_TIMEOUT_MS);
        delays.length = 0;
        await settleWithin(defaultClient.postForm('up', makeForm(), { timeoutMs: 120_000 }), 1500);
        const overrideArmed = delays.includes(120_000) && !delays.includes(DEFAULT_REQUEST_TIMEOUT_MS);
        globalThis.setTimeout = realSetTimeout;
        check('TASK-508 postForm: with no timeout anywhere, DEFAULT_REQUEST_TIMEOUT_MS is armed', defaultArmed);
        check('TASK-508 postForm: opts.timeoutMs replaces the default timer', overrideArmed);

        // (e) Never queued: not on a network error, not when the browser says it is offline.
        let queueCalls = 0;
        const queuer = new ApiClient({
          baseUrl: 'https://smoke.test',
          onQueueAction: async () => { queueCalls += 1; return 'q'; },
        });
        globalThis.fetch = (async () => { throw new TypeError('network down'); }) as typeof fetch;
        const rNet = await settleWithin(queuer.postForm('up', makeForm()), 1500);
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        let rOffline: Awaited<ReturnType<typeof queuer.postForm>> | typeof PENDING;
        try {
          rOffline = await settleWithin(queuer.postForm('up', makeForm()), 1500);
        } finally {
          delete (navigator as unknown as { onLine?: boolean }).onLine;
        }
        check('TASK-508 postForm: onQueueAction is never called, online or offline', queueCalls === 0);
        check('...and a failed upload is the plain status-0 envelope, never `queued`',
          rNet !== PENDING && rNet.ok === false && rNet.status === 0 && !rNet.queued
          && rOffline !== PENDING && rOffline.ok === false && rOffline.status === 0 && !rOffline.queued);
        check('...(the navigator.onLine stub was removed again)',
          Object.getOwnPropertyDescriptor(navigator, 'onLine') === undefined);
      } finally {
        globalThis.fetch = realFetch5;
        globalThis.setTimeout = realSetTimeout;
      }
    }

    // ── Prompt 1 (Web.Components) — b-pagination click wiring ──────────────────
    // Regression: onUpdated wired clicks via btn.querySelector('button'), but b-button renders its
    // <button> in its SHADOW root, so the light-DOM query returned null and NO listener ever
    // attached — every prev/next/numbered control was inert for all consumers. Fixed by binding the
    // click on the <b-button> HOST and guarding the host's `disabled` attribute. Assert that real
    // host clicks emit page-change with the right page, and that disabled controls emit nothing.
    if (!customElements.get('b-pagination')) define('b-pagination', BPagination);
    const pgClick = document.createElement('b-pagination') as BPagination;
    pgClick.setAttribute('total-pages', '5');
    pgClick.setAttribute('page', '2');
    document.body.appendChild(pgClick);
    await new Promise((r) => setTimeout(r, 0));
    const pgPages: number[] = [];
    pgClick.addEventListener('page-change', (e) => pgPages.push((e as CustomEvent).detail.page));
    const clickPg = async (sel: string, resetTo?: string) => {
      (pgClick.shadowRoot?.querySelector(sel) as HTMLElement | null)?.click();
      if (resetTo !== undefined) { pgClick.setAttribute('page', resetTo); }
      await new Promise((r) => setTimeout(r, 0));
    };
    await clickPg('.page-btn-next', '2');   // page 2 → Next → 3 (then reset attr to 2 for the next assertion)
    check('Prompt1 pagination Next click emits page-change (+1)', pgPages.at(-1) === 3);
    await clickPg('.page-btn-prev', '2');   // page 2 → Prev → 1
    check('Prompt1 pagination Prev click emits page-change (-1)', pgPages.at(-1) === 1);
    const numFive = [...(pgClick.shadowRoot?.querySelectorAll('.page-btn') ?? [])]
      .find((b) => b.getAttribute('data-page') === '5') as HTMLElement | undefined;
    numFive?.click();
    await new Promise((r) => setTimeout(r, 0));
    check('Prompt1 pagination numbered-page click emits its page', pgPages.at(-1) === 5);
    pgClick.remove();

    // Disabled controls stay inert: page 1 → Prev disabled, last page → Next disabled.
    const pgEdge = document.createElement('b-pagination') as BPagination;
    pgEdge.setAttribute('total-pages', '3');
    pgEdge.setAttribute('page', '1');
    document.body.appendChild(pgEdge);
    await new Promise((r) => setTimeout(r, 0));
    let edgeEmits = 0;
    pgEdge.addEventListener('page-change', () => edgeEmits++);
    (pgEdge.shadowRoot?.querySelector('.page-btn-prev') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));
    check('Prompt1 pagination Prev inert on first page (no emit)', edgeEmits === 0);
    pgEdge.setAttribute('page', '3');
    await new Promise((r) => setTimeout(r, 0));
    (pgEdge.shadowRoot?.querySelector('.page-btn-next') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));
    check('Prompt1 pagination Next inert on last page (no emit)', edgeEmits === 0);
    pgEdge.remove();

    // ── Prompt 2 (Web.Components) — b-data-table auto-detects the server-paged envelope ─────────
    // Footgun: with the client-paged default, an endpoint returning a CAPPED { items, totalCount }
    // page was sliced AGAIN client-side → page 2+ rendered empty and no page=2 request ever fired.
    // The table now detects a capped envelope and switches to server paging (refetch on
    // page-change); a bare array stays client-sliced; an explicit flatArray is honoured.
    if (!customElements.get('b-data-table')) define('b-data-table', BDataTable);
    const dtCols = [{ key: 'name', label: 'Name' }];
    const mkRows = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: String(from + i), name: `Row ${from + i}` }));
    const rendered = (dt: BDataTable): string[] => {
      const tbl = dt.shadowRoot?.querySelector('b-table');
      return [...(tbl?.shadowRoot?.querySelectorAll('tbody tr[data-id]') ?? [])]
        .map((tr) => (tr as HTMLElement).dataset.id ?? '');
    };
    const nextOf = (dt: BDataTable): HTMLElement | null =>
      (dt.shadowRoot?.querySelector('b-pagination')?.shadowRoot?.querySelector('.page-btn-next') as HTMLElement | null);
    const pagerOf = (dt: BDataTable): HTMLElement | null => dt.shadowRoot?.querySelector('b-pagination') ?? null;

    // (a) capped server envelope, flatArray UNSET → auto server mode; Next fetches page=2 (not empty).
    {
      const seen: string[] = [];
      const client = {
        get: async (_e: string, params?: Record<string, string>) => {
          const page = Number(params?.page ?? 1);
          seen.push(params?.page ?? '(none)');
          return { ok: true, status: 200, headers: new Headers(),
            data: { items: mkRows((page - 1) * 20 + 1, 20), totalCount: 57, page, pageSize: 20 } };
        },
      };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20 });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(a) capped envelope → page 1 shows the server page (20 of 57)',
        rendered(dt).length === 20 && rendered(dt)[0] === '1');
      nextOf(dt)?.click();   // real host click → page-change → server refetch (also covers Prompt 1)
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(a) Next fired a page=2 request', seen.includes('2'));
      check('Prompt2(a) page 2 renders the server page — NOT empty',
        rendered(dt).length === 20 && rendered(dt)[0] === '21');
      dt.remove();
    }

    // (a2) THE footgun: flatArray:true (the base-crud-page default) + capped envelope must STILL
    // auto-flip to server — detection wins over a mis-set client default.
    {
      const seen: string[] = [];
      const client = {
        get: async (_e: string, params?: Record<string, string>) => {
          const page = Number(params?.page ?? 1);
          seen.push(params?.page ?? '(none)');
          return { ok: true, status: 200, headers: new Headers(),
            data: { items: mkRows((page - 1) * 20 + 1, 20), totalCount: 57, page, pageSize: 20 } };
        },
      };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20, flatArray: true });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      nextOf(dt)?.click();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(a2) flatArray:true + capped envelope auto-flips to server (page=2 fetched)',
        seen.includes('2') && rendered(dt)[0] === '21');
      dt.remove();
    }

    // (b) bare array → client-side slicing across pages, NO refetch on page-change.
    {
      let calls = 0;
      const client = { get: async () => { calls++; return { ok: true, status: 200, headers: new Headers(), data: mkRows(1, 45) }; } };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20 });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(b) bare array → client page 1 (first 20)', rendered(dt).length === 20 && rendered(dt)[0] === '1');
      const callsAfterLoad = calls;
      nextOf(dt)?.click();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(b) Next re-slices client-side (page 2 = rows 21..40), NO refetch',
        calls === callsAfterLoad && rendered(dt).length === 20 && rendered(dt)[0] === '21');
      dt.remove();
    }

    // (c) page-size change: server mode refetches page 1 with the new size; client mode re-slices.
    {
      // server (capped envelope)
      const seen: Array<{ page?: string; pageSize?: string }> = [];
      const client = {
        get: async (_e: string, params?: Record<string, string>) => {
          const page = Number(params?.page ?? 1);
          const size = Number(params?.pageSize ?? 20);
          seen.push({ page: params?.page, pageSize: params?.pageSize });
          return { ok: true, status: 200, headers: new Headers(),
            data: { items: mkRows((page - 1) * size + 1, size), totalCount: 57, page, pageSize: size } };
        },
      };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20 });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      pagerOf(dt)?.dispatchEvent(new CustomEvent('page-size-change', { detail: { pageSize: 10 } }));
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(c) server page-size change refetches page 1 at pageSize=10',
        seen.at(-1)?.page === '1' && seen.at(-1)?.pageSize === '10' && rendered(dt).length === 10);
      dt.remove();
    }
    {
      // client (bare array)
      let calls = 0;
      const client = { get: async () => { calls++; return { ok: true, status: 200, headers: new Headers(), data: mkRows(1, 45) }; } };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20 });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      const callsAfterLoad = calls;
      pagerOf(dt)?.dispatchEvent(new CustomEvent('page-size-change', { detail: { pageSize: 10 } }));
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(c) client page-size change re-slices to 10 rows, NO refetch',
        calls === callsAfterLoad && rendered(dt).length === 10);
      dt.remove();
    }

    // (d) explicit flatArray override still forces the chosen mode, regardless of response shape.
    {
      // flatArray:false + BARE array → forced server mode: rows rendered as-is, no client slicing.
      const client = { get: async () => ({ ok: true, status: 200, headers: new Headers(), data: mkRows(1, 45) }) };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20, flatArray: false });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(d) flatArray:false forces server mode on a bare array (all 45 rendered, unsliced)',
        rendered(dt).length === 45);
      dt.remove();
    }
    {
      // flatArray:true + FULL envelope (items === totalCount) → forced client mode: slices locally, no refetch.
      let calls = 0;
      const client = { get: async () => { calls++; return { ok: true, status: 200, headers: new Headers(), data: { items: mkRows(1, 30), totalCount: 30 } }; } };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, pageSize: 20, flatArray: true });
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(d) flatArray:true keeps a FULL envelope client-paged (page 1 = 20)',
        rendered(dt).length === 20 && rendered(dt)[0] === '1');
      const callsAfterLoad = calls;
      nextOf(dt)?.click();
      await new Promise((r) => setTimeout(r, 10));
      check('Prompt2(d) full-envelope client Next re-slices (rows 21..30), NO refetch',
        calls === callsAfterLoad && rendered(dt).length === 10 && rendered(dt)[0] === '21');
      dt.remove();
    }

    // Ribbon — unpinned hover→flyout click resolves to the HOVERED tab, not the active/first tab.
    // Repro (Symbio field report): on an unpinned + collapsed ribbon, hovering tab 2 fires expand(),
    // whose `expanded` attribute change triggers a full re-render; the panel used to rebuild from
    // `active` (tab 1), discarding the hover preview and binding every flyout button to tab 1 — so a
    // click on tab 2's flyout resolved to tab 1. Fixed by rendering the panel from `_hoverTabId ?? active`.
    {
      if (!customElements.get('b-ribbon')) define('b-ribbon', BRibbon);
      const ribbon = document.createElement('b-ribbon') as BRibbon;
      document.body.appendChild(ribbon);
      const mkTab = (n: string): RibbonTab => ({
        id: `t${n}`, label: `Tab ${n}`,
        // action:true (no href) keeps the tab panelled — a lone nav-link would be auto-panelless.
        groups: [{ id: `g${n}`, label: `G${n}`, items: [{ id: `i${n}`, label: `Item ${n}`, action: true }] }],
      });
      ribbon.setTabs([mkTab('1'), mkTab('2')]); // active defaults to t1; ribbon starts unpinned + collapsed
      await new Promise((r) => setTimeout(r, 10));
      const clicks: (string | undefined)[] = [];
      ribbon.addEventListener('item-click', (e) => clicks.push((e as CustomEvent).detail.tabId));

      const tab2 = ribbon.shadowRoot?.querySelector<HTMLElement>('.ribbon-tab[data-tab="t2"]');
      tab2?.dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 180)); // past the 100ms hover-expand timer + its re-render

      const panelItem = ribbon.shadowRoot?.querySelector<HTMLElement>('.ribbon-panel .ribbon-item');
      check('ribbon unpinned hover shows the HOVERED tab in the panel (data-tab=t2)', panelItem?.dataset.tab === 't2');
      panelItem?.click();
      check('ribbon unpinned hover→flyout click resolves to the hovered tab (t2, not active t1)', clicks.at(-1) === 't2');
      ribbon.remove();
    }

    // ── TASK-104 — b-chart axis polish for small charts ────────────────────────────────────────────────
    //
    // b-chart was tuned for a 300px canvas: a hard-coded 5 intervals and raw band fractions for labels, which
    // on the 90–150px cards a phone-width surface is made of prints six crowded labels reading
    // `0, 2271, 4543, 6814, 9086, 11357`. Two halves to the fix and both are pinned here — the pure scale maths
    // (exported, so it is assertable without a DOM) and what the component actually renders at a given height.
    {
      // (a) tick density follows the plot height, and is CAPPED so a full-size chart keeps the axis it had.
      check('tickIntervals: 300px chart (260px plot) still asks for 5 intervals', tickIntervalsForHeight(260) === 5);
      check('tickIntervals: capped at 5 — a taller chart does not grow a denser axis', tickIntervalsForHeight(600) === 5);
      check('tickIntervals: 130px chart (90px plot) asks for 2', tickIntervalsForHeight(90) === 2);
      check('tickIntervals: 90px chart (50px plot) asks for 1', tickIntervalsForHeight(50) === 1);
      check('tickIntervals: a zero/unmeasured height falls back to 5 rather than 0', tickIntervalsForHeight(0) === 5);

      const labelsOf = (s: ReturnType<typeof niceScale>) => s.ticks.map((t) => formatTick(t, s.decimals)).join(',');

      // (b) THE case from the field report: a steps series peaking at 11357.
      const steps300 = niceScale(0, 11357, 5);
      check('niceScale: 11357 peak at full size reads 0..12000 by 2000 (was 0,2271,4543,…)',
        labelsOf(steps300) === '0,2000,4000,6000,8000,10000,12000');
      check('niceScale: the band is extended to the rounded bound, not left at the data max',
        steps300.min === 0 && steps300.max === 12000);

      // The band is chosen at a FIXED density, so it does NOT loosen as the chart gets shorter — only the
      // labels thin out. Tie the two together and a 90px chart rounds 11357 up to 20000 and draws its bars at
      // 57% of an otherwise empty plot.
      const steps130 = niceScale(0, 11357, 2);
      const steps90 = niceScale(0, 11357, 1);
      check('niceScale: a 130px chart keeps the same 0..12000 band, with 3 labels',
        steps130.max === 12000 && labelsOf(steps130) === '0,5000,10000');
      check('niceScale: a 90px chart keeps the same band and drops to 2 labels',
        steps90.max === 12000 && labelsOf(steps90) === '0,10000');

      // (c) a bound the CALLER pinned is never rounded outwards — the ticks move inside it instead. Reps' body
      // charts pass a deliberately tight band (79.9→81.6 kg + 12% pad); widening it to 78–82 would show half
      // the movement the chart exists to show.
      const pinned = niceScale(79.696, 81.804, 1, { extendMin: false, extendMax: false });
      check('niceScale: pinned bounds are left exactly as given',
        pinned.min === 79.696 && pinned.max === 81.804);
      check('niceScale: pinned band still gets round labels, placed inside it', labelsOf(pinned) === '80,81');

      // (d) precision is derived from the step and applied to the WHOLE axis, so a fractional step does not
      // produce a mixed `80, 80.5, 81` axis, and an integer step does not gain a decimal it does not need.
      check('formatTick: a 0.5 step prints one decimal on every tick, including the whole ones',
        labelsOf(niceScale(79.696, 81.804, 5, { extendMin: false, extendMax: false })) === '80.0,80.5,81.0,81.5');
      check('formatTick: an integer step stays integer', labelsOf(niceScale(0, 11357, 5)).includes('.') === false);
      check('formatTick: sub-milli data keeps enough precision to differ',
        labelsOf(niceScale(0, 0.00047, 5)) === '0.0000,0.0001,0.0002,0.0003,0.0004,0.0005');
      check('formatTick: -0 never reaches a label', formatTick(-0, 0) === '0' && formatTick(-0.0001, 2) === '0.00');

      // (e) degenerate input still yields an axis rather than NaN geometry.
      check('niceScale: max <= min degrades to an equal split, not NaN',
        niceScale(5, 5, 5).ticks.every((t) => Number.isFinite(t)));
      check('niceScale: a non-finite bound degrades safely',
        niceScale(NaN, 10, 5).ticks.every((t) => Number.isFinite(t)));

      // ── Rendered behaviour ──
      // Y labels are the end-anchored ones; the x labels share the .axis-label class but are middle-anchored.
      const yLabels = (el: BChart): string[] =>
        [...(el.shadowRoot?.querySelectorAll('text.axis-label[text-anchor="end"]') ?? [])]
          .map((t) => (t.textContent ?? '').trim());

      const mkChart = async (height: string, type: string, opts: Parameters<BChart['setOptions']>[0], ys: number[]) => {
        const el = document.createElement('b-chart') as BChart;
        el.setAttribute('type', type);
        el.setAttribute('height', height);
        el.setAttribute('legend', 'false');
        document.body.appendChild(el);
        el.setOptions(opts);
        el.setData({ labels: ys.map(() => ''), series: [{ id: 's', label: 'S', data: ys.map((y) => ({ y })) }] });
        // Two ticks: the first render uses the default viewBox, then onUpdated measures the container and
        // re-renders at the real height — which is the render whose tick count we are asserting.
        await new Promise((r) => setTimeout(r, 60));
        return el;
      };

      const stepsData = [3120, 8400, 11357, 6200, 9800, 4300, 7100];

      {
        const small = await mkChart('90', 'bar', { tooltip: false }, stepsData);
        const big = await mkChart('300', 'bar', { tooltip: false }, stepsData);
        check('b-chart: a 90px bar chart no longer prints six y labels', yLabels(small).length < 6);
        check('b-chart: a 90px bar chart prints round labels', yLabels(small).every((l) => /^\d+000$|^0$/.test(l)));
        check('b-chart: a 300px bar chart keeps a full-density axis', yLabels(big).length >= 6);
        small.remove(); big.remove();
      }

      {
        // yAxis.ticks is a LABEL count and overrides the height-derived one in both directions.
        const few = await mkChart('300', 'bar', { yAxis: { ticks: 3 }, tooltip: false }, stepsData);
        check('b-chart: yAxis.ticks:3 thins a full-size axis to ~3 labels', yLabels(few).length <= 4);
        few.remove();
      }

      {
        // The escape hatch back to the pre-nice-scale axis: equal fractions of the raw band, printed as they fall.
        const raw = await mkChart('300', 'bar', { yAxis: { nice: false }, tooltip: false }, stepsData);
        // The band stops at the data max instead of the rounded 12000, and the fractions are printed as they
        // fall (the opt-out unifies on the line renderer's one-decimal rule, so it reads `11357.0`).
        check('b-chart: yAxis.nice:false restores the raw equal-split band (top label = the data max)',
          yLabels(raw).some((l) => l.startsWith('11357')) && !yLabels(raw).includes('12000'));
        raw.remove();
      }

      {
        // A threshold above every bar used to be drawn at a negative y — and an overflow:visible SVG does not
        // clip that, it paints it on the card above the chart. It now pulls the band up to meet it.
        const th = await mkChart('300', 'bar', { tooltip: false, thresholds: [{ value: 40000, label: 'goal' }] }, stepsData);
        const line = th.shadowRoot?.querySelector('.threshold-line');
        const y1 = Number(line?.getAttribute('y1') ?? -1);
        check('b-chart: a threshold above the data pulls the band up (line lands inside the plot)',
          y1 >= 0 && y1 <= 300);

        // The paint order IS the "threshold label overlaps the leftmost bars" defect: the label used to be
        // emitted with its line, before the bars, so a bar reaching the threshold was painted straight through
        // the text. The line still belongs behind the data; the label does not.
        const kids = [...(th.shadowRoot?.querySelector('svg')?.children ?? [])];
        const lineAt = kids.findIndex((n) => n.classList.contains('threshold-line'));
        const labelAt = kids.findIndex((n) => n.classList.contains('threshold-label'));
        const firstBar = kids.findIndex((n) => n.classList.contains('bar-rect'));
        check('b-chart: threshold LINE paints behind the bars', lineAt >= 0 && firstBar > lineAt);
        check('b-chart: threshold LABEL paints in front of the bars', labelAt > firstBar && firstBar >= 0);
        th.remove();
      }

      {
        // The latest-value overlay: switchable WITHOUT opting into realTime, default unchanged, and the old
        // realTime spelling still honoured.
        const on = await mkChart('300', 'line', { tooltip: false }, [1, 2, 3]);
        const off = await mkChart('300', 'line', { tooltip: false, showLatestValue: false }, [1, 2, 3]);
        const rtOff = await mkChart('300', 'line', { tooltip: false, realTime: { showLatestValue: false } }, [1, 2, 3]);
        check('b-chart: latest-value overlay still ON by default (unchanged for existing charts)',
          !!on.shadowRoot?.querySelector('.latest-value'));
        check('b-chart: showLatestValue:false turns it off without a realTime block',
          !off.shadowRoot?.querySelector('.latest-value'));
        check('b-chart: the realTime.showLatestValue spelling still works',
          !rtOff.shadowRoot?.querySelector('.latest-value'));
        on.remove(); off.remove(); rtOff.remove();
      }

      {
        // Back-compat guard for TASK-093: overlay bars stay superimposed at full category width.
        const el = document.createElement('b-chart') as BChart;
        el.setAttribute('type', 'bar');
        el.setAttribute('height', '300');
        document.body.appendChild(el);
        el.setOptions({ overlay: true, tooltip: false });
        el.setData({ labels: ['a', 'b'], series: [
          { id: 'target', label: 'Target', data: [{ y: 10 }, { y: 10 }] },
          { id: 'done', label: 'Done', data: [{ y: 6 }, { y: 9 }] },
        ] });
        await new Promise((r) => setTimeout(r, 60));
        const rects = [...(el.shadowRoot?.querySelectorAll('rect.bar-rect') ?? [])];
        const first = rects.filter((r) => r.getAttribute('data-index') === '0');
        check('b-chart: overlay bars still share one x at full category width',
          first.length === 2 && first[0].getAttribute('x') === first[1].getAttribute('x')
            && first[0].getAttribute('width') === first[1].getAttribute('width'));
        el.remove();
      }
    }

    // ── TASK-105 — b-card: the missing `md` padding rung + elevation as a token ────────────────────────
    //
    // Found adopting b-card in Reps (its TASK-089). Both are additive, and the assertions that matter most
    // here are the ones pinning what did NOT change: b-card is already in use, so an existing card must render
    // identically. Note what is deliberately absent — there is no layout/gap/direction check, because b-card
    // deliberately gained no such option (see TASK-105's rejection note).
    {
      const host = document.createElement('div');
      document.body.appendChild(host);

      // Tokens are declared in rem, so compare against a probe carrying the same token rather than a px
      // literal — a literal would silently pass if the scale were rescaled.
      const probePad = (css: string): string => {
        const d = document.createElement('div');
        d.style.cssText = `padding: ${css}`;
        host.appendChild(d);
        const v = getComputedStyle(d).paddingTop;
        d.remove();
        return v;
      };

      const mkCard = (attrs: Record<string, string> = {}, style = ''): BCard => {
        const c = document.createElement('b-card') as BCard;
        for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
        if (style) c.setAttribute('style', style);
        host.appendChild(c);
        return c;
      };
      const bodyPad = (c: BCard) => {
        const el = c.shadowRoot?.querySelector('.card-body');
        return el ? getComputedStyle(el).paddingTop : '(no body)';
      };
      const shadowOf = (c: BCard) => {
        const el = c.shadowRoot?.querySelector('.card');
        return el ? getComputedStyle(el).boxShadow : '(no card)';
      };

      await new Promise((r) => setTimeout(r, 30));

      const cNone = mkCard({ padding: 'none' });
      const cSm = mkCard({ padding: 'sm' });
      const cMd = mkCard({ padding: 'md' });
      const cLg = mkCard({ padding: 'lg' });
      const cXl = mkCard({ padding: 'xl' });
      const cDefault = mkCard();
      const cBogus = mkCard({ padding: 'enormous' });
      await new Promise((r) => setTimeout(r, 30));

      // (1) the new rung resolves to --b-space-md, and lands where the ladder says it should.
      check('b-card: padding="md" resolves to --b-space-md', bodyPad(cMd) === probePad('var(--b-space-md)'));
      check('b-card: md sits strictly between sm and lg',
        parseFloat(bodyPad(cSm)) < parseFloat(bodyPad(cMd)) && parseFloat(bodyPad(cMd)) < parseFloat(bodyPad(cLg)));
      check('b-card: the whole ladder is monotonic none < sm < md < lg < xl',
        [cNone, cSm, cMd, cLg, cXl].map((c) => parseFloat(bodyPad(c)))
          .every((v, i, a) => i === 0 || a[i - 1] < v));

      // (2) BACK-COMPAT: the default is untouched, and an unrecognised value still falls back to it.
      check('b-card: default padding is still lg (an existing card is unchanged)',
        bodyPad(cDefault) === probePad('var(--b-space-lg)'));
      check('b-card: an unknown padding value still falls back to the default',
        bodyPad(cBogus) === bodyPad(cDefault));
      check('b-card: padding="none" is still 0px', bodyPad(cNone) === '0px');

      // (3) elevation is a token now, and its default is the shadow the card always had.
      const probeShadow = document.createElement('div');
      probeShadow.style.cssText = 'box-shadow: var(--b-shadow-sm)';
      host.appendChild(probeShadow);
      const shadowSm = getComputedStyle(probeShadow).boxShadow;
      check('b-card: default elevation is still --b-shadow-sm', shadowOf(cDefault) === shadowSm && shadowSm !== 'none');

      const flat = mkCard({}, '--b-card-shadow: none');
      await new Promise((r) => setTimeout(r, 30));
      check('b-card: --b-card-shadow flattens the card', shadowOf(flat) === 'none');
      check('b-card: overriding it does NOT touch --b-shadow-sm for anything else in scope',
        getComputedStyle(probeShadow).boxShadow === shadowSm && shadowOf(cDefault) === shadowSm);

      // It is a custom property, so it inherits — a section can flatten every card it contains at once.
      const scope = document.createElement('div');
      scope.style.cssText = '--b-card-shadow: none';
      host.appendChild(scope);
      const scoped = document.createElement('b-card') as BCard;
      scope.appendChild(scoped);
      await new Promise((r) => setTimeout(r, 30));
      check('b-card: --b-card-shadow cascades from an ancestor', shadowOf(scoped) === 'none');

      host.remove();
    }

    // ── TASK-107 — b-button: tap-target tokens + form participation ────────────────────────────────────
    //
    // Reps stopped before converting 69 buttons because reading b-button turned up two silent regressions.
    // The form half is the dangerous one: a <button type="submit"> inside a <form> became a b-button whose
    // inner <button> lives in a shadow root, so it had no form owner and the save did NOTHING -- and read as
    // intermittent, because Enter in a text field still submits (the form's own behaviour) and only the
    // pointer path failed.
    {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const mkForm = (inner: string): HTMLFormElement => {
        const f = document.createElement('form');
        f.innerHTML = inner;
        f.addEventListener('submit', (e) => e.preventDefault()); // never navigate the playground away
        host.appendChild(f);
        return f;
      };
      const settle = () => new Promise((r) => setTimeout(r, 20));
      const btnOf = (f: HTMLFormElement, sel = 'b-button') => f.querySelector<HTMLElement>(sel)!;

      // (1) it joins the family's existing convention rather than inventing a second mechanism.
      check('b-button declares formAssociated (same mechanism as the 15 value controls)',
        (customElements.get('b-button') as unknown as { formAssociated?: boolean })?.formAssociated === true);
      {
        const f = mkForm('<b-button>Go</b-button>');
        await settle();
        check('b-button resolves its owning form across the shadow boundary',
          (btnOf(f) as unknown as { form?: HTMLFormElement | null }).form === f);
        check('b-button contributes NO FormData entry', [...new FormData(f).keys()].length === 0);
        f.remove();
      }

      // (2) THE fix: type="submit" fires the form's submit event on a click.
      {
        const f = mkForm('<b-button type="submit">Save</b-button>');
        await settle();
        let submits = 0;
        f.addEventListener('submit', () => submits++);
        btnOf(f).click();
        await settle();
        check('b-button type="submit" fires the form submit event on click', submits === 1);
        f.remove();
      }

      // (3) BACK-COMPAT, and the reason the default is `button` rather than native `submit`.
      // A shipped consumer (Presenter) has b-buttons inside a <form> that ALSO listens for submit and does
      // something different with it. A native-faithful default would make one tap run both paths.
      {
        const f = mkForm('<b-button id="save">Save</b-button>');
        await settle();
        let submits = 0;
        let clicks = 0;
        f.addEventListener('submit', () => submits++);
        btnOf(f).addEventListener('click', () => clicks++);
        btnOf(f).click();
        await settle();
        check('b-button default type does NOT submit (an existing in-form consumer is unchanged)', submits === 0);
        check('...while its own click handler still runs exactly once', clicks === 1);
        f.remove();
      }

      // (4) reset, and the guards.
      {
        const f = mkForm('<b-input name="q" value="start"></b-input><b-button type="reset">Reset</b-button>');
        await settle();
        const input = f.querySelector('b-input') as HTMLElement & { value: string };
        input.value = 'typed';
        await settle();
        btnOf(f).click();
        await settle();
        check('b-button type="reset" resets the form', input.value === 'start');
        f.remove();
      }
      {
        const f = mkForm('<b-button type="submit" disabled>Save</b-button>');
        await settle();
        let submits = 0;
        f.addEventListener('submit', () => submits++);
        btnOf(f).click(); // programmatic: pointer-events:none would not block this path
        await settle();
        check('a disabled b-button does not submit even via a programmatic click', submits === 0);
        f.remove();
      }
      {
        const f = mkForm('<b-button type="submit" loading>Save</b-button>');
        await settle();
        let submits = 0;
        f.addEventListener('submit', () => submits++);
        btnOf(f).click();
        await settle();
        check('a loading b-button does not submit (no double-submit on a slow write)', submits === 0);
        f.remove();
      }
      {
        // requestSubmit(), not submit() -- so the form's constraint validation still gets to say no.
        const f = mkForm('<b-input name="q" required></b-input><b-button type="submit">Save</b-button>');
        await settle();
        let submits = 0;
        f.addEventListener('submit', () => submits++);
        btnOf(f).click();
        await settle();
        check('b-button submit runs constraint validation (a required empty field blocks it)', submits === 0);
        f.remove();
      }
      {
        // No form at all must be a no-op, not a throw -- the overwhelmingly common case in Symbio (102 files
        // of b-button and not one <form> in the app).
        const el = document.createElement('b-button');
        el.setAttribute('type', 'submit');
        host.appendChild(el);
        await settle();
        let threw = false;
        try { el.click(); } catch { threw = true; }
        check('a type="submit" b-button outside any form is a silent no-op, not a throw', !threw);
        el.remove();
      }

      // (5) the tap-target tokens.
      {
        const probe = (css: string): string => {
          const d = document.createElement('div');
          d.style.cssText = `padding: ${css}`;
          host.appendChild(d);
          const v = getComputedStyle(d).paddingTop;
          d.remove();
          return v;
        };
        const padOf = (el: HTMLElement, side: 'paddingTop' | 'paddingLeft') => {
          const inner = el.shadowRoot?.querySelector('button');
          return inner ? getComputedStyle(inner)[side] : '(none)';
        };
        const mk = (attrs = '', style = ''): HTMLElement => {
          const el = document.createElement('b-button');
          if (attrs) for (const a of attrs.split(' ')) { const [k, v] = a.split('='); el.setAttribute(k, v ?? ''); }
          if (style) el.setAttribute('style', style);
          el.textContent = 'X';
          host.appendChild(el);
          return el;
        };
        const dflt = mk();
        const sm = mk('size=sm');
        const lg = mk('size=lg');
        const tall = mk('', '--b-button-padding-y: var(--b-space-md)');
        const tallSm = mk('size=sm', '--b-button-padding-y: var(--b-space-md)');
        await settle();

        check('b-button default vertical padding is unchanged (--b-space-sm)',
          padOf(dflt, 'paddingTop') === probe('var(--b-space-sm)'));
        check('b-button size="sm" vertical padding is unchanged (--b-space-xs)',
          padOf(sm, 'paddingTop') === probe('var(--b-space-xs)'));
        check('b-button size="lg" vertical padding is unchanged (--b-space-sm, it only widens)',
          padOf(lg, 'paddingTop') === probe('var(--b-space-sm)'));
        check('--b-button-padding-y raises the tap target',
          padOf(tall, 'paddingTop') === probe('var(--b-space-md)'));
        check('...and reaches size="sm" too, so one rule covers every call site',
          padOf(tallSm, 'paddingTop') === probe('var(--b-space-md)'));
        check('the y token leaves the x padding alone',
          padOf(tall, 'paddingLeft') === padOf(dflt, 'paddingLeft'));
        // Heights go in the check NAME: a bare pass/fail on a magic 44 tells you nothing when it fails, and
        // the number depends on the consumer's own font scale.
        const hDefault = Math.round(dflt.getBoundingClientRect().height);
        const hTall = Math.round(tall.getBoundingClientRect().height);
        check(`the default button is under a 44px tap target (measured ${hDefault}px) — the reason the token exists`,
          hDefault < 44);
        check(`--b-button-padding-y: md raises it (measured ${hTall}px, +${hTall - hDefault}px)`,
          hTall > hDefault);

        // How far the token has to be turned up to clear 44px depends on the consumer's own font scale, so
        // assert that SOME rung reaches it rather than hard-coding which one.
        const tallest = mk('', '--b-button-padding-y: var(--b-space-lg)');
        const lgPlusToken = mk('size=lg', '--b-button-padding-y: var(--b-space-md)');
        await settle();
        const hTallest = Math.round(tallest.getBoundingClientRect().height);
        const hLgToken = Math.round(lgPlusToken.getBoundingClientRect().height);
        check(`the token can reach a 44px tap target (--b-space-lg measured ${hTallest}px)`, hTallest >= 44);
        // The token is orthogonal to `size`, so a consumer can compose rather than needing a fourth rung.
        // Recorded with its number because b-button fixes font-size at --b-text-sm with a tight line-height,
        // so padding alone reaches less height than the same padding on a `font: inherit` button.
        check(`size="lg" composes with the token (measured ${hLgToken}px, vs ${hTall}px at default size)`,
          hLgToken > hTall);
      }

      host.remove();
    }

    // TASK-105 — b-input type="decimal": a comma-locale keypad must be able to type a separator, and the
    // component (not the consumer) owns min/max/step, because a type="text" inner control reports valid
    // for everything and this control is form-associated.
    {
      const { BInput } = await import('birko-web-components/inputs');
      // parseDecimal now lives in Core beside the Formatter (it is the same locale problem, inverted).
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const mk = (attrs: string) => {
        host.innerHTML = `<b-input ${attrs}></b-input>`;
        return host.querySelector('b-input') as InstanceType<typeof BInput>;
      };
      const inner = (el: Element) => el.shadowRoot?.querySelector('input') as HTMLInputElement;

      const d = mk('type="decimal" label="Weight"');
      await new Promise((r) => setTimeout(r, 0));
      check('decimal renders a TEXT inner input (type=number cannot accept a comma)',
        inner(d)?.getAttribute('type') === 'text');
      check('decimal defaults inputmode="decimal" (numeric keypad, comma allowed)',
        inner(d)?.getAttribute('inputmode') === 'decimal');

      const dOverride = mk('type="decimal" inputmode="numeric"');
      await new Promise((r) => setTimeout(r, 0));
      check('an explicit inputmode still wins over the decimal default',
        inner(dOverride)?.getAttribute('inputmode') === 'numeric');

      const dSup = mk('type="decimal" min="0" max="10" step="0.5"');
      await new Promise((r) => setTimeout(r, 0));
      check('min/max/step are NOT forwarded to a text input that would ignore them',
        !inner(dSup)?.hasAttribute('min') && !inner(dSup)?.hasAttribute('max') && !inner(dSup)?.hasAttribute('step'));

      // Parsing: both separators, and stricter than parseFloat.
      check('parseDecimal accepts a comma', parseDecimal('81,8') === 81.8);
      check('parseDecimal accepts a period', parseDecimal('81.8') === 81.8);
      check('parseDecimal rejects trailing junk (parseFloat would return 12)', parseDecimal('12abc') === null);
      check('parseDecimal rejects two separators', parseDecimal('1.2.3') === null);
      check('parseDecimal rejects a lone separator', parseDecimal(',') === null);
      check('parseDecimal treats blank as null, not 0', parseDecimal('   ') === null);

      const numeric = mk('type="decimal"');
      await new Promise((r) => setTimeout(r, 0));
      numeric.value = '81,8';
      check('numericValue parses the live comma value', numeric.numericValue === 81.8);

      // Validity — the whole point: a text inner control has no constraints of its own.
      const ranged = mk('type="decimal" min="0" max="100"');
      await new Promise((r) => setTimeout(r, 0));
      ranged.value = '-5';
      check('a value below min reports rangeUnderflow', ranged.validity.rangeUnderflow === true);
      check('...with a message', ranged.validationMessage.length > 0);
      ranged.value = '250';
      check('a value above max reports rangeOverflow', ranged.validity.rangeOverflow === true);
      ranged.value = '81,8';
      check('an in-range comma value is valid', ranged.checkValidity() === true);
      ranged.value = 'abc';
      check('unparseable input reports badInput', ranged.validity.badInput === true);
      ranged.value = '';
      check('blank is left to `required`, not reported as bad', ranged.validity.badInput === false);

      const stepped = mk('type="decimal" step="0.5"');
      await new Promise((r) => setTimeout(r, 0));
      stepped.value = '81,8';
      check('step="0.5" makes 81.8 a stepMismatch (step is a CONSTRAINT, not an increment)',
        stepped.validity.stepMismatch === true);
      stepped.value = '81,5';
      check('...and 81.5 is aligned', stepped.checkValidity() === true);

      const noStep = mk('type="decimal"');
      await new Promise((r) => setTimeout(r, 0));
      noStep.value = '81,8';
      check('no step attribute means NO step constraint (the common case)', noStep.checkValidity() === true);

      const floaty = mk('type="decimal" step="0.1"');
      await new Promise((r) => setTimeout(r, 0));
      floaty.value = '0,3';
      check('0.3 against step=0.1 is aligned (naive % would say mismatch)', floaty.checkValidity() === true);

      const appErr = mk('type="decimal" min="0" error="Server said no"');
      await new Promise((r) => setTimeout(r, 0));
      appErr.value = '-5';
      check('an explicit error attribute still wins over our range check',
        appErr.validationMessage === 'Server said no');

      host.remove();
    }

    // TASK-091 code-review finding — `renderError` was the one field row that did NOT escape, while label,
    // hint and description all did. 13 of the 14 controls hand it `this.attr('error')` directly, and an
    // attribute read back with attr() is already DECODED by the browser, so a consumer escaping at the call
    // site (b-form does, via escapeAttr) had its work undone. b-form.setFieldError() takes an arbitrary
    // string, which is where a server-echoed validation message enters.
    {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);

      const payload = '<img src=x onerror="window.__bwcErrorXss=1">';
      host.innerHTML = `<b-input label="Weight" error='${payload}'></b-input>`;
      await new Promise((r) => setTimeout(r, 0));
      const el = host.querySelector('b-input') as HTMLElement;
      const span = el.shadowRoot?.querySelector('.error') as HTMLElement | null;

      check('an error message is not parsed as markup', span?.querySelector('img') === null);
      check('...and reaches the user as text', span?.textContent === payload);
      check('...so the injected handler never ran',
        (window as unknown as Record<string, unknown>).__bwcErrorXss === undefined);

      // The other half of the fix: no double-encoding. b-markdown-editor used to pre-escape.
      host.innerHTML = '<b-markdown-editor label="Notes" error="a &amp; b"></b-markdown-editor>';
      await new Promise((r) => setTimeout(r, 0));
      const md = host.querySelector('b-markdown-editor') as HTMLElement;
      const mdErr = md.shadowRoot?.querySelector('.error') as HTMLElement | null;
      check('a literal ampersand in an error is shown once, not double-encoded',
        mdErr?.textContent === 'a & b');

      host.remove();
    }

    // TASK-105 follow-up — `decimal` reached through a b-form SCHEMA, not just a hand-written tag.
    // This is the path consumers actually build forms on, and it was broken while every check above
    // passed: b-form's field-type switch had no `decimal` case, so it emitted no `type` attribute at
    // all, b-input fell back to `text`, and the entire mode vanished silently — no numeric keypad, no
    // range check, no badInput, on a field that looked correct and accepted anything. Nothing here
    // duplicates the direct-tag checks; it verifies the wiring between the two components.
    {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const settle = () => new Promise((r) => setTimeout(r, 30));

      const form = document.createElement('b-form') as HTMLElement & {
        setSchema(s: unknown): void;
        setFieldError(p: string, e: string): void;
        validate(): { valid: boolean; errors: Record<string, string> };
      };
      host.appendChild(form);
      await settle();
      form.setSchema({
        name: 'root',
        children: [
          { name: 'weight', type: 'decimal', label: 'Weight', min: 0, max: 500, step: 0.1 },
          { name: 'ruled', type: 'decimal', label: 'Ruled', rules: [{ type: 'max', value: 100 }] },
        ],
      });
      await settle();

      const field = (n: string) =>
        (form.shadowRoot?.querySelector(`[data-path="${n}"]`) ?? form.querySelector(`[data-path="${n}"]`)) as
          (HTMLElement & { numericValue: number | null; checkValidity(): boolean }) | null;
      const innerOf = (n: string) => field(n)?.shadowRoot?.querySelector('input') as HTMLInputElement | undefined;
      const type = (n: string) => innerOf(n)?.getAttribute('type');

      check('b-form emits type="decimal", so the mode engages at all',
        field('weight')?.getAttribute('type') === 'decimal');
      check('...giving a TEXT inner input through the schema path', type('weight') === 'text');
      check('...and the decimal inputmode, so a comma keypad appears', innerOf('weight')?.getAttribute('inputmode') === 'decimal');
      check('b-form forwards min/max/step onto the HOST, where b-input enforces them',
        field('weight')?.getAttribute('min') === '0' && field('weight')?.getAttribute('max') === '500'
        && field('weight')?.getAttribute('step') === '0.1');
      check('...and NOT onto the inner text input, which would ignore them',
        innerOf('weight')?.hasAttribute('min') === false && innerOf('weight')?.hasAttribute('max') === false);

      const setVal = async (n: string, v: string) => {
        const i = innerOf(n)!;
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
      };

      await setVal('weight', '81,8');
      check('a comma value survives the schema path and parses', field('weight')?.numericValue === 81.8);
      check('...and is valid, being inside min/max', field('weight')?.checkValidity() === true);

      await setVal('weight', '9999');
      check('an over-max value is refused via b-form (it reported VALID before this wiring)',
        field('weight')?.checkValidity() === false);

      await setVal('weight', 'abc');
      check('unparseable input is refused via b-form', field('weight')?.checkValidity() === false);

      // b-form's own rule engine, a different mechanism from the min/max attributes above: it coerces
      // with Number(), which is NaN for '120,5', and every numeric comparison against NaN is false --
      // so a `max` RULE silently passed for any comma value while the `max` ATTRIBUTE was enforced.
      await setVal('ruled', '120,5');
      const res = form.validate();
      check('a max RULE fires on a comma decimal (Number() would make it NaN and pass)',
        res.valid === false && !!res.errors['ruled']);
      // `weight` still holds the 'abc' from the badInput check above, and since validate() now surfaces a
      // control's own verdict (TASK-105 follow-up 2) that junk counts against the FORM. Clear it first —
      // the claim here is about the rule on `ruled`, not about the form being clean by accident.
      await setVal('weight', '81,8');
      await setVal('ruled', '99,5');
      check('...and a comma value under the rule limit passes', form.validate().valid === true);

      host.remove();
    }

    // `percent` is a decimal by definition and used to render type="number", so it carried the same
    // comma bug — with a worse tail: the 0-100 ⇄ 0-1 conversion coerced with Number(), so for '12,5' it
    // got NaN, its !isNaN guard skipped the branch, and the RAW STRING was handed out as the stored
    // value. Mis-validation is recoverable; handing a string to something expecting 0-1 is corruption.
    {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const settle = () => new Promise((r) => setTimeout(r, 30));

      const form = document.createElement('b-form') as HTMLElement & {
        setSchema(s: unknown): void;
        setValues(v: Record<string, unknown>): void;
        getValues(): Record<string, unknown>;
        validate(): { valid: boolean; data: Record<string, unknown>; errors: Record<string, string> };
      };
      host.appendChild(form);
      await settle();
      form.setSchema({
        name: 'root',
        children: [
          { name: 'rate', type: 'percent', label: 'Rate' },
          { name: 'capped', type: 'percent', label: 'Capped', rules: [{ type: 'max', value: 50 }] },
        ],
      });
      await settle();

      const field = (n: string) =>
        (form.shadowRoot?.querySelector(`[data-path="${n}"]`) ?? form.querySelector(`[data-path="${n}"]`)) as HTMLElement | null;
      const innerOf = (n: string) => field(n)?.shadowRoot?.querySelector('input') as HTMLInputElement | undefined;
      const setVal = async (n: string, v: string) => {
        const i = innerOf(n)!;
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
      };

      check('percent renders through the decimal mode, so a comma can be typed at all',
        field('rate')?.getAttribute('type') === 'decimal' && innerOf('rate')?.getAttribute('type') === 'text');
      check('...and still carries the % suffix (keyed on the schema type, not the rendered one)',
        !!form.shadowRoot?.querySelector('.b-form-percent-sign'));

      await setVal('rate', '12,5');
      const res = form.validate();
      check('a comma percent converts to storage as a NUMBER, not the raw string',
        typeof res.data['rate'] === 'number');
      check('...and converts correctly (12,5 % -> 0.125)', res.data['rate'] === 0.125);

      await setVal('rate', '12.5');
      check('a period percent still converts identically (no regression)',
        form.validate().data['rate'] === 0.125);

      // storage -> display, the other direction through the same branch
      form.setValues({ rate: 0.075 });
      await settle();
      check('a stored 0.075 displays as 7.5', innerOf('rate')?.value === '7.5');

      await setVal('capped', '62,5');
      check('a max RULE fires on a comma percent (Number() made it NaN and passed)',
        form.validate().valid === false);
      await setVal('capped', '42,5');
      check('...and a comma percent under the limit passes', form.validate().valid === true);

      host.remove();
    }

    // TASK-105 follow-up 2 — `b-form.validate()` ran SCHEMA RULES ONLY, so a control's own verdict was
    // invisible to the one path every consumer uses. `b-input type="decimal"` reported `badInput` for
    // `abc` correctly and `validate()` still answered `{ valid: true, data: { percentage: 'abc' } }` —
    // measured in Symbio as a create that 400s and, worse, an edit that reports success while keeping the
    // old value (NaN serializes to null, the update DTO's field is nullable, the service guards on
    // HasValue). The fix is deliberately NOT a blanket checkValidity() gate; see the trap check below.
    {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(host);
      const settle = () => new Promise((r) => setTimeout(r, 30));

      type Form = HTMLElement & {
        setSchema(s: unknown): void;
        setValues(v: Record<string, unknown>): void;
        setFieldDisabled(p: string, d: boolean): void;
        validate(): { valid: boolean; data: Record<string, unknown>; errors: Record<string, string> };
      };
      const mkForm = async (children: unknown[]) => {
        host.innerHTML = '';
        const f = document.createElement('b-form') as Form;
        host.appendChild(f);
        await settle();
        f.setSchema({ name: 'root', children });
        await settle();
        return f;
      };
      const field = (f: Form, n: string) =>
        f.shadowRoot?.querySelector(`[data-path="${n}"]`) as
          (HTMLElement & { checkValidity(): boolean; validationMessage: string }) | null;
      const innerOf = (f: Form, n: string) => field(f, n)?.shadowRoot?.querySelector('input') as HTMLInputElement | undefined;
      const setVal = async (f: Form, n: string, v: string) => {
        const i = innerOf(f, n)!;
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
      };

      // ── the hole itself ──
      {
        const f = await mkForm([
          { name: 'rate', type: 'percent', label: 'Rate', rules: [{ type: 'required' }, { type: 'min', value: 0 }, { type: 'max', value: 100 }] },
          { name: 'note', type: 'text', label: 'Note' },
        ]);
        await setVal(f, 'rate', 'abc');
        // The control was ALWAYS right about this — the form just never asked.
        check('the control itself already reported the junk as invalid (unchanged)',
          field(f, 'rate')?.checkValidity() === false);
        const res = f.validate();
        check('badInput now fails validate() through the schema path', res.valid === false);
        check('...with the error on the junk field and nothing on its sibling',
          !!res.errors['rate'] && res.errors['note'] === undefined);
        check('...applied as the error attribute on that field, so the user sees where',
          field(f, 'rate')?.getAttribute('error') === res.errors['rate']);
        check('...carrying the control\'s own message, not a generic one',
          res.errors['rate'] === 'Enter a number.');
        check('data nulls a badInput field rather than handing out the typed string',
          res.data['rate'] === null);

        // Re-validating without touching the field must reach the same verdict. It did not: `_applyErrors`
        // had left `error` on the control, which makes it report `customError` and MASK its own badInput,
        // so a second Save click passed the form.
        const again = f.validate();
        check('validating twice without changing anything stays invalid (stale error attribute masked it)',
          again.valid === false && !!again.errors['rate']);

        // And the fix must clear: the same field, corrected.
        await setVal(f, 'rate', '12,5');
        const fixed = f.validate();
        check('correcting the value clears the verdict and stores the number',
          fixed.valid === true && fixed.data['rate'] === 0.125);
      }

      // ── the trap: a blanket checkValidity() gate would have broken every consumer number field ──
      {
        const f = await mkForm([{ name: 'scrap', type: 'number', label: 'Scrap %' }]);
        await setVal(f, 'scrap', '12.5');
        // Premise, asserted rather than assumed: type="number" has an implicit step of 1, so the browser
        // ALREADY calls 12.5 invalid ("the two nearest valid values are 12 and 13") and b-form has always
        // ignored it. If this half ever stops holding, the guard below is vacuous and should be re-derived.
        check('premise: 12.5 in a plain type="number" field is natively invalid (implicit step=1)',
          field(f, 'scrap')?.checkValidity() === false
          && field(f, 'scrap')?.validationMessage.length !== 0);
        check('...and validate() still PASSES it — stepMismatch is not adopted outside decimal mode',
          f.validate().valid === true);
        check('...and the value is untouched in data', f.validate().data['scrap'] === '12.5');
      }

      // Same reasoning, the other flag a blanket gate would have brought in: an `email` field is left to
      // the schema `email` rule. Ignored on purpose — turning typeMismatch on is the stepMismatch trap
      // again, one field type at a time.
      {
        const f = await mkForm([{ name: 'mail', type: 'email', label: 'Mail' }]);
        await setVal(f, 'mail', 'foo@');
        check('premise: type="email" already reports typeMismatch for "foo@"',
          field(f, 'mail')?.checkValidity() === false);
        check('...and validate() still passes it, with no email rule in the schema',
          f.validate().valid === true);
      }

      // ── decimal-mode range/step ARE adopted: they are b-input's own, from min/max the schema asked for ──
      {
        const f = await mkForm([
          { name: 'weight', type: 'decimal', label: 'Weight', min: 0, max: 500 },
          { name: 'ruled', type: 'decimal', label: 'Ruled', max: 100, rules: [{ type: 'max', value: 100 }] },
        ]);
        await setVal(f, 'weight', '9999');
        const over = f.validate();
        check('a decimal over its max ATTRIBUTE now fails validate() (it only blocked native submit before)',
          over.valid === false && !!over.errors['weight']);
        check('...and its value is kept in data, being a real number (only badInput is nulled)',
          over.data['weight'] === '9999');
        await setVal(f, 'weight', '81,8');
        check('...and an in-range comma value passes', f.validate().valid === true);

        // The duplicate-reporting question: a `max` RULE and a `max` ATTRIBUTE are two spellings of one
        // constraint. The control is consulted only after the rules, so one field reports one message.
        await setVal(f, 'ruled', '120,5');
        const both = f.validate();
        check('a max rule and a max attribute on one field report ONCE, with the rule\'s wording',
          both.errors['ruled'] === 'Ruled must be at most 100');
      }

      // ── what still belongs to `required`, and to nobody else ──
      {
        const f = await mkForm([{ name: 'rate', type: 'percent', label: 'Rate', rules: [{ type: 'required' }] }]);
        await setVal(f, 'rate', '');
        const res = f.validate();
        check('blank reports `required` and nothing else (one message, the schema\'s)',
          Object.keys(res.errors).length === 1 && res.errors['rate'] === 'Rate is required');
        check('...and blank is not treated as badInput, so data keeps the empty string',
          res.data['rate'] === '');
      }

      // Birko TASK-132: `required` on a checkbox / switch. b-form's emptiness test counted `false` as a filled value, so
      // an unchecked required toggle passed validate() while the control itself reported valueMissing (this block
      // pinned that gap until the fix). Emptiness is now decided per field type: a toggle is empty until it is true.
      {
        const f = await mkForm([
          { name: 'agree', type: 'checkbox', label: 'Agree', required: true },
          { name: 'on', type: 'switch', label: 'On', rules: [{ type: 'required', message: 'Switch it on' }] },
          { name: 'opt', type: 'checkbox', label: 'Optional' },
        ]);
        check('premise: an unchecked required checkbox reports ITSELF invalid',
          field(f, 'agree')?.checkValidity() === false);
        let res = f.validate();
        check(`TASK-132: an unchecked required checkbox fails validate() (${JSON.stringify(res.errors)})`,
          res.valid === false && res.errors['agree'] === 'Agree is required');
        check('TASK-132: an unchecked required switch fails with its rule\'s own message',
          res.errors['on'] === 'Switch it on');
        check('TASK-132: the error lands on the field (error attribute)',
          field(f, 'agree')?.getAttribute('error') === 'Agree is required');
        await settle();
        const line = field(f, 'agree')?.shadowRoot?.querySelector('.toggle-error');
        const box = field(f, 'agree')?.shadowRoot?.querySelector('input');
        check(`TASK-932: the checkbox shows the message under it ("${line?.textContent ?? ''}"), linked to its input`,
          line?.textContent === 'Agree is required' && box?.getAttribute('aria-invalid') === 'true'
            && box?.getAttribute('aria-describedby') === line?.id);
        check("TASK-932: the switch shows its rule's message too",
          field(f, 'on')?.shadowRoot?.querySelector('.toggle-error')?.textContent === 'Switch it on');
        check(`TASK-132: an unchecked optional toggle is not an error and still collects false (${JSON.stringify(res.data['opt'])})`,
          !('opt' in res.errors) && res.data['opt'] === false);
        f.setValues({ agree: true, on: true });
        await settle();
        res = f.validate();
        check(`TASK-132: checked, both pass (${JSON.stringify(res.errors)})`, res.valid === true);
        check('TASK-132: ...and the error attribute is gone', !field(f, 'agree')?.hasAttribute('error'));
        check('TASK-932: ...and so is the message', !field(f, 'agree')?.shadowRoot?.querySelector('.toggle-error'));
      }

      // Birko TASK-133: a `radio` field. Its members carried no data-path, so the field was missing from getValues()
      // and validate().data, a required group could never pass, and nothing could address it. Now the members sit in
      // one group element that carries the path (role=radiogroup), and the helpers read and write the checked member.
      {
        type RForm = Form & {
          reset(): void; getValues(): Record<string, unknown>; setFieldError(p: string, e: string): void;
          focusField(p: string): void; onFieldChange(p: string, cb: (v: unknown) => void): () => void;
        };
        const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Bravo' }];
        const f = await mkForm([
          { name: 'pick', type: 'radio', label: 'Pick', required: true, options: opts },
          { name: 'sub', label: 'Sub', children: [{ name: 'size', type: 'radio', label: 'Size', options: opts, value: 'b', default: 'b' }] },
        ]) as RForm;
        const groupEl = (n: string) => f.shadowRoot?.querySelector<HTMLElement>(`[data-path="${n}"]`) ?? null;
        const members = (n: string) => [...(groupEl(n)?.querySelectorAll<HTMLElement>('b-radio') ?? [])];
        const clickMember = async (n: string, value: string) => {
          const m = members(n).find((x) => x.getAttribute('value') === value);
          m?.shadowRoot?.querySelector<HTMLInputElement>('input')?.click();
          await settle();
        };
        check('TASK-133: one element carries the radio field\'s path, holding its members',
          f.shadowRoot?.querySelectorAll('[data-path="pick"]').length === 1 && members('pick').length === 2);
        check(`TASK-133: that element is a named radiogroup (${groupEl('pick')?.getAttribute('role')}, ${groupEl('pick')?.getAttribute('aria-label')})`,
          groupEl('pick')?.getAttribute('role') === 'radiogroup' && groupEl('pick')?.getAttribute('aria-label') === 'Pick');
        let res = f.validate();
        check(`TASK-133: nothing picked, a required group fails with ONE message (${JSON.stringify(res.errors)})`,
          res.errors['pick'] === 'Pick is required' && Object.keys(res.errors).filter((k) => k.startsWith('pick')).length === 1);
        const shownError = groupEl('pick')?.querySelector('.b-form-radio-error');
        check(`TASK-133: the error is shown on the group ("${shownError?.textContent ?? ''}")`,
          shownError?.textContent === 'Pick is required' && !(shownError as HTMLElement | null)?.hidden);
        const changes: unknown[] = [];
        f.addEventListener('change', (e) => { const d = (e as CustomEvent).detail; if (d?.path === 'pick') changes.push(d.value); });
        const cb: unknown[] = [];
        f.onFieldChange('pick', (v) => cb.push(v));
        await clickMember('pick', 'a');
        await settle();
        res = f.validate();
        check(`TASK-133: a click picks it: valid, the value in data (${JSON.stringify(res.data)})`,
          res.valid === true && res.data['pick'] === 'a');
        check('TASK-133: ...and the error is cleared', !groupEl('pick')?.querySelector('.b-form-radio-error:not([hidden])'));
        check(`TASK-133: the click emits change with the path and value, and the callback runs (${JSON.stringify(changes)}, ${JSON.stringify(cb)})`,
          changes.at(-1) === 'a' && cb.at(-1) === 'a');
        await clickMember('pick', 'b');
        check(`TASK-133: picking the other member moves the value (${JSON.stringify(f.getValues()['pick'])}); one checked`,
          f.getValues()['pick'] === 'b' && members('pick').filter((m) => m.hasAttribute('checked')).length === 1);
        check(`TASK-133: a nested radio collects under its group, its declared value rendered checked (${JSON.stringify(f.getValues()['sub'])})`,
          (f.getValues()['sub'] as Record<string, unknown>)?.['size'] === 'b');
        f.setValues({ pick: 'a', sub: { size: 'a' } });
        await settle();
        check(`TASK-133: setValues selects the right members (${JSON.stringify(f.getValues())})`,
          f.getValues()['pick'] === 'a' && (f.getValues()['sub'] as Record<string, unknown>)['size'] === 'a'
            && members('pick').find((m) => m.getAttribute('value') === 'a')?.hasAttribute('checked') === true);
        f.reset();
        await settle();
        check(`TASK-133: reset clears a group with no default and restores one with a default (${JSON.stringify(f.getValues())})`,
          f.getValues()['pick'] === '' && (f.getValues()['sub'] as Record<string, unknown>)['size'] === 'b'
            && members('pick').every((m) => !m.hasAttribute('checked')));
        f.setFieldError('pick', 'Server says no');
        check('TASK-133: setFieldError shows on the group',
          groupEl('pick')?.querySelector('.b-form-radio-error')?.textContent === 'Server says no');
        f.setFieldDisabled('pick', true);
        await settle();
        check('TASK-133: setFieldDisabled disables every member', members('pick').every((m) => m.hasAttribute('disabled')));
        f.setFieldDisabled('pick', false);
        await settle();
        f.focusField('pick');
        const active = members('pick').find((m) => m.shadowRoot?.activeElement);
        check(`TASK-133: focusField puts focus on a member (${active?.getAttribute('value') ?? 'none'})`, !!active);
      }

      // Found while building the above, and fixed alongside it: a field emptied by the user must STAY
      // empty across a re-render. `b-input` restored `this._value || this.attr('value')`, so `''` fell
      // through to the schema-declared value — and re-renders arrive from ordinary things, dropping the
      // `error` attribute here among them. The old text sprang back into the box, `required` did not
      // fire, and the form saved the value the user had just deleted.
      {
        const f = await mkForm([{ name: 'rate', type: 'percent', label: 'Rate', value: '20', rules: [{ type: 'required' }] }]);
        check('a schema-declared value is still shown initially', innerOf(f, 'rate')?.value === '20');
        await setVal(f, 'rate', 'abc');
        check('a junk value over a schema-declared one is refused', f.validate().valid === false);
        await setVal(f, 'rate', '');
        check('clearing a field with a declared value leaves the box empty across the re-render',
          innerOf(f, 'rate')?.value === '');
        const res = f.validate();
        check('...so validate() reports required instead of collecting the resurrected value',
          res.valid === false && res.errors['rate'] === 'Rate is required');
      }

      // A disabled field is barred from constraint validation natively; b-form disables fields for
      // `readonly` / `disabled` / `field.disabled`, so its junk must not block the form either.
      {
        const f = await mkForm([{ name: 'weight', type: 'decimal', label: 'Weight' }]);
        await setVal(f, 'weight', 'abc');
        check('premise: the junk fails while the field is enabled', f.validate().valid === false);
        f.setFieldDisabled('weight', true);
        await settle();
        check('a DISABLED field\'s badInput does not block the form (willValidate is honoured)',
          f.validate().valid === true);
      }

      // Nested groups: the verdict has to land on the dot-path, and the null has to reach into the branch.
      {
        const f = await mkForm([
          { name: 'inner', label: 'Inner', children: [{ name: 'rate', type: 'percent', label: 'Rate' }] },
        ]);
        await setVal(f, 'inner.rate', 'abc');
        const res = f.validate();
        check('a nested field reports under its dot-path', res.valid === false && !!res.errors['inner.rate']);
        check('...and the null lands inside the nested branch, not as a flat key',
          (res.data['inner'] as Record<string, unknown>)['rate'] === null && !('inner.rate' in res.data));
      }

      host.remove();
    }

    // Reps device pass 2026-08-10 — `fetch` has no timeout of its own, so a connection that dies
    // without sending a reset (a sleeping phone, a dropped tunnel, a captive portal black-holing the
    // packet) leaves the promise pending for the life of the page. It cost a fully-performed workout:
    // the write never reached the server, was never queued — queueing keys off a REJECTED fetch — and
    // every caller awaiting it wedged, because an `await` on a never-settling promise does not continue,
    // not even into a `finally`.
    //
    // Every assertion below is bounded by `settleWithin`, deliberately: the regression these guard
    // against is a promise that never settles, so an unbounded `await` would hang the whole suite
    // instead of reporting a failure.
    {
      const realFetch2 = globalThis.fetch;
      const PENDING = Symbol('pending');
      const settleWithin = async <R>(p: Promise<R>, ms: number): Promise<R | typeof PENDING> =>
        Promise.race([p, new Promise<typeof PENDING>((r) => setTimeout(() => r(PENDING), ms))]);

      /** Rejects the way a real aborted `fetch` does, so the client sees a genuine AbortError. */
      const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
      const onAbort = (signal: AbortSignal | null | undefined, reject: (e: unknown) => void) => {
        if (!signal) return;
        if (signal.aborted) reject(abortError());
        else signal.addEventListener('abort', () => reject(abortError()));
      };

      try {
        // (a) The reported case: a fetch that never answers.
        globalThis.fetch = ((_u: unknown, init?: RequestInit) =>
          new Promise((_res, rej) => onAbort(init?.signal, rej))) as typeof fetch;
        const stalled = new ApiClient({ baseUrl: 'https://smoke.test', timeoutMs: 60 });
        const rStalled = await settleWithin(stalled.get('items'), 1500);
        check('ApiClient: a fetch that never answers still SETTLES (it used to hang forever)',
          rStalled !== PENDING);
        check('...and reports the network-error envelope, so a read falls back to its mirror',
          rStalled !== PENDING && rStalled.ok === false && rStalled.status === 0);

        // (b) A write must reach the outbox. It keys off the failure envelope, so this is the check that
        // actually corresponds to the lost workout.
        let queued = '';
        const writer = new ApiClient({
          baseUrl: 'https://smoke.test',
          timeoutMs: 60,
          onQueueAction: async () => { queued = 'queued-1'; return queued; },
        });
        const rWrite = await settleWithin(
          writer.post('sets', { reps: 5 }, { moduleId: 'workout', action: 'create', entity: 'set' } as never),
          1500,
        );
        check('ApiClient: a timed-out WRITE is queued for retry rather than lost',
          rWrite !== PENDING && queued === 'queued-1');

        // (c) The half the original fix missed: headers arrive, the BODY stalls. The abort then throws
        // from `response.json()`, not from `fetch`, and the body-read catch used to swallow it as a
        // malformed body — returning the response's own `ok: true, status: 200, data: null`. A write
        // would be reported as SUCCEEDED and never queued: the same silent wrong answer, one layer down.
        globalThis.fetch = ((_u: unknown, init?: RequestInit) => Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => new Promise((_res, rej) => onAbort(init?.signal, rej)),
          text: () => new Promise((_res, rej) => onAbort(init?.signal, rej)),
        } as unknown as Response)) as typeof fetch;

        const bodyStall = new ApiClient({ baseUrl: 'https://smoke.test', timeoutMs: 60 });
        const rBody = await settleWithin(bodyStall.get('items'), 1500);
        check('ApiClient: a stalled response BODY settles too', rBody !== PENDING);
        check('...and is reported as a failure, NOT as ok:200 with null data',
          rBody !== PENDING && rBody.ok === false && rBody.status === 0);

        let queuedBody = '';
        const bodyWriter = new ApiClient({
          baseUrl: 'https://smoke.test',
          timeoutMs: 60,
          onQueueAction: async () => { queuedBody = 'queued-2'; return queuedBody; },
        });
        const rBodyWrite = await settleWithin(
          bodyWriter.post('sets', { reps: 5 }, { moduleId: 'workout', action: 'create', entity: 'set' } as never),
          1500,
        );
        check('ApiClient: a write whose body stalls is queued, not reported as saved',
          rBodyWrite !== PENDING && queuedBody === 'queued-2');

        // (d) Back-compat: a prompt response must not be disturbed by the timer.
        globalThis.fetch = (async () => new Response(JSON.stringify({ id: 7 }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;
        const fast = new ApiClient({ baseUrl: 'https://smoke.test', timeoutMs: 60 });
        const rFast = await settleWithin(fast.get<{ id: number }>('items'), 1500);
        check('ApiClient: a fast response is untouched by the timeout',
          rFast !== PENDING && rFast.ok === true && (rFast.data as { id: number })?.id === 7);

        // (e) The documented escape hatch: `timeoutMs: 0` restores the old unbounded behaviour. Asserted
        // as still-PENDING, which is the only observable difference — and it is why this check must be
        // bounded rather than awaited.
        globalThis.fetch = ((_u: unknown, init?: RequestInit) =>
          new Promise((_res, rej) => onAbort(init?.signal, rej))) as typeof fetch;
        const disabled = new ApiClient({ baseUrl: 'https://smoke.test', timeoutMs: 0 });
        const rDisabled = await settleWithin(disabled.get('items'), 300);
        check('ApiClient: timeoutMs 0 disables the timeout, as documented', rDisabled === PENDING);

        // (f) The default is a contract — a consumer relying on the outbox should not have it retuned
        // silently. Generous on purpose: firing early is cheap because an abort is handled like any
        // network error.
        check('ApiClient: the default request timeout is 20s',
          DEFAULT_REQUEST_TIMEOUT_MS === 20_000);
      } finally {
        globalThis.fetch = realFetch2;
      }
    }

    // Symbio (2026-07-31) — `ApiClient.get` appended '?' UNCONDITIONALLY, so a caller combining an
    // endpoint that already carries a query string with `params` produced two '?' in one URL:
    //
    //   api/warehouse/stock?warehouseConfigId=W1  +  { page: '1', pageSize: '20' }
    //   -> api/warehouse/stock?warehouseConfigId=W1?page=1&pageSize=20
    //
    // The server then read warehouseConfigId as `W1?page=1` and returned an EMPTY list — no error, no
    // console message, no failing request, just a list rendering "No data" while the API has rows. Latent
    // for as long as no caller did both; it became reachable from ordinary code the moment b-data-table
    // began sending page/pageSize on a first load, and a scoped list endpoint carrying its own query
    // string is a normal pattern.
    //
    // Guarded consumer-side only until now (Symbio's list-paging-consistency-check spec), which is the
    // wrong home for it: the defect is in a shared client, so every other consumer was unguarded.
    //
    // Asserted by parsing the URL the client actually handed to `fetch` and reading the inline param back
    // BY NAME — that is the server's own reading of it, and it is the assertion the defect fails. A
    // '?'-count check alone would bless any fix that merely relocated the corruption.
    {
      const realFetch3 = globalThis.fetch;
      let seen = '';
      try {
        globalThis.fetch = ((u: unknown) => {
          seen = String(u);
          return Promise.resolve(new Response('[]', {
            status: 200, headers: { 'Content-Type': 'application/json' },
          }));
        }) as typeof fetch;
        const qc = new ApiClient({ baseUrl: 'https://smoke.test' });

        // (a) The reported case. `warehouseConfigId` must read back as exactly 'W1'.
        await qc.get('api/warehouse/stock?warehouseConfigId=W1', { page: '1', pageSize: '20' });
        const scoped = new URL(seen).searchParams;
        check('ApiClient.get: an inline query param survives added params intact',
          scoped.get('warehouseConfigId') === 'W1');
        check('...and the added params are readable alongside it, not swallowed by the inline one',
          scoped.get('page') === '1' && scoped.get('pageSize') === '20');
        check('...so the URL carries exactly one "?"',
          (seen.match(/\?/g) ?? []).length === 1);

        // (b) Back-compat: a bare path still gets its '?'. Green on a revert, by design.
        await qc.get('api/warehouse/stock', { page: '2' });
        check('ApiClient.get: a path with no query string still gets "?" (back-compat)',
          new URL(seen).searchParams.get('page') === '2' && (seen.match(/\?/g) ?? []).length === 1);

        // (c) Back-compat: neither an absent nor an empty params object may append a separator.
        await qc.get('api/warehouse/stock?warehouseConfigId=W1');
        check('ApiClient.get: absent params leave the path untouched (back-compat)',
          seen.endsWith('api/warehouse/stock?warehouseConfigId=W1'));
        await qc.get('api/warehouse/stock?warehouseConfigId=W1', {});
        check('ApiClient.get: an empty params object appends no separator (back-compat)',
          seen.endsWith('api/warehouse/stock?warehouseConfigId=W1'));
      } finally {
        globalThis.fetch = realFetch3;
      }
    }

    // Review of the ApiClient timeout fix (2026-08-11) — `SyncManager` had no name for an outbox entry
    // whose write had ALREADY LANDED, so it read two such cases as something else:
    //
    //   DELETE -> 404   the row is gone, which is what the action wanted. Read as `failed`, and since
    //                   getPending() includes `failed` it was re-sent on EVERY sync forever.
    //   POST   -> 409   for a create whose id the client minted, the clash IS this create. Read as a
    //                   conflict: the user was told their SUCCESSFUL write conflicted, and the entry
    //                   wedged, because a `conflict` entry is neither retried nor removed by anything.
    //
    // Grounded in two consumers that fail in opposite directions. Reps mints guids client-side and its
    // server answers 409 on a pinned-id clash (MapOwnedCrud + RequestGuid), so it hit the false conflict.
    // Symbio mints no ids at all, so its 409s are business rules only — which is exactly why `idPinned`
    // is declared per write instead of inferred: draining a business 409 would discard a rejected write
    // and report success.
    //
    // A real ActionQueue on real IndexedDB, one database per case so nothing leaks between them.
    {
      const realFetch4 = globalThis.fetch;
      let dbSeq = 0;
      /** Enqueue one action, replay it against a stubbed status, and report what the queue did. */
      const replay = async (
        method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        status: number,
        metadata: Record<string, unknown>,
        options: Record<string, unknown> = {},
      ) => {
        dbSeq += 1;
        const queue = new ActionQueue({ dbName: `pg_replay_${dbSeq}` });
        await queue.clear();
        await queue.enqueue({ method, path: 'things', body: { a: 1 }, metadata: metadata as never });
        let lastMethod = '';
        globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
          lastMethod = init?.method ?? 'GET';
          return new Response(JSON.stringify({ error: 'x' }), {
            status, headers: { 'Content-Type': 'application/json' },
          });
        }) as typeof fetch;
        const mgr = new SyncManager(queue, new ApiClient({ baseUrl: 'https://smoke.test' }), options);
        let conflicted = false;
        const un = mgr.onConflict(() => { conflicted = true; });
        const result = await mgr.sync();
        un();
        mgr.dispose();
        const left = await queue.getAll();
        return { result, conflicted, left, lastMethod };
      };

      try {
        const meta = { moduleId: 'm', description: 'd' };

        // (a) The retry-forever loop. Symbio filed this symptom as TASK-151 on 2026-07-08 and scoped the
        // cause out of it ("409 conflict resolution — already handled"), so it is still open.
        const delGone = await replay('DELETE', 404, meta);
        check('SyncManager: a DELETE whose row is already gone DRAINS from the outbox',
          delGone.left.length === 0 && delGone.result.synced === 1);
        check('...and is not reported as a failure to retry', delGone.result.failed === 0);

        // (b) The false conflict, and the reason `idPinned` exists.
        const pinned = await replay('POST', 409, { ...meta, idPinned: true });
        check('SyncManager: an id-pinned POST whose id already exists DRAINS (the create landed)',
          pinned.left.length === 0 && pinned.result.synced === 1);
        check('...and raises NO conflict against a write that succeeded', !pinned.conflicted);

        // (c) Back-compat, and the check that matters most: an UNPINNED POST's 409 is a business
        // rejection (Symbio's whole 409 surface, and Reps' slot-uniqueness rule). Draining it would
        // discard a rejected write and report success. Green before and after the fix, by design.
        const unpinned = await replay('POST', 409, meta);
        check('SyncManager: an unpinned POST 409 is still a CONFLICT, not drained (back-compat)',
          unpinned.conflicted && unpinned.result.conflicts === 1 && unpinned.left.length === 1);

        // (d) PUT is deliberately excluded even when pinned: it is addressed by id already, so its 409 is
        // about the entity's STATE — an optimistic-concurrency clash for the user to resolve.
        const putPinned = await replay('PUT', 409, { ...meta, idPinned: true });
        check('SyncManager: a PUT 409 stays a conflict even when idPinned is set',
          putPinned.conflicted && putPinned.left.length === 1);

        // (e) A DELETE that fails for a reason a retry COULD fix must still be retried.
        const delErr = await replay('DELETE', 500, meta);
        check('SyncManager: a DELETE 500 is still a failure to retry (back-compat)',
          delErr.result.failed === 1 && delErr.left.length === 1);

        // (f) The escape hatch, for an API whose 404-on-DELETE means something else.
        const delOptOut = await replay('DELETE', 404, meta, { deleteMissingIsApplied: false });
        check('SyncManager: deleteMissingIsApplied false restores the previous behaviour',
          delOptOut.result.failed === 1 && delOptOut.left.length === 1);

        // (g) TASK-493 — a queued PATCH must replay AS PATCH. It is dispatched through the same chain,
        // whose final arm is `delete`: falling through there would silently DELETE a row the user only
        // meant to partially update. 500 (not 409/404) keeps the classification out of the way and makes
        // the request itself the thing under test.
        const patched = await replay('PATCH', 500, meta);
        check('TASK-493 SyncManager: a queued PATCH replays as PATCH, not DELETE',
          patched.lastMethod === 'PATCH' && patched.result.failed === 1 && patched.left.length === 1);
      } finally {
        globalThis.fetch = realFetch4;
      }
    }

    // Review follow-up — the '?'-vs-'&' separator now has ONE home. `SseClient` and `WsClient` had been
    // choosing it correctly for as long as `ApiClient.get` had been getting it wrong, three lines apart in
    // the same folder; `appendQuery` is that shared idiom, and it is exported so a consumer can reuse it.
    check('appendQuery: first param gets "?"', appendQuery('api/x', 'a=1') === 'api/x?a=1');
    check('appendQuery: a later param gets "&"', appendQuery('api/x?a=1', 'b=2') === 'api/x?a=1&b=2');
    check('appendQuery: an empty query leaves the url untouched', appendQuery('api/x?a=1', '') === 'api/x?a=1');

    // Review follow-up — a timed-out POST-REFRESH RETRY was the one completely silent failure in the
    // client: that catch returned the status-0 envelope with no log at all, while the other two arms
    // distinguish "Timed out" from "Network error". It shares ONE timeout budget with the first fetch and
    // the refresh call, so it is the arm most likely to be the one that aborts. The log is the only
    // observable, so the log is what this asserts.
    {
      const realFetch5 = globalThis.fetch;
      const realError = console.error;
      const logged: string[] = [];
      try {
        console.error = (...args: unknown[]) => { logged.push(String(args[0])); };
        let call = 0;
        globalThis.fetch = ((_u: unknown, init?: RequestInit) => {
          call += 1;
          if (call === 1) return Promise.resolve(new Response('', { status: 401 }));
          // The retry stalls until the client's own timer aborts it.
          return new Promise((_res, rej) => {
            const s = init?.signal;
            s?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
          });
        }) as typeof fetch;
        const refresher = new ApiClient({
          baseUrl: 'https://smoke.test',
          timeoutMs: 60,
          getToken: () => 'stale',
          onRefreshToken: async () => 'fresh',
        });
        const resp = await refresher.get('items');
        check('ApiClient: a timed-out post-refresh retry still reports the network envelope',
          resp.ok === false && resp.status === 0);
        check('ApiClient: ...and SAYS it timed out on the retry, instead of failing silently',
          logged.some((m) => m.includes('Timed out') && m.includes('post-refresh retry')));
      } finally {
        console.error = realError;
        globalThis.fetch = realFetch5;
      }
    }

    // Symbio TASK-301 — b-chart's time axis was always a clock.
    //
    // `_formatTime` only ever produced HH:mm, mm:ss or HH:mm:ss; there was no date format at all. The
    // axis was built for streaming charts (realTime.windowMs defaults to five minutes, where a clock
    // tick is right), but ANY series with timestamp x values reuses it. A month of daily samples
    // rendered as 02:00:00 · 16:25:13 · 06:50:26 — no date, and because time-of-day WRAPS the labels
    // did not even read as increasing.
    //
    // Asserted off the RENDERED tick text rather than by calling a helper: `_timeFormatFor` is private,
    // and the defect was what the user saw on the axis. X ticks are the `text-anchor="middle"`
    // `.axis-label`s (the y ticks are the `end`-anchored ones).
    {
      const DAY = 86_400_000;
      const chartHost = document.createElement('div');
      chartHost.style.cssText = 'position:absolute;left:-9999px;width:600px;height:300px';
      document.body.appendChild(chartHost);

      const xLabels = async (spanMs: number, points: number, opts?: Record<string, unknown>) => {
        const el = document.createElement('b-chart') as BChart;
        el.style.cssText = 'width:600px;height:300px;display:block';
        // `type` is an ATTRIBUTE, not a ChartOptions field — passing it to setOptions is silently
        // ignored and you get the default bar renderer, whose thinned category labels look enough like
        // an axis to fool an assertion. That is the same footgun this fix's own commit message flags
        // about `xAxis: { type: 'time' }`, and it made the first version of these checks pass for the
        // wrong reason: "no label is a clock" is trivially true of "0","3","6",…
        el.setAttribute('type', 'line');
        chartHost.appendChild(el);
        const t0 = Date.UTC(2026, 6, 1, 2, 0, 0);   // fixed epoch: no Date.now() in an assertion
        el.setOptions({ ...(opts ?? {}) } as never);
        el.setData({
          series: [{
            id: 's', label: 'Stock',
            data: Array.from({ length: points }, (_, i) => ({
              x: t0 + (i / (points - 1)) * spanMs, y: 10 + i,
            })),
          }],
        } as never);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const texts = [...(el.shadowRoot?.querySelectorAll('text.axis-label') ?? [])]
          .filter((t) => t.getAttribute('text-anchor') === 'middle')
          .map((t) => (t.textContent ?? '').trim())
          .filter(Boolean);
        el.remove();
        return texts;
      };

      const CLOCK = /^\d{2}:\d{2}:\d{2}$/;
      // Two digits, a locale separator, two digits — `07/19`, `19.07`. Deliberately NOT the exact
      // pattern for one locale: the axis follows <html lang>, so pinning `MM/DD` would make this check
      // a locale assertion rather than a format one.
      const DATEISH = /^\d{2}[./-]\d{2}$/;

      // The reported case: 30 daily samples.
      const monthly = await xLabels(30 * DAY, 30);
      check('b-chart: a month of daily samples produces axis labels at all', monthly.length > 0);
      check('b-chart: ...and every tick is a DATE (the reported defect rendered them as clock times)',
        monthly.length > 0 && monthly.every((l) => DATEISH.test(l)));
      check('b-chart: ...so no tick is a bare wall-clock time',
        monthly.every((l) => !CLOCK.test(l)));
      check('b-chart: ...and the labels are distinct, so the axis reads as progressing',
        new Set(monthly).size === monthly.length);

      // Back-compat: the streaming window this axis was designed for must be untouched.
      const streaming = await xLabels(5 * 60_000, 30);
      check('b-chart: a 5-minute streaming window still labels HH:mm:ss',
        streaming.length > 0 && streaming.every((l) => CLOCK.test(l)));

      // An explicit timeFormat still wins — a streaming caller that says HH:mm:ss keeps it even on a
      // span where the new default would disagree.
      const forced = await xLabels(30 * DAY, 30, { realTime: { timeFormat: 'HH:mm:ss' } });
      check('b-chart: an explicit realTime.timeFormat still overrides the span-aware default',
        forced.length > 0 && forced.every((l) => CLOCK.test(l)));

      // Multi-year, where dates alone would collide.
      const multiYear = await xLabels(3 * 365 * DAY, 24);
      check('b-chart: a multi-year span drops to month/year rather than colliding on dates',
        multiYear.length > 0 && multiYear.every((l) => /^\d{2}[./-]\s?\d{4}$/.test(l))
        && new Set(multiYear).size === multiYear.length);

      // Within a single day the clock IS the useful axis, but seconds are noise — this is the rung
      // that changed for existing charts, so it is asserted rather than left implicit.
      const intraDay = await xLabels(6 * 3_600_000, 30);
      check('b-chart: a several-hour span labels HH:mm — no date, and no seconds',
        intraDay.length > 0 && intraDay.every((l) => /^\d{2}:\d{2}$/.test(l)));

      chartHost.remove();
    }

    // WorkoutTracker TASK-129 — a DECLARATION guard, deliberately not a reproduction.
    //
    // The defect is a `vh`-sized body under BCoreAppShell's `dvh` :host, which on Android Chrome in a tab
    // makes the body exactly the URL-bar height (measured 56px) taller than the shell — dead scroll that
    // drags the bottom nav behind the system navigation bar. It CANNOT be reproduced headlessly: with no
    // retractable browser chrome `vh == dvh`, so any assertion on a computed height or on scrollHeight
    // passes whether or not the bug is present, at every viewport size. That is why this reads the shipped
    // stylesheet text rather than calling getComputedStyle — the text is the only thing that still differs
    // once the platform condition is gone. It catches a future edit dropping the line; it does not prove
    // the defect fixed, and must not be reported as covering it.
    {
      const resetCss = (await (await fetch('css/reset.css')).text()).replace(/\/\*[\s\S]*?\*\//g, '');
      const bodyDecls = /(?:^|\})\s*body\s*\{([^}]*)\}/.exec(resetCss)?.[1] ?? '';
      const minHeights = [...bodyDecls.matchAll(/min-height\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
      check('reset.css body declares a dvh min-height (WorkoutTracker TASK-129)',
        minHeights.some((v) => v.includes('dvh')));
      // Ordering is part of the fix, not a style preference: a browser without dvh support drops the second
      // declaration, so vh must come first or such a browser gets no body height at all.
      check('...with the vh fallback declared first, so a no-dvh browser still gets a height',
        minHeights.findIndex((v) => v.includes('vh') && !v.includes('dvh')) === 0
        && minHeights.findIndex((v) => v.includes('dvh')) > 0);
    }

    // Birko TASK-934 (Symbio TASK-1071): a b-dropdown-menu item's `heading` renders a non-clickable label before it
    // (after its divider) and opens a role=group named by the label, running to the next divider or heading. The label
    // is never focused, arrow keys skip it, and items without a heading render as before.
    {
      type Menu = HTMLElement & { setItems(i: unknown[]): void; show(): void; hide(): void };
      const dd = document.createElement('b-dropdown-menu') as Menu;
      dd.id = 'smoke-heading-menu';
      dd.innerHTML = '<button slot="trigger">Menu</button>';
      document.body.appendChild(dd);
      await new Promise((r) => setTimeout(r, 0));
      dd.setItems([
        { id: 'profile', label: 'Profile' },
        { id: 'en', label: 'English', divider: true, heading: 'Language' },
        { id: 'sk', label: 'Slovenčina' },
        { id: 'out', label: 'Sign out', divider: true },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      const root = dd.shadowRoot!;
      const menu = root.querySelector<HTMLElement>('.menu')!;
      const kids = [...menu.children].map((c) => c.classList.contains('group')
        ? `group[${[...c.children].map((g) => g.className.trim().split(' ')[0]).join(',')}]`
        : c.className.trim().split(' ')[0]);
      check(`TASK-934: divider, then a group holding the heading and its items, closed at the next divider (${kids.join(' ')})`,
        kids.join(' ') === 'item divider group[heading,item,item] divider item');
      const group = menu.querySelector<HTMLElement>('.group');
      const heading = menu.querySelector<HTMLElement>('.heading');
      check('TASK-934: the group is a role=group named by the heading',
        group?.getAttribute('role') === 'group' && !!heading && group?.getAttribute('aria-labelledby') === heading.id
        && heading.textContent === 'Language');
      check('TASK-934: the heading is not a menu item and cannot take focus',
        heading?.getAttribute('role') !== 'menuitem' && heading?.tabIndex === -1 && heading?.getAttribute('aria-hidden') === 'true');
      check('TASK-934: the items stay ordinary menu items',
        [...menu.querySelectorAll('.item')].every((b) => b.getAttribute('role') === 'menuitem')
        && menu.querySelectorAll('.item').length === 4);
      const selected: string[] = [];
      dd.addEventListener('select', (e) => selected.push((e as CustomEvent<{ id: string }>).detail.id));
      dd.show();
      await new Promise((r) => setTimeout(r, 0));
      heading?.click();
      check(`TASK-934: clicking the heading selects nothing and keeps the menu open (${selected.join(',') || 'none'})`,
        selected.length === 0 && menu.matches(':popover-open'));
      const focusedId = () => (root.activeElement as HTMLElement | null)?.dataset.id ?? 'none';
      const press = (key: string) => menu.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const walk = [focusedId()];
      for (let i = 0; i < 4; i++) { press('ArrowDown'); walk.push(focusedId()); }
      check(`TASK-934: arrow keys walk the items and skip the heading (${walk.join(' > ')})`,
        walk.join(' > ') === 'profile > en > sk > out > profile');
      press('ArrowUp');
      check(`TASK-934: ...in both directions (${focusedId()})`, focusedId() === 'out');
      dd.setItems([{ id: 'a', label: 'A' }, { id: 'b', label: 'B', divider: true }]);
      await new Promise((r) => setTimeout(r, 0));
      check('TASK-934: items without a heading render no group or heading',
        !root.querySelector('.group') && !root.querySelector('.heading') && root.querySelectorAll('.menu > .item').length === 2);
      dd.hide();
      dd.remove();
    }

    // Birko TASK-935 (Symbio TASK-1071): b-dropdown-menu inherited the shared panel's 12.5rem cap, so an ordinary action
    // menu (Symbio's user menu: 6 rows, 2 dividers and a heading, ~240 px) scrolled on a desktop screen. The menu is now
    // capped only by the room on the side it opens: a menu that fits shows every row; a taller one stays on screen
    // and scrolls.
    {
      type Menu = HTMLElement & { setItems(i: unknown[]): void; show(): void; hide(): void };
      const mk = async (n: number) => {
        const dd = document.createElement('b-dropdown-menu') as Menu;
        dd.id = `smoke-cap-menu-${n}`;
        dd.style.cssText = 'position: fixed; top: 8px; left: 8px;';
        dd.innerHTML = '<button slot="trigger">Menu</button>';
        document.body.appendChild(dd);
        await new Promise((r) => setTimeout(r, 0));
        dd.setItems(Array.from({ length: n }, (_, i) => ({
          id: `r${i}`, label: `Row ${i}`, divider: i === 3 || i === 7, heading: i === 3 ? 'Group' : undefined,
        })));
        await new Promise((r) => setTimeout(r, 0));
        dd.show();
        await new Promise((r) => setTimeout(r, 0));
        return { dd, menu: dd.shadowRoot!.querySelector<HTMLElement>('.menu')! };
      };
      {
        const { dd, menu } = await mk(10);
        check(`TASK-935: a 10-row menu taller than 12.5rem shows every row, no scroll (${menu.clientHeight}/${menu.scrollHeight}px)`,
          menu.scrollHeight > 200 && menu.scrollHeight <= menu.clientHeight);
        dd.hide(); dd.remove();
      }
      {
        const { dd, menu } = await mk(40);
        const r = menu.getBoundingClientRect();
        check(`TASK-935: a menu taller than the room below stays on screen and scrolls (bottom ${Math.round(r.bottom)} of ${window.innerHeight}, ${menu.clientHeight}/${menu.scrollHeight}px)`,
          r.bottom <= window.innerHeight && menu.scrollHeight > menu.clientHeight);
        dd.hide(); dd.remove();
      }
    }

    // Birko TASK-936 (Symbio): a non-searchable b-select renders a native <select> whose placeholder option was always
    // disabled, and `clearable` (which BaseCrudPage puts on filter selects) was ignored, so a filter set to a value
    // could never go back to "any". With `clearable` the empty option is pickable and clears the value.
    {
      type Sel = HTMLElement & { setOptions(o: { value: string; label: string }[]): void };
      const mk = async (attrs: string) => {
        const host = document.createElement('div');
        host.innerHTML = `<b-select name="pub" placeholder="Any state" ${attrs}></b-select>`;
        document.body.appendChild(host);
        const el = host.querySelector('b-select') as Sel;
        await new Promise((r) => setTimeout(r, 0));
        el.setOptions([{ value: 'true', label: 'Shown' }, { value: 'false', label: 'Hidden' }]);
        await new Promise((r) => setTimeout(r, 0));
        return { host, el, sel: () => el.shadowRoot!.querySelector('select')! };
      };
      const pick = (s: HTMLSelectElement, v: string) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
      {
        const { host, el, sel } = await mk('clearable');
        const seen: string[] = [];
        el.addEventListener('change', (e) => seen.push((e as CustomEvent).detail.value));
        pick(sel(), 'true');
        await new Promise((r) => setTimeout(r, 0));
        const empty = sel().querySelector<HTMLOptionElement>('option[value=""]');
        check(`TASK-936: a clearable select keeps its placeholder option pickable (${empty ? (empty.disabled ? 'disabled' : 'enabled') : 'missing'})`,
          !!empty && !empty.disabled && empty.textContent === 'Any state');
        pick(sel(), '');
        await new Promise((r) => setTimeout(r, 0));
        check(`TASK-936: picking it clears the value (events ${JSON.stringify(seen)}, value attr ${el.getAttribute('value')})`,
          seen.join(',') === 'true,' && !el.hasAttribute('value') && sel().value === '');
        host.remove();
      }
      {
        const { host, sel } = await mk('');
        const empty = sel().querySelector<HTMLOptionElement>('option[value=""]');
        check('TASK-936: without clearable the placeholder stays a disabled prompt', !!empty && empty.disabled);
        host.remove();
      }
    }

    // Birko TASK-937: TASK-936 made a plain b-select clearable, but b-form select fields and ribbon select fields had no
    // way to ask for it, so an optional form select or a ribbon filter could not go back to no value. Both now take an
    // opt-in `clearable` and pass it through; without it nothing changes.
    {
      const pick = (s: HTMLSelectElement, v: string) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };
      const settle = () => new Promise((r) => setTimeout(r, 30));
      const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
      {
        const form = document.createElement('b-form') as HTMLElement & { setSchema(s: unknown): void; getValues(): Record<string, unknown> };
        document.body.appendChild(form);
        await settle();
        form.setSchema({ name: 'root', children: [
          { name: 'kind', type: 'select', label: 'Kind', placeholder: 'Any kind', clearable: true, options: opts },
          { name: 'plain', type: 'select', label: 'Plain', placeholder: 'Pick', options: opts },
        ] });
        await settle();
        const ctl = (n: string) => (form.shadowRoot?.querySelector(`[data-path="${n}"]`) ?? form.querySelector(`[data-path="${n}"]`)) as HTMLElement | null;
        const sel = (n: string) => ctl(n)?.shadowRoot?.querySelector('select') ?? null;
        check(`TASK-937: a b-form select field passes clearable through (${ctl('kind')?.hasAttribute('clearable')})`, !!ctl('kind')?.hasAttribute('clearable'));
        pick(sel('kind')!, 'a');
        await settle();
        pick(sel('kind')!, '');
        await settle();
        const v = form.getValues().kind;
        const formEmpty = sel('kind')?.querySelector<HTMLOptionElement>('option[value=""]');
        check(`TASK-937: a clearable b-form select can be emptied by the user (option ${formEmpty ? (formEmpty.disabled ? 'disabled' : 'enabled') : 'missing'}, value ${JSON.stringify(v)})`,
          !!formEmpty && !formEmpty.disabled && (v === '' || v == null));
        check('TASK-937: a b-form select field without clearable is unchanged',
          !ctl('plain')?.hasAttribute('clearable') && !!sel('plain')?.querySelector<HTMLOptionElement>('option[value=""]')?.disabled);
        form.remove();
      }
      {
        if (!customElements.get('b-ribbon')) define('b-ribbon', BRibbon);
        const ribbon = document.createElement('b-ribbon') as BRibbon;
        ribbon.setAttribute('pinned', '');
        ribbon.setAttribute('expanded', '');
        document.body.appendChild(ribbon);
        ribbon.setTabs([{ id: 'tf', label: 'Filter', groups: [{ id: 'gf', label: 'Filter', items: [
          { id: 'state', label: 'State', field: { type: 'select', clearable: true, placeholder: 'Any state', value: 'a', options: opts } },
          { id: 'other', label: 'Other', field: { type: 'select', value: 'a', options: opts } },
        ] }] }] as RibbonTab[]);
        await settle();
        const changes: string[] = [];
        ribbon.addEventListener('item-change', (e) => changes.push((e as CustomEvent).detail.value));
        const ctl = (id: string) => ribbon.shadowRoot?.querySelector<HTMLElement>(`.ribbon-field-control[data-item="${id}"]`) ?? null;
        check(`TASK-937: a ribbon select field passes clearable through (${ctl('state')?.hasAttribute('clearable')})`, !!ctl('state')?.hasAttribute('clearable'));
        const ribbonEmpty = ctl('state')?.shadowRoot?.querySelector<HTMLOptionElement>('option[value=""]');
        check(`TASK-937: the ribbon field's empty choice is pickable (${ribbonEmpty ? (ribbonEmpty.disabled ? 'disabled' : 'enabled') : 'missing'})`,
          !!ribbonEmpty && !ribbonEmpty.disabled);
        pick(ctl('state')!.shadowRoot!.querySelector('select')!, '');
        await settle();
        check(`TASK-937: picking the empty choice reports an empty value (${JSON.stringify(changes)})`, changes.join('|') === '');
        check(`TASK-937: ...and only once (${changes.length})`, changes.length === 1);
        check('TASK-937: a ribbon select field without clearable is unchanged', !!ctl('other') && !ctl('other')!.hasAttribute('clearable'));
        ribbon.remove();
      }
    }

    // Birko TASK-940: b-data-table drew the row-action trigger on every row and filtered actions by visible(row) only
    // when the menu opened, so a row with no applicable action got a button that opened an empty menu (Symbio's
    // completed / rejected erasure requests). Such a row now gets no trigger; the __actions column stays.
    {
      const client = {
        get: async () => ({ ok: true, status: 200, headers: new Headers(), data: [
          { id: '1', name: 'Open', state: 'open' },
          { id: '2', name: 'Done', state: 'done' },
        ] }),
      };
      const dt = document.createElement('b-data-table') as BDataTable;
      document.body.appendChild(dt);
      dt.setConfig({ endpoint: 'items', columns: dtCols, apiClient: client as never, rowActions: [
        { id: 'approve', label: 'Approve', visible: (r: Record<string, unknown>) => r.state === 'open' },
        { id: 'reject', label: 'Reject', visible: (r: Record<string, unknown>) => r.state === 'open' },
      ] } as never);
      await dt.load();
      await new Promise((r) => setTimeout(r, 10));
      const tbl = dt.shadowRoot?.querySelector('b-table');
      const row = (id: string) => tbl?.shadowRoot?.querySelector(`tbody tr[data-id="${id}"]`) ?? null;
      const triggers = (id: string) => row(id)?.querySelectorAll('.row-action-trigger').length ?? -1;
      const cells = (id: string) => row(id)?.querySelectorAll('td').length ?? -1;
      check(`TASK-940: a row with an applicable action keeps its trigger (${triggers('1')})`, triggers('1') === 1);
      check(`TASK-940: a row with no applicable action has no trigger (${triggers('2')})`, triggers('2') === 0);
      check(`TASK-940: ...but keeps the actions cell (${cells('2')} of ${cells('1')} cells)`, cells('2') === 2 && cells('1') === 2);
      dt.remove();
    }

    // Birko TASK-947 (FEATURE-022 D1-D4, D11): b-kanban locked columns, a move rule, refusing a move as it happens
    // (card-move-request) and undoing one (revertMove). A person cannot move a card into or out of a locked column; the
    // app's own moveCard() still can. Synthetic drag events suffice: b-kanban's handlers read no trusted-only state.
    {
      if (!customElements.get('b-kanban')) define('b-kanban', BKanban);
      type KB = BKanban & { revertMove?: (id: string) => boolean };
      const settle = () => new Promise((r) => setTimeout(r, 30));
      const mk = async (extra: Record<string, unknown> = {}) => {
        const kb = document.createElement('b-kanban') as KB;
        document.body.appendChild(kb);
        kb.setConfig({
          columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress', locked: true }, { id: 'done', label: 'Done' }],
          cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0 }, { id: 'b', columnId: 'todo', title: 'B', order: 1 },
            { id: 'c', columnId: 'doing', title: 'C', order: 0 }],
          ...extra,
        } as never);
        await settle();
        const moves: unknown[] = [];
        kb.addEventListener('card-move', (e) => moves.push((e as CustomEvent).detail));
        kb.addEventListener('card-reorder', (e) => moves.push((e as CustomEvent).detail));
        return { kb, moves };
      };
      const sr = (kb: KB) => kb.shadowRoot!;
      const colOf = (kb: KB, id: string) => kb.getCards().find((c) => c.id === id)?.columnId;
      const live = (kb: KB) => sr(kb).querySelector('[aria-live]')?.textContent?.trim() ?? '';
      const drag = (kb: KB, cardId: string, toColumn: string) => {
        const dt = new DataTransfer();
        const card = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${cardId}"]`)!;
        const start = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt });
        card.dispatchEvent(start);
        const body = sr(kb).querySelector<HTMLElement>(`.column-body[data-column-id="${toColumn}"]`)!;
        const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 99999 });
        body.dispatchEvent(over);
        // A browser fires drop only where dragover was cancelled; do the same.
        if (over.defaultPrevented) body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 99999 }));
        const refusedMark = body.closest('.column')?.classList.contains('drop-refused') ?? false;
        card.isConnected && card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return { started: !start.defaultPrevented && card.getAttribute('draggable') !== 'false', accepted: over.defaultPrevented, refusedMark };
      };
      const key = (kb: KB, cardId: string | null, k: string) => {
        const el = cardId ? sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${cardId}"]`) : null;
        el?.focus();
        (el ?? sr(kb).querySelector('.board')!).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));
      };
      {
        const { kb, moves } = await mk();
        const into = drag(kb, 'a', 'doing');
        await settle();
        check(`TASK-947: a drag into a locked column is refused (accepted ${into.accepted}, now in ${colOf(kb, 'a')}, ${moves.length} events)`,
          !into.accepted && colOf(kb, 'a') === 'todo' && moves.length === 0);
        check(`TASK-947: ...the locked column shows it refuses (${into.refusedMark}) and says why ("${live(kb)}")`, into.refusedMark && /locked/i.test(live(kb)));
        const out = drag(kb, 'c', 'done');
        await settle();
        check(`TASK-947: a card in a locked column cannot be dragged out (started ${out.started}, now in ${colOf(kb, 'c')})`, !out.started && colOf(kb, 'c') === 'doing');
        key(kb, 'c', ' ');
        await settle();
        check(`TASK-947: picking up a card in a locked column by keyboard is refused and said ("${live(kb)}")`, /locked/i.test(live(kb)) && colOf(kb, 'c') === 'doing');
        key(kb, null, 'Escape');
        key(kb, 'a', ' '); key(kb, 'a', 'ArrowRight'); key(kb, 'a', 'Enter');
        await settle();
        check(`TASK-947: by keyboard, Right skips the locked column to the next that accepts (a in ${colOf(kb, 'a')}, ${moves.length} card-move)`,
          colOf(kb, 'a') === 'done' && moves.length === 1);
        kb.moveCard('b', 'doing');
        await settle();
        check(`TASK-947: the app's own moveCard() still moves into a locked column (b in ${colOf(kb, 'b')})`, colOf(kb, 'b') === 'doing');
        kb.remove();
      }
      {
        const asked: Record<string, unknown>[] = [];
        const { kb, moves } = await mk({ canMove: (m: Record<string, unknown>) => { asked.push(m); return m.toColumn === 'done' ? 'Only an agent closes a card' : true; } });
        const r = drag(kb, 'a', 'done');
        await settle();
        const m = asked[asked.length - 1] ?? {};
        check(`TASK-947: canMove is asked with the move (${JSON.stringify({ card: (m.card as { id?: string })?.id, from: m.fromColumn, to: m.toColumn })})`,
          (m.card as { id?: string })?.id === 'a' && m.fromColumn === 'todo' && m.toColumn === 'done');
        check(`TASK-947: a reason from canMove refuses the drop and is said (accepted ${r.accepted}, a in ${colOf(kb, 'a')}, "${live(kb)}")`,
          !r.accepted && colOf(kb, 'a') === 'todo' && live(kb).includes('Only an agent closes a card') && moves.length === 0);
        kb.remove();
      }
      {
        const { kb, moves } = await mk({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }] });
        const requests: unknown[] = [];
        const veto = (e: Event) => { requests.push((e as CustomEvent).detail); e.preventDefault(); };
        kb.addEventListener('card-move-request', veto);
        drag(kb, 'a', 'done');
        await settle();
        check(`TASK-947: cancelling card-move-request keeps the card put (${requests.length} request, a in ${colOf(kb, 'a')}, ${moves.length} card-move)`,
          requests.length === 1 && colOf(kb, 'a') === 'todo' && moves.length === 0);
        kb.removeEventListener('card-move-request', veto);
        drag(kb, 'a', 'done');
        await settle();
        check(`TASK-947: an uncancelled move goes ahead and card-move fires after it, as before (a in ${colOf(kb, 'a')}, ${moves.length})`,
          colOf(kb, 'a') === 'done' && moves.length === 1);
        const undone = typeof kb.revertMove === 'function' && kb.revertMove('a');
        await settle();
        const order = kb.getCards('todo').map((c) => c.id).join('');
        check(`TASK-947: revertMove puts the card back where it came from (${undone}, todo ${order})`, undone === true && order === 'ab');
        check(`TASK-947: ...without reporting a new move (${moves.length} events)`, moves.length === 1);
        check('TASK-947: revertMove with nothing to undo answers false', typeof kb.revertMove === 'function' && kb.revertMove('a') === false);
        kb.remove();
      }

      // Birko TASK-948 (FEATURE-022 D5 sections, D13, D14): lanes inside a column.
      {
        type Card = { id: string; columnId: string; laneId?: string };
        const laneCfg = (extra: Record<string, unknown> = {}) => ({
          columns: [
            { id: 'todo', label: 'To do', defaultLane: 'normal',
              lanes: [{ id: 'critical', label: 'Critical', color: '#c43c3c' }, { id: 'high', label: 'High' }, { id: 'normal', label: 'Normal' }] },
            { id: 'doing', label: 'In progress' },
          ],
          cards: [{ id: 'a', columnId: 'todo', laneId: 'critical', title: 'A' }, { id: 'b', columnId: 'todo', laneId: 'normal', title: 'B' },
            { id: 'x', columnId: 'todo', title: 'X no lane' }, { id: 'y', columnId: 'todo', laneId: 'nope', title: 'Y unknown lane' },
            { id: 'c', columnId: 'doing', title: 'C' }],
          ...extra,
        });
        const laneOf = (kb: KB, id: string) => (kb.getCards().find((c) => c.id === id) as Card | undefined)?.laneId;
        const shownLane = (kb: KB, id: string) => sr(kb).querySelector(`.card[data-card-id="${id}"]`)?.closest('.lane')?.getAttribute('data-lane-id') ?? 'none';
        const dragTo = (kb: KB, cardId: string, selector: string) => {
          const dt = new DataTransfer();
          const card = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${cardId}"]`)!;
          card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
          const target = sr(kb).querySelector<HTMLElement>(selector);
          if (!target) return false;
          const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 99999 });
          target.dispatchEvent(over);
          if (over.defaultPrevented) target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 99999 }));
          card.isConnected && card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
          return over.defaultPrevented;
        };
        const lanesOf = (kb: KB) => [...sr(kb).querySelectorAll<HTMLElement>('.column[data-column-id="todo"] .lane')]
          .map((l) => `${l.getAttribute('data-lane-id')}:${l.querySelector('.lane-title')?.textContent?.trim()}(${l.querySelector('.lane-count')?.textContent?.trim()})`);
        {
          const { kb, moves } = await mk(laneCfg());
          check(`TASK-948: a laned column shows each lane with its label and count (${lanesOf(kb).join(' ')})`,
            lanesOf(kb).join(' ') === 'critical:Critical(1) high:High(0) normal:Normal(3)');
          const high = sr(kb).querySelector<HTMLElement>('.lane[data-lane-id="high"]');
          check(`TASK-948: an empty lane stays visible as a place to drop (${Math.round(high?.getBoundingClientRect().height ?? 0)}px, drop target ${!!high?.querySelector('.column-body')})`,
            (high?.getBoundingClientRect().height ?? 0) > 20 && !!high?.querySelector('.column-body'));
          check(`TASK-948: a card with no lane and one with an unknown lane show in the default lane (x in ${shownLane(kb, 'x')}, y in ${shownLane(kb, 'y')})`,
            shownLane(kb, 'x') === 'normal' && shownLane(kb, 'y') === 'normal');
          check(`TASK-948: a column without lanes has no lane sections (${sr(kb).querySelectorAll('.column[data-column-id="doing"] .lane').length})`,
            sr(kb).querySelectorAll('.column[data-column-id="doing"] .lane').length === 0);
          const ok = dragTo(kb, 'a', '.lane[data-lane-id="high"] .column-body');
          await settle();
          const m = moves[moves.length - 1] as Record<string, unknown> | undefined;
          check(`TASK-948: a drag to another lane moves the card there (${ok}, a in ${laneOf(kb, 'a')}, shown in ${shownLane(kb, 'a')})`,
            ok && laneOf(kb, 'a') === 'high' && shownLane(kb, 'a') === 'high');
          check(`TASK-948: ...reported as card-move with the lanes it left and entered (${JSON.stringify(m && { from: m.fromLane, to: m.toLane, col: m.toColumn })})`,
            !!m && m.fromLane === 'critical' && m.toLane === 'high' && m.toColumn === 'todo' && moves.length === 1);
          const undone = kb.revertMove!('a');
          await settle();
          check(`TASK-948: revertMove puts the card back in its lane (${undone}, a in ${laneOf(kb, 'a')})`, undone && laneOf(kb, 'a') === 'critical');
          dragTo(kb, 'c', '.lane[data-lane-id="high"] .column-body');
          await settle();
          const m2 = moves[moves.length - 1] as Record<string, unknown> | undefined;
          check(`TASK-948: a card dragged in from a column without lanes lands in the lane it was dropped on (c in ${laneOf(kb, 'c')}, toLane ${m2?.toLane})`,
            laneOf(kb, 'c') === 'high' && m2?.toLane === 'high' && m2?.fromColumn === 'doing');
          (kb.moveCard as unknown as (id: string, col: string, i?: number, p?: string, lane?: string) => void)('b', 'todo', undefined, undefined, 'critical');
          await settle();
          check(`TASK-948: moveCard takes a lane (b in ${laneOf(kb, 'b')})`, laneOf(kb, 'b') === 'critical');
          kb.remove();
        }
        {
          const asked: Record<string, unknown>[] = [];
          const { kb } = await mk(laneCfg({ canMove: (mv: Record<string, unknown>) => { asked.push(mv); return mv.toLane === 'critical' ? 'Only a lead sets Critical' : true; } }));
          const ok = dragTo(kb, 'b', '.lane[data-lane-id="critical"] .column-body');
          await settle();
          const last = asked[asked.length - 1] ?? {};
          check(`TASK-948: canMove sees the lanes and can refuse one (asked ${JSON.stringify({ from: last.fromLane, to: last.toLane })}, accepted ${ok}, b in ${laneOf(kb, 'b')}, "${live(kb)}")`,
            last.fromLane === 'normal' && last.toLane === 'critical' && !ok && laneOf(kb, 'b') === 'normal' && live(kb).includes('Only a lead sets Critical'));
          kb.remove();
        }

        // Birko TASK-949 (FEATURE-022 D7, D9): reordering off per column, and the keyboard across lanes.
        {
          type OC = { id: string; order?: number; laneId?: string; columnId: string };
          const card = (kb: KB, id: string) => kb.getCards().find((c) => c.id === id) as OC | undefined;
          const lanesBoard = (sortable: boolean, extra: Record<string, unknown> = {}) => ({
            columns: [
              { id: 'todo', label: 'To do', sortable, defaultLane: 'normal',
                lanes: [{ id: 'critical', label: 'Critical' }, { id: 'high', label: 'High' }, { id: 'normal', label: 'Normal' }] },
              { id: 'doing', label: 'In progress' },
            ],
            cards: [{ id: 'a', columnId: 'todo', laneId: 'critical', title: 'A', order: 10 }, { id: 'b', columnId: 'todo', laneId: 'critical', title: 'B', order: 20 },
              { id: 'n', columnId: 'todo', laneId: 'normal', title: 'N', order: 5 }, { id: 'c', columnId: 'doing', title: 'C', order: 15 }],
            ...extra,
          });
          const press = (kb: KB, k: string) => {
            const el = (sr(kb).activeElement as HTMLElement | null) ?? sr(kb).querySelector('.board')!;
            el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));
          };
          const pickUp = (kb: KB, id: string) => { sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${id}"]`)!.focus(); press(kb, ' '); };
          {
            const { kb, moves } = await mk(lanesBoard(false));
            // Over a column with reordering off no drop line is drawn.
            const dt = new DataTransfer();
            const bEl = sr(kb).querySelector<HTMLElement>('.card[data-card-id="b"]')!;
            bEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            const crit = sr(kb).querySelector<HTMLElement>('.lane[data-lane-id="critical"] .column-body')!;
            crit.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 0 }));
            const lines = sr(kb).querySelectorAll('.drop-before, .drop-after, .drop-inside').length;
            crit.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 0 }));
            bEl.isConnected && bEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
            await settle();
            check(`TASK-949: with reordering off no drop line is drawn (${lines})`, lines === 0);
            check(`TASK-949: ...and a drag within the same lane changes nothing (${kb.getCards('todo', 'critical').map((c) => c.id).join('')}, orders ${card(kb, 'a')?.order}/${card(kb, 'b')?.order}, ${moves.length} events)`,
              kb.getCards('todo', 'critical').map((c) => c.id).join('') === 'ab' && card(kb, 'a')?.order === 10 && card(kb, 'b')?.order === 20 && moves.length === 0);
            dragTo(kb, 'c', '.lane[data-lane-id="critical"] .column-body');
            await settle();
            check(`TASK-949: a card dropped in takes its own place by the app's order, not the drop position (critical ${kb.getCards('todo', 'critical').map((c) => c.id).join('')})`,
              kb.getCards('todo', 'critical').map((c) => c.id).join('') === 'acb');
            check(`TASK-949: ...and the board does not renumber the app's order (a ${card(kb, 'a')?.order}, b ${card(kb, 'b')?.order}, c ${card(kb, 'c')?.order})`,
              card(kb, 'a')?.order === 10 && card(kb, 'b')?.order === 20 && card(kb, 'c')?.order === 15);
            pickUp(kb, 'a'); press(kb, 'ArrowDown');
            const step1 = { lane: sr(kb).querySelector('.card[data-card-id="a"]')?.closest('.lane')?.getAttribute('data-lane-id'), live: live(kb) };
            press(kb, 'ArrowDown'); press(kb, 'Enter');
            await settle();
            check(`TASK-949: with reordering off, ↓ goes straight to the next lane, and the announcement names it (${step1.lane}, "${step1.live}")`,
              step1.lane === 'high' && /High/.test(step1.live) && /To do/.test(step1.live));
            check(`TASK-949: ...and Enter drops it in the lane reached (a in ${card(kb, 'a')?.laneId})`, card(kb, 'a')?.laneId === 'normal');
            kb.remove();
          }
          {
            const { kb } = await mk(lanesBoard(true));
            pickUp(kb, 'a'); press(kb, 'ArrowDown');
            const within = sr(kb).querySelector('.card[data-card-id="a"]')?.closest('.lane')?.getAttribute('data-lane-id');
            press(kb, 'ArrowDown');
            const crossed = { lane: sr(kb).querySelector('.card[data-card-id="a"]')?.closest('.lane')?.getAttribute('data-lane-id'), live: live(kb) };
            press(kb, 'Enter');
            await settle();
            check(`TASK-949: with reordering on, ↓ moves within the lane first (${within}), then on into the next lane at its edge (${crossed.lane}, "${crossed.live}")`,
              within === 'critical' && crossed.lane === 'high' && /High/.test(crossed.live));
            check(`TASK-949: ...and Enter drops it there (a in ${card(kb, 'a')?.laneId})`, card(kb, 'a')?.laneId === 'high');
            kb.remove();
          }
          {
            const { kb } = await mk(lanesBoard(false, { canMove: (m: Record<string, unknown>) => m.toLane === 'high' ? 'High is full' : true }));
            pickUp(kb, 'a'); press(kb, 'ArrowDown');
            const lane = sr(kb).querySelector('.card[data-card-id="a"]')?.closest('.lane')?.getAttribute('data-lane-id');
            check(`TASK-949: ↓ skips a lane the move rule refuses and says so (${lane}, "${live(kb)}")`, lane === 'normal' && /High/.test(live(kb)));
            press(kb, 'Escape');
            kb.remove();
          }
          {
            const { kb } = await mk({ columns: [{ id: 'todo', label: 'To do', sortable: false }, { id: 'done', label: 'Done' }],
              cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 1 }, { id: 'b', columnId: 'todo', title: 'B', order: 2 }] });
            pickUp(kb, 'a'); press(kb, 'ArrowDown');
            check(`TASK-949: in a column without lanes and with reordering off, ↓ says so ("${live(kb)}")`, /reorder/i.test(live(kb)));
            press(kb, 'Escape');
            kb.remove();
          }

          // Birko TASK-956 (FEATURE-022 D5 rows, D15, D16): lanes as rows across the board, from board-level lanes.
          {
            const rowsBoard = (layout: string) => ({
              laneLayout: layout,
              lanes: [{ id: 'critical', label: 'Critical', color: '#dc2626' }, { id: 'high', label: 'High' }, { id: 'normal', label: 'Normal' }],
              defaultLane: 'normal',
              columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress' }, { id: 'done', label: 'Done', locked: true, lanes: [] }],
              cards: [{ id: 'a', columnId: 'todo', laneId: 'critical', title: 'A' }, { id: 'd', columnId: 'todo', title: 'D (no lane)' },
                { id: 'b', columnId: 'doing', laneId: 'high', title: 'B' }, { id: 'c', columnId: 'done', title: 'C' }],
            });
            const cellOf = (kb: KB, id: string) => {
              const body = sr(kb).querySelector(`.card[data-card-id="${id}"]`)?.closest('.column-body') as HTMLElement | null;
              return body ? `${body.dataset.columnId}/${body.dataset.laneId ?? '-'}` : 'none';
            };
            {
              const { kb, moves } = await mk(rowsBoard('rows'));
              const rows = [...sr(kb).querySelectorAll<HTMLElement>('.row-header')].map((h) => `${h.querySelector('.lane-title')?.textContent?.trim()}(${h.querySelector('.lane-count')?.textContent?.trim()})`);
              check(`TASK-956: rows mode shows one row per board lane with its label and count across the board (${rows.join(' ')})`,
                rows.join(' ') === 'Critical(1) High(1) Normal(1)');
              const cells = [...sr(kb).querySelectorAll<HTMLElement>('.column-body')].map((b) => `${b.dataset.columnId}/${b.dataset.laneId ?? '-'}`);
              check(`TASK-956: ...a drop cell per column × row, and the opted-out column is one cell (${cells.join(' ')})`,
                cells.length === 7 && cells.includes('todo/high') && cells.includes('doing/normal') && cells.filter((c) => c.startsWith('done')).join() === 'done/-');
              const doneCell = sr(kb).querySelector<HTMLElement>('.column-body[data-column-id="done"]')?.closest<HTMLElement>('.column');
              const span = doneCell ? getComputedStyle(doneCell).gridRow : '';
              check(`TASK-956: ...which spans all the rows (grid-row ${span})`, /span 3/.test(span));
              check(`TASK-956: cards sit in their column × row cell; one with no lane in the default row (a ${cellOf(kb, 'a')}, d ${cellOf(kb, 'd')}, b ${cellOf(kb, 'b')}, c ${cellOf(kb, 'c')})`,
                cellOf(kb, 'a') === 'todo/critical' && cellOf(kb, 'd') === 'todo/normal' && cellOf(kb, 'b') === 'doing/high' && cellOf(kb, 'c') === 'done/-');
              dragTo(kb, 'a', '.column-body[data-column-id="doing"][data-lane-id="normal"]');
              await settle();
              const m = moves[moves.length - 1] as Record<string, unknown> | undefined;
              check(`TASK-956: a drag to another column's row moves the card there and reports both (${cellOf(kb, 'a')}, ${JSON.stringify(m && { col: m.toColumn, lane: m.toLane })})`,
                cellOf(kb, 'a') === 'doing/normal' && m?.toColumn === 'doing' && m?.toLane === 'normal');
              const refused = dragTo(kb, 'b', '.column-body[data-column-id="done"]');
              await settle();
              check(`TASK-956: a locked column's cell refuses a drop (accepted ${refused}, b in ${cellOf(kb, 'b')})`, !refused && cellOf(kb, 'b') === 'doing/high');
              // Keyboard: → keeps the row.
              pickUp(kb, 'b'); press(kb, 'ArrowLeft');
              const moving = sr(kb).querySelector('.card[data-card-id="b"]')?.closest('.column-body') as HTMLElement | null;
              press(kb, 'Enter');
              await settle();
              check(`TASK-956: by keyboard, ← keeps the card's row (shown in ${moving?.dataset.columnId}/${moving?.dataset.laneId}, now ${cellOf(kb, 'b')})`,
                moving?.dataset.columnId === 'todo' && moving?.dataset.laneId === 'high' && cellOf(kb, 'b') === 'todo/high');
              kb.remove();
            }
            {
              const { kb } = await mk(rowsBoard('sections'));
              const laned = [...sr(kb).querySelectorAll<HTMLElement>('.column')].map((c) => `${c.dataset.columnId}:${c.querySelectorAll('.lane').length}`);
              check(`TASK-956: in sections mode the board-level lanes become each column's sections, and lanes: [] opts out (${laned.join(' ')})`,
                laned.join(' ') === 'todo:3 doing:3 done:0' && sr(kb).querySelectorAll('.row-header').length === 0);
              kb.remove();
            }

            // Birko TASK-957 (FEATURE-022 D5 tags, D17, D18): lanes as a tag on each card, changed from the tag's menu.
            {
              const tagsBoard = (extra: Record<string, unknown> = {}) => ({
                laneLayout: 'tags',
                lanes: [{ id: 'critical', label: 'Critical', color: '#dc2626' }, { id: 'high', label: 'High' }, { id: 'normal', label: 'Normal' }],
                defaultLane: 'normal',
                columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done', lanes: [] }],
                cards: [{ id: 'n', columnId: 'todo', laneId: 'normal', title: 'N', order: 0 }, { id: 'a', columnId: 'todo', laneId: 'critical', title: 'A', order: 1 },
                  { id: 'h', columnId: 'todo', laneId: 'high', title: 'H', order: 2 }, { id: 'x', columnId: 'todo', title: 'X no lane', order: 3 },
                  { id: 'c', columnId: 'done', title: 'C' }],
                ...extra,
              });
              const tagOf = (kb: KB, id: string) => sr(kb).querySelector(`.card[data-card-id="${id}"] .lane-tag`)?.textContent?.replace(/[▾\s]+$/u, '').trim() ?? 'none';
              const listed = (kb: KB) => [...sr(kb).querySelectorAll<HTMLElement>('.column-body[data-column-id="todo"] > .card')].map((c) => c.dataset.cardId).join('');
              {
                const { kb, moves } = await mk(tagsBoard());
                check(`TASK-957: tags mode has no lane sections and one body per column (${sr(kb).querySelectorAll('.lane').length} sections, ${sr(kb).querySelectorAll('.column-body').length} bodies)`,
                  sr(kb).querySelectorAll('.lane, .row-header').length === 0 && sr(kb).querySelectorAll('.column-body').length === 2);
                check(`TASK-957: each laned card carries its lane as a tag; one with no lane the default (${['a', 'h', 'n', 'x'].map((id) => `${id}:${tagOf(kb, id)}`).join(' ')}; c ${tagOf(kb, 'c')})`,
                  tagOf(kb, 'a') === 'Critical' && tagOf(kb, 'h') === 'High' && tagOf(kb, 'n') === 'Normal' && tagOf(kb, 'x') === 'Normal' && tagOf(kb, 'c') === 'none');
                check(`TASK-957: cards are grouped by lane, in lane order (${listed(kb)})`, listed(kb) === 'ahnx');
                const clicks: unknown[] = [];
                kb.addEventListener('card-click', (e) => clicks.push(e));
                const tag = sr(kb).querySelector<HTMLElement>('.card[data-card-id="n"] .lane-tag')!;
                tag.click();
                await settle();
                const items = [...sr(kb).querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')].map((i) => `${i.textContent?.trim()}${i.getAttribute('aria-checked') === 'true' ? '*' : ''}`);
                check(`TASK-957: clicking the tag opens a menu of the lanes with the current one checked (${items.join(' | ')})`, items.join('|') === 'Critical|High|Normal*');
                check(`TASK-957: ...and is not a card click (${clicks.length})`, clicks.length === 0);
                sr(kb).querySelector<HTMLElement>('[role="menu"] [role="menuitemradio"][data-lane-id="high"]')!.click();
                await settle();
                const m = moves[moves.length - 1] as Record<string, unknown> | undefined;
                check(`TASK-957: picking a lane moves the card there and reports it (n ${tagOf(kb, 'n')}, ${JSON.stringify(m && { from: m.fromLane, to: m.toLane })}, menu ${sr(kb).querySelectorAll('[role="menu"]').length})`,
                  tagOf(kb, 'n') === 'High' && m?.fromLane === 'normal' && m?.toLane === 'high' && sr(kb).querySelectorAll('[role="menu"]').length === 0);
                check(`TASK-957: ...and the list regroups, the card at the end of its new lane (${listed(kb)})`, listed(kb) === 'ahnx');
                const t2 = sr(kb).querySelector<HTMLElement>('.card[data-card-id="a"] .lane-tag')!;
                t2.click(); await settle();
                sr(kb).querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
                await settle();
                check(`TASK-957: Escape closes the menu with no change (menu ${sr(kb).querySelectorAll('[role="menu"]').length}, a ${tagOf(kb, 'a')}, ${moves.length} events)`,
                  sr(kb).querySelectorAll('[role="menu"]').length === 0 && tagOf(kb, 'a') === 'Critical' && moves.length === 1);
                // The tag does not start a drag.
                const t3 = sr(kb).querySelector<HTMLElement>('.card[data-card-id="h"] .lane-tag')!;
                t3.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
                const ds = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
                sr(kb).querySelector<HTMLElement>('.card[data-card-id="h"]')!.dispatchEvent(ds);
                check(`TASK-957: a drag begun on the tag does not start (${ds.defaultPrevented ? 'prevented' : 'started'})`, ds.defaultPrevented);
                sr(kb).querySelector<HTMLElement>('.card[data-card-id="h"]')!.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
                // Keyboard: ↓ past the end of a lane changes the lane.
                // High now holds h then n (n moved to its end above), so the first ↓ passes n within the lane (D9), the second crosses.
                pickUp(kb, 'h'); press(kb, 'ArrowDown');
                const within = { list: listed(kb), live: live(kb) };
                press(kb, 'ArrowDown');
                const shownAfter = listed(kb);
                press(kb, 'Enter');
                await settle();
                check(`TASK-957: by keyboard, ↓ moves within the lane first (shown ${within.list}, "${within.live}"), then past its end into the next lane (shown ${shownAfter}, h ${tagOf(kb, 'h')})`,
                  within.list === 'anhx' && /High/.test(within.live) && shownAfter === 'anhx' && tagOf(kb, 'h') === 'Normal');
                kb.remove();
              }
              {
                const { kb } = await mk(tagsBoard({ canMove: (mv: Record<string, unknown>) => mv.toLane === 'critical' ? 'Only a lead sets Critical' : true }));
                sr(kb).querySelector<HTMLElement>('.card[data-card-id="n"] .lane-tag')!.click();
                await settle();
                sr(kb).querySelector<HTMLElement>('[role="menu"] [role="menuitemradio"][data-lane-id="critical"]')!.click();
                await settle();
                check(`TASK-957: a lane the move rule refuses is said and the card stays (n ${tagOf(kb, 'n')}, "${live(kb)}")`,
                  tagOf(kb, 'n') === 'Normal' && live(kb).includes('Only a lead sets Critical'));
                kb.remove();
              }
            }

            // Birko TASK-950 (FEATURE-022 D6, D19, D20): an opt-in stacked layout, measured on the board's own width.
            {
              const frames = (n = 3) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
              const mkSized = async (width: string, cfg: Record<string, unknown>) => {
                const wrap = document.createElement('div');
                wrap.style.cssText = `width:${width};position:absolute;left:0;top:0`;
                document.body.appendChild(wrap);
                const kb = document.createElement('b-kanban') as KB;
                wrap.appendChild(kb);
                kb.setConfig(cfg as never);
                await frames(4); await settle();
                return { kb, wrap };
              };
              const base = (extra: Record<string, unknown> = {}) => ({
                columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'In progress' }, { id: 'done', label: 'Done' }],
                cards: [{ id: 'a', columnId: 'todo', laneId: 'critical', title: 'A' }, { id: 'b', columnId: 'doing', title: 'B' }],
                ...extra,
              });
              const shape = (kb: KB) => {
                const board = sr(kb).querySelector<HTMLElement>('.board')!;
                const cols = [...sr(kb).querySelectorAll<HTMLElement>('.board > .column')];
                const bw = board.getBoundingClientRect().width;
                return { stacked: kb.hasAttribute('stacked'), dir: getComputedStyle(board).flexDirection, overflow: board.scrollWidth - board.clientWidth,
                  fullWidth: cols.length > 0 && cols.every((c) => Math.abs(c.getBoundingClientRect().width - bw) < 2),
                  oneTop: new Set(cols.map((c) => Math.round(c.getBoundingClientRect().top))).size === cols.length };
              };
              {
                const { kb, wrap } = await mkSized('360px', base({ stackBelow: '44rem' }));
                const s1 = shape(kb);
                check(`TASK-950: a board narrower than stackBelow stacks its columns one per row, full width, with no sideways scroll (${JSON.stringify(s1)})`,
                  s1.stacked && s1.dir === 'column' && s1.overflow <= 0 && s1.fullWidth && s1.oneTop);
                const ok = dragTo(kb, 'a', '.column-body[data-column-id="done"]');
                await settle();
                check(`TASK-950: ...and a drag still works stacked (${ok}, a in ${colOf(kb, 'a')})`, ok && colOf(kb, 'a') === 'done');
                wrap.style.width = '1200px';
                await frames(4); await settle();
                const s2 = shape(kb);
                check(`TASK-950: widened past it, the board un-stacks (${JSON.stringify({ stacked: s2.stacked, dir: s2.dir })})`, !s2.stacked && s2.dir === 'row');
                wrap.remove();
              }
              {
                const { kb, wrap } = await mkSized('360px', base());
                const s = shape(kb);
                check(`TASK-950: without stackBelow a narrow board does not stack and scrolls sideways as before (${JSON.stringify({ stacked: s.stacked, dir: s.dir, overflow: s.overflow })})`,
                  !s.stacked && s.dir === 'row' && s.overflow > 0);
                wrap.remove();
              }
              {
                const lanes = [{ id: 'critical', label: 'Critical' }, { id: 'normal', label: 'Normal' }];
                const { kb, wrap } = await mkSized('360px', base({ stackBelow: '44rem', laneLayout: 'rows', lanes, defaultLane: 'normal' }));
                const narrow = { rowsGrid: !!sr(kb).querySelector('.rows-board'), sections: sr(kb).querySelectorAll('.lane').length, overflow: shape(kb).overflow };
                check(`TASK-950: a rows board falls back to sections when stacked (${JSON.stringify(narrow)})`,
                  !narrow.rowsGrid && narrow.sections === 6 && narrow.overflow <= 0);
                wrap.style.width = '1200px';
                await frames(4); await settle();
                check(`TASK-950: ...and returns to rows when wide again (${!!sr(kb).querySelector('.rows-board')})`, !!sr(kb).querySelector('.rows-board'));
                wrap.remove();
              }
              {
                const lanes = [{ id: 'critical', label: 'Critical' }, { id: 'normal', label: 'Normal' }];
                const { kb, wrap } = await mkSized('360px', base({ stackBelow: '44rem', laneLayout: 'tags', lanes, defaultLane: 'normal' }));
                const s = shape(kb);
                check(`TASK-950: a tags board stacks as plain lists, tags kept (${JSON.stringify({ stacked: s.stacked, dir: s.dir, tags: sr(kb).querySelectorAll('.lane-tag').length, sections: sr(kb).querySelectorAll('.lane').length })})`,
                  s.stacked && s.dir === 'column' && sr(kb).querySelectorAll('.lane-tag').length === 2 && sr(kb).querySelectorAll('.lane').length === 0);
                wrap.remove();
              }
            }

            // Birko TASK-963 (found at FEATURE-023): the column footer was hard-coded English ("3 cards").
            {
              const i18n = getI18n();
              i18n.addMessages('en', { bwc: { kanban: { cardCount: { one: '{count} karta', other: '{count} kariet' } } } });
              const { kb } = await mk({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                cards: [{ id: 'a', columnId: 'todo', title: 'A' }, { id: 'b', columnId: 'todo', title: 'B' }, { id: 'c', columnId: 'done', title: 'C' }] });
              const footers = [...sr(kb).querySelectorAll('.column-footer')].map((f) => f.textContent?.trim()).join(' | ');
              i18n.addMessages('en', { bwc: { kanban: { cardCount: { one: '{count} card', other: '{count} cards' } } } });
              check(`TASK-963: the column footer comes from bwc.kanban.cardCount, singular and plural (${footers})`, footers === '2 kariet | 1 karta');
              kb.remove();
            }

            // Birko TASK-964 (found at TASK-961): the drop position was worked out against the column's first card only (any
            // card above the pointer counted as "drop after it"), so a drop below the first card landed second.
            {
              const { kb } = await mk({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0 }, { id: 'b', columnId: 'todo', title: 'B', order: 1 }, { id: 'c', columnId: 'todo', title: 'C', order: 2 },
                  { id: 'x', columnId: 'done', title: 'X', order: 0 }, { id: 'y', columnId: 'done', title: 'Y', order: 1 }] });
              const dropY = async (id: string, y: (r: DOMRect) => number, onto: string) => {
                const card = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${id}"]`)!;
                const dt = new DataTransfer();
                card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
                const r = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${onto}"]`)!.getBoundingClientRect();
                const at = { clientX: r.left + 10, clientY: y(r) };
                const body = sr(kb).querySelector<HTMLElement>('.column-body[data-column-id="todo"]')!;
                const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
                body.dispatchEvent(over);
                const line = [...sr(kb).querySelectorAll<HTMLElement>('.card.drop-before, .card.drop-after')].map((c) => `${c.classList.contains('drop-before') ? 'before' : 'after'} ${c.dataset.cardId}`).join();
                if (over.defaultPrevented) body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
                card.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true }));
                await settle();
                return line;
              };
              const order = () => kb.getCards('todo').filter((c) => !c.parentId).sort((p, q) => (p.order ?? 0) - (q.order ?? 0)).map((c) => c.id).join('');
              const l1 = await dropY('x', (r) => r.top + r.height * 0.1, 'c');
              const o1 = order();
              const l2 = await dropY('y', (r) => r.bottom + 40, 'c');
              check(`TASK-964: a drop on the third card's top edge lands before it, and one below the last card lands at the end (shown "${l1}", ${o1}; then shown "${l2}", ${order()})`,
                o1 === 'abxc' && l1 === 'before c' && order() === 'abxcy');
              kb.remove();
            }
            {
              // Sub-cards shown above count in the column's card list but are not the dropped card's siblings.
              const { kb } = await mk({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0, children: [{ id: 'a1', columnId: 'todo', title: 'A1', parentId: 'a', order: 0 }, { id: 'a2', columnId: 'todo', title: 'A2', parentId: 'a', order: 1 }] },
                  { id: 'b', columnId: 'todo', title: 'B', order: 1 }, { id: 'c', columnId: 'todo', title: 'C', order: 2 }, { id: 'x', columnId: 'done', title: 'X', order: 0 }] });
              kb.expandCard('a'); await settle();
              const card = sr(kb).querySelector<HTMLElement>('.card[data-card-id="x"]')!;
              const dt = new DataTransfer();
              card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
              const r = sr(kb).querySelector<HTMLElement>('.card[data-card-id="c"]')!.getBoundingClientRect();
              const at = { clientX: r.left + 10, clientY: r.top + r.height * 0.1 };
              const body = sr(kb).querySelector<HTMLElement>('.column-body[data-column-id="todo"]')!;
              const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
              body.dispatchEvent(over);
              if (over.defaultPrevented) body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
              card.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true }));
              await settle();
              const top = kb.getCards('todo').filter((c) => !c.parentId).sort((p, q) => (p.order ?? 0) - (q.order ?? 0)).map((c) => c.id).join('');
              check(`TASK-964: with sub-cards shown above, a drop on a card's top edge still lands before that card (${top})`, top === 'abxc');
              kb.remove();
            }

            // Birko TASK-961 (reported by DraCode): maxNestingDepth 0 counted as unlimited (an empty sub-card spacer on every
            // card), and a drop on a card's middle nested the card whatever maxNestingDepth said.
            {
              const dropAt = async (kb: KB, id: string, targetId: string, rel: number) => {
                const card = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${id}"]`)!;
                const dt = new DataTransfer();
                card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
                const t = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${targetId}"]`)!;
                const r = t.getBoundingClientRect();
                const at = { clientX: r.left + 10, clientY: r.top + r.height * rel };
                const body = t.closest<HTMLElement>('.column-body')!;
                const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
                body.dispatchEvent(over);
                const inside = !!sr(kb).querySelector('.card.drop-inside');
                if (over.defaultPrevented) body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
                card.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true }));
                await settle();
                return inside;
              };
              const parentOf = (kb: KB, id: string) => kb.getCards().find((c) => c.id === id)?.parentId ?? '';
              const flat = (extra: Record<string, unknown>) => ({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0 }, { id: 'b', columnId: 'todo', title: 'B', order: 1 }, { id: 'c', columnId: 'todo', title: 'C', order: 2 }], ...extra });
              {
                const { kb } = await mk(flat({ maxNestingDepth: 0 }));
                const strips = sr(kb).querySelectorAll('.card-toggle-spacer, .card-toggle').length;
                const shown = await dropAt(kb, 'c', 'a', 0.6);
                const order = kb.getCards('todo').filter((c) => !c.parentId).sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((c) => c.id).join('');
                check(`TASK-961: maxNestingDepth 0 shows no sub-card strip and a drop on a card's middle does not nest (${strips} strips, c inside "${parentOf(kb, 'c')}", nest shown ${shown}, order ${order})`,
                  strips === 0 && parentOf(kb, 'c') === '' && !shown && order === 'acb');
                kb.remove();
              }
              {
                const { kb } = await mk({ maxNestingDepth: 1, columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                  cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0, children: [{ id: 'a1', columnId: 'todo', title: 'A1', parentId: 'a', order: 0 }] },
                    { id: 'b', columnId: 'todo', title: 'B', order: 1 }, { id: 'c', columnId: 'todo', title: 'C', order: 2 }] });
                kb.expandCard('a'); await settle();
                await dropAt(kb, 'b', 'a1', 0.5);
                const bParent = parentOf(kb, 'b');
                await dropAt(kb, 'a', 'c', 0.5);
                check(`TASK-961: maxNestingDepth 1 refuses a nest that would go deeper: onto a sub-card (b under "${bParent}"), or a card with sub-cards into another (a under "${parentOf(kb, 'a')}")`,
                  bParent === 'a' && parentOf(kb, 'a') === '');
                kb.remove();
              }
              {
                const { kb } = await mk(flat({}));
                await dropAt(kb, 'c', 'a', 0.5);
                check(`TASK-961: with no maxNestingDepth a drop on a card's middle still nests (c under "${parentOf(kb, 'c')}")`, parentOf(kb, 'c') === 'a');
                kb.remove();
              }
            }

            // Birko TASK-960 (found testing the gallery's reordering switch): a card dropped at a position among cards that
            // carry their own `order` lands there. The drop put it at the position in the list, then sorted the group by
            // the cards' old `order`, so it went back where it was. Drops on the top quarter of a card (before it).
            {
              const dropBefore = async (kb: KB, id: string, beforeId: string, body: string) => {
                const card = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${id}"]`)!;
                const dt = new DataTransfer();
                card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
                const r = sr(kb).querySelector<HTMLElement>(`.card[data-card-id="${beforeId}"]`)!.getBoundingClientRect();
                const at = { clientX: r.left + 10, clientY: r.top + r.height * 0.1 };
                const target = sr(kb).querySelector<HTMLElement>(body)!;
                const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at });
                target.dispatchEvent(over);
                if (over.defaultPrevented) target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
                card.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true }));
                await settle();
              };
              const orderIn = (kb: KB, col: string, lane?: string) => kb.getCards(col, lane).filter((c) => !c.parentId)
                .sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((c) => c.id).join('');
              {
                const { kb, moves } = await mk({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                  cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0 }, { id: 'b', columnId: 'todo', title: 'B', order: 1 }, { id: 'c', columnId: 'todo', title: 'C', order: 2 }] });
                await dropBefore(kb, 'c', 'a', '.column-body[data-column-id="todo"]');
                const shown = [...sr(kb).querySelectorAll<HTMLElement>('.column-body[data-column-id="todo"] > .card')].map((c) => c.dataset.cardId).join('');
                const m = moves[moves.length - 1] as Record<string, unknown> | undefined;
                check(`TASK-960: a card dropped before the first one in its column goes first (order ${orderIn(kb, 'todo')}, shown ${shown}, reported toIndex ${m?.toIndex})`,
                  orderIn(kb, 'todo') === 'cab' && shown === 'cab' && m?.toIndex === 0);
                kb.remove();
              }
              {
                const { kb } = await mk({ columns: [{ id: 'todo', label: 'To do', lanes: [{ id: 'hi', label: 'High' }, { id: 'lo', label: 'Low' }] }, { id: 'done', label: 'Done' }],
                  cards: [{ id: 'a', columnId: 'todo', laneId: 'hi', title: 'A', order: 1 }, { id: 'e', columnId: 'todo', laneId: 'hi', title: 'E', order: 2 },
                    { id: 'x', columnId: 'done', title: 'X', order: 0 }] });
                await dropBefore(kb, 'e', 'a', '.column-body[data-column-id="todo"][data-lane-id="hi"]');
                await dropBefore(kb, 'x', 'e', '.column-body[data-column-id="todo"][data-lane-id="hi"]');
                check(`TASK-960: ...within a lane, and from another column into a lane at a position (High ${orderIn(kb, 'todo', 'hi')})`, orderIn(kb, 'todo', 'hi') === 'xea');
                kb.remove();
              }
            }

            // Birko TASK-959 (found by the user testing FEATURE-022): after a drag ends, however it ends, no card stays gray
            // and the board takes clicks and drags again. The browser fires dragend at the card the drag began on, even
            // when a drop has re-rendered the board, so it is dispatched on that original element here.
            {
              const cases: Array<[string, Record<string, unknown>, string | null]> = [
                ['moved to another column', {}, '.column-body[data-column-id="done"]'],
                ['dropped in place where reordering is off', { columns: [{ id: 'todo', label: 'To do', sortable: false }, { id: 'done', label: 'Done' }] }, '.column-body[data-column-id="todo"]'],
                ['refused by a locked column', { columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done', locked: true }] }, '.column-body[data-column-id="done"]'],
                ['released outside the board', {}, null],
                // The user's case in the gallery: a card from In progress dropped into a To do lane with reordering off.
                ['moved into a lane where reordering is off', { columns: [{ id: 'todo', label: 'To do', sortable: false, defaultLane: 'normal',
                  lanes: [{ id: 'critical', label: 'Critical' }, { id: 'normal', label: 'Normal' }] }, { id: 'done', label: 'Done' }],
                  cards: [{ id: 'a', columnId: 'done', title: 'A', order: 0 }, { id: 'b', columnId: 'todo', laneId: 'normal', title: 'B', order: 1 }] },
                  '.column-body[data-column-id="todo"][data-lane-id="critical"]'],
              ];
              for (const [what, extra, target] of cases) {
                const { kb } = await mk({ columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
                  cards: [{ id: 'a', columnId: 'todo', title: 'A', order: 0 }, { id: 'b', columnId: 'todo', title: 'B', order: 1 }], ...extra });
                const src = sr(kb).querySelector<HTMLElement>('.card[data-card-id="a"]')!;
                const dt = new DataTransfer();
                src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt }));
                if (target) {
                  const body = sr(kb).querySelector<HTMLElement>(target)!;
                  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 99999 });
                  body.dispatchEvent(over);
                  if (over.defaultPrevented) body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: 99999 }));
                }
                await settle();
                src.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true, dataTransfer: dt }));
                await settle();
                const gray = sr(kb).querySelectorAll('.card.dragging').length;
                const clicks: string[] = [];
                kb.addEventListener('card-click', (e) => clicks.push((e as CustomEvent).detail.cardId));
                sr(kb).querySelector<HTMLElement>('.card[data-card-id="a"]')!.click();
                sr(kb).querySelector<HTMLElement>('.card[data-card-id="b"]')!.click();
                const again = dragTo(kb, 'a', '.column-body[data-column-id="todo"]');
                await settle();
                check(`TASK-959: a drag ${what}: no card stays gray and the board works again (${gray} gray, card clicks ${clicks.join(',') || 'none'}, the same card dragged again ${again}, ${sr(kb).querySelectorAll('.card.dragging').length} gray after)`,
                  gray === 0 && clicks.join(',') === 'a,b' && again && sr(kb).querySelectorAll('.card.dragging').length === 0);
                kb.remove();
              }
            }

            // Birko TASK-946 (FEATURE-022 D8): buttons, links and fields on a card, and anything inside [data-no-drag], are
            // the card's controls: a click on one is not a card click and a drag begun on one does not start.
            {
              const controls = ['button.retry', 'a.lnk', 'input.f', 'select.s', 'textarea.ta', 'label.lb', '[data-no-drag] b.inner', 'x-shadow-btn'];
              // Like b-button: the real <button> is inside the element's own shadow root, so closest('button') cannot see it.
              if (!customElements.get('x-shadow-btn')) {
                customElements.define('x-shadow-btn', class extends HTMLElement {
                  constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<button type="button">Go</button>'; }
                });
              }
              const { kb, moves } = await mk({
                renderCard: (card: { id: string; title: string }) => `<span class="t">${card.title}</span> <button type="button" class="retry">Retry</button>`
                  + ` <a class="lnk" href="#nowhere">Log</a> <input class="f"> <select class="s"><option>1</option></select> <textarea class="ta"></textarea>`
                  + ` <label class="lb">Note</label> <span data-no-drag><b class="inner">menu</b></span> <x-shadow-btn></x-shadow-btn>`,
              });
              const clicks: string[] = [];
              kb.addEventListener('card-click', (e) => clicks.push((e as CustomEvent).detail.cardId));
              const cardA = () => sr(kb).querySelector<HTMLElement>('.card[data-card-id="a"]')!;
              // For the shadow button, act on the real <button> inside it, as a real click does.
              const inA = (sel: string) => { const el = cardA().querySelector<HTMLElement>(sel)!; return el.shadowRoot?.querySelector<HTMLElement>('button') ?? el; };
              sr(kb).addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); });
              const clicked = controls.filter((sel) => { const before = clicks.length; inA(sel).click(); return clicks.length > before; });
              check(`TASK-946: a click on a button, link, field, label or [data-no-drag] in a card is not a card click (card clicks from: ${clicked.join(', ') || 'none'})`,
                clicked.length === 0);
              inA('.t').click();
              check(`TASK-946: ...a click elsewhere on the card still is (${clicks.join(',')})`, clicks.join(',') === 'a');
              const started = controls.filter((sel) => {
                inA(sel).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
                // composed, as a browser's own drag events are, so it leaves a shadow root as a real one does
                const ds = new DragEvent('dragstart', { bubbles: true, composed: true, cancelable: true, dataTransfer: new DataTransfer() });
                inA(sel).dispatchEvent(ds);
                cardA().dispatchEvent(new DragEvent('dragend', { bubbles: true }));
                return !ds.defaultPrevented;
              });
              check(`TASK-946: a drag begun on any of them does not start (started from: ${started.join(', ') || 'none'})`, started.length === 0);
              // A pointer that went down on a control and came up without a drag must not block the next drag from the title.
              inA('button.retry').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
              inA('.t').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
              const ok = dragTo(kb, 'a', '.column-body[data-column-id="done"]');
              await settle();
              check(`TASK-946: ...and after a press on a control, a drag from the title still moves the card (${ok}, a in ${colOf(kb, 'a')}, ${moves.length} events)`,
                ok && colOf(kb, 'a') === 'done' && moves.length === 1);
              // Space on a focused control is the control's, not a pick-up.
              const btn = sr(kb).querySelector<HTMLElement>('.card[data-card-id="b"] button.retry')!;
              btn.focus();
              const sp = new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true });
              btn.dispatchEvent(sp);
              check(`TASK-946: Space on a focused control is left to it, no card is picked up (${sp.defaultPrevented ? 'prevented' : 'not prevented'}, "${live(kb)}", ${sr(kb).querySelectorAll('.card.keyboard-dragging').length} lifted)`,
                !sp.defaultPrevented && sr(kb).querySelectorAll('.card.keyboard-dragging').length === 0);
              kb.remove();
            }
          }
        }
      }
    }

    // Birko TASK-965 (reported by DraCode): the shell's user menu put getUserName() and getUserInitials() into its HTML
    // unescaped, and the name is often a federated profile field anyone can set, so a name holding markup ran script.
    {
      const hostile = '<img src=x onerror="window.__task965=1">"Eve" & co';
      (window as unknown as { __task965?: number }).__task965 = 0;
      class SmokeNameShell extends BAppShell {
        name = hostile;
        protected get brandName() { return 'Smoke'; }
        protected get storagePrefix() { return 'smoke-965'; }
        protected getUserName() { return this.name; }
        protected t(key: string) { return key; }
        protected onSignOut() {}
        protected getRibbonTabs() { return []; }
        protected getActiveTabId() { return ''; }
        protected onTabChange() {}
        protected get showStatusBar() { return false; }
        protected get showCommandPalette() { return false; }
        redraw() { this.update(); }
      }
      if (!customElements.get('smoke-name-shell')) define('smoke-name-shell', SmokeNameShell);
      const shell = document.createElement('smoke-name-shell') as SmokeNameShell;
      document.body.appendChild(shell);
      await new Promise((r) => setTimeout(r, 50));
      const root = shell.shadowRoot!;
      const name = root.querySelector('.user-name');
      const avatar = root.querySelector('.user-avatar');
      const injected = root.querySelectorAll('.user-trigger img, .user-trigger [onerror]').length;
      check(`TASK-965: a user name holding markup renders as text (name ${JSON.stringify(name?.textContent)}, avatar ${JSON.stringify(avatar?.textContent)}, injected elements ${injected}, handler ran ${(window as unknown as { __task965?: number }).__task965})`,
        name?.textContent === hostile && avatar?.textContent === '<I' && injected === 0
        && (window as unknown as { __task965?: number }).__task965 === 0);
      shell.name = 'Ann Lee';
      shell.redraw();
      await new Promise((r) => setTimeout(r, 20));
      check(`TASK-965: an ordinary name renders as before (${JSON.stringify(root.querySelector('.user-name')?.textContent)}, ${JSON.stringify(root.querySelector('.user-avatar')?.textContent)})`,
        root.querySelector('.user-name')?.textContent === 'Ann Lee' && root.querySelector('.user-avatar')?.textContent === 'AN');
      shell.remove();
    }

    // Birko TASK-967 (reported by Symbio, a TASK-962 regression): a page renders an empty <b-form> in a <b-modal>, its
    // own update() redraws it once, and only then the form gets its schema; validate() then reported invalid and no
    // field showed its error (Symbio's rooms page, create room).
    {
      const frames967 = (n = 3) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      class RoomsHost extends BaseComponent {
        selected = false;
        render() {
          // As Symbio's rooms page: one element before the modals becomes two, so the positional morph turns the
          // second modal (and its form) into the first.
          return (this.selected ? '<div class="filters">f</div><div class="panel">p</div>' : '<b-card>empty</b-card>')
            + '<b-modal id="add-modal" title="Add"><b-form id="room-form"></b-form>'
            + '<div slot="footer"><b-button id="add-save-btn">Save</b-button></div></b-modal>'
            + '<b-modal id="batch-modal" title="Batch" size="lg"><b-form id="batch-form"></b-form>'
            + '<div slot="footer"><b-button id="batch-save-btn">Save</b-button></div></b-modal>';
        }
        clicks: string[] = [];
        redraw() { this.update(); }
        // As Symbio wires its buttons (its TASK-099): once per node, marked with data-wired.
        protected onUpdated() {
          for (const [id, name] of [['add-save-btn', 'add'], ['batch-save-btn', 'batch']]) {
            const el = this.shadowRoot!.querySelector<HTMLElement>(`#${id}`);
            if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('click', () => this.clicks.push(name)); }
          }
        }
      }
      if (!customElements.get('smoke-rooms-host')) define('smoke-rooms-host', RoomsHost);
      const host = document.createElement('smoke-rooms-host') as RoomsHost;
      document.body.appendChild(host);
      await frames967(2);
      host.selected = true;
      host.redraw();
      await frames967(2);
      const form = host.shadowRoot!.querySelector('#room-form') as unknown as {
        setSchema(s: unknown): void; reset(): void; setFieldOptions(p: string, o: unknown[]): void; setFieldHint(p: string, h: string): void;
        validate(): { valid: boolean; errors: Record<string, string> }; shadowRoot: ShadowRoot };
      form.setSchema({ name: 'root', children: [
        { name: 'general', label: 'General', layout: 'grid', children: [
          { name: 'roomNumber', type: 'text', label: 'Room', rules: [{ type: 'required' }] },
          { name: 'type', type: 'select', label: 'Type', placeholder: 'Pick', options: [], rules: [{ type: 'required' }] },
        ] },
      ] });
      form.reset();
      form.setFieldOptions('general.type', [{ value: 'a', label: 'A' }]);
      form.setFieldHint('general.type', 'hint');
      (host.shadowRoot!.querySelector('#add-modal') as unknown as { open(): void }).open();
      await frames967(2);
      const res = form.validate();
      await frames967(2);
      const marked = [...form.shadowRoot.querySelectorAll('[error]')].map((e) => e.getAttribute('data-path'));
      check(`TASK-967: a form the page redrew while empty marks its invalid fields (valid ${res.valid}, errors ${Object.keys(res.errors).join(', ')}, marked ${marked.join(', ') || 'none'})`,
        !res.valid && marked.length === 2);
      host.clicks = [];
      host.shadowRoot!.querySelector<HTMLElement>('#add-save-btn')!.click();
      host.shadowRoot!.querySelector<HTMLElement>('#batch-save-btn')!.click();
      check(`TASK-967: after the page redraw each Save button runs its own handler, once (add-save-btn then batch-save-btn ran: ${host.clicks.join(', ') || 'nothing'})`,
        host.clicks.join() === 'add,batch');
      (host.shadowRoot!.querySelector('#add-modal') as unknown as { close(): void }).close();
      host.remove();
    }

    // Birko FEATURE-023 (DraCode): quieter kanban headers. TASK-968 a board can hide the column footer; TASK-969 a
    // locked column shows only the lock icon, named "Locked"; TASK-970 a whole board can be locked, shown once.
    {
      const fr = (n = 2) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const wrap = document.createElement('div'); wrap.style.width = '900px'; document.body.appendChild(wrap);
      const kb = document.createElement('b-kanban') as BKanban; wrap.appendChild(kb); await fr();
      const base = () => ({ columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', locked: true }],
        cards: [{ id: '1', columnId: 'a', title: 'One' }, { id: '2', columnId: 'b', title: 'Two' }] });
      const r = kb.shadowRoot!;
      kb.setConfig(base() as never); await fr();
      const footers = r.querySelectorAll('.column-footer').length;
      const lock = r.querySelector<HTMLElement>('.column[data-column-id="b"] .column-lock');
      kb.setConfig({ ...base(), showColumnFooter: false } as never); await fr();
      check(`TASK-968: the column footer shows by default (${footers}) and showColumnFooter: false hides it (${r.querySelectorAll('.column-footer').length})`,
        footers === 2 && r.querySelectorAll('.column-footer').length === 0);
      check(`TASK-969: a locked column shows the lock icon only, named Locked (role ${lock?.getAttribute('role')}, name ${lock?.getAttribute('aria-label')}, tooltip ${lock?.getAttribute('title')}, text ${JSON.stringify(lock?.textContent)})`,
        lock?.getAttribute('role') === 'img' && lock.getAttribute('aria-label') === 'Locked' && lock.getAttribute('title') === 'Locked'
        && !lock.textContent!.includes('Locked'));
      kb.setConfig({ ...base(), locked: true } as never); await fr();
      const notices = r.querySelectorAll('.board-lock').length;
      const colLocks = r.querySelectorAll('.column-lock').length;
      const card1 = r.querySelector<HTMLElement>('.card[data-card-id="1"]')!;
      card1.focus();
      card1.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true }));
      const said = r.querySelector('[aria-live]')?.textContent ?? '';
      check(`TASK-970: a locked board shows its lock once (${notices}) and no column lock (${colLocks}); its cards cannot be dragged (${card1.getAttribute('draggable')}) or picked up by keyboard (${JSON.stringify(said)})`,
        notices === 1 && colLocks === 0 && card1.getAttribute('draggable') === 'false' && said === 'The board is locked: its cards cannot be moved.');
      kb.moveCard('1', 'b'); await fr();
      check(`TASK-970: the app's own moveCard() still moves a card on a locked board (card 1 in ${r.querySelector<HTMLElement>('.card[data-card-id="1"]')?.dataset.columnId})`,
        r.querySelector<HTMLElement>('.card[data-card-id="1"]')?.dataset.columnId === 'b');
      wrap.remove();
    }

    // Birko FEATURE-024 (DraCode): TASK-971 an Auto theme that follows the browser's light/dark setting, live;
    // TASK-972 the first-paint script. The browser setting is emulated by a stand-in matchMedia.
    {
      const html = document.documentElement;
      const prevTheme = html.getAttribute('data-theme');
      const realMM = window.matchMedia;
      let prefersDark = true;
      const subs = new Set<() => void>();
      const mql = { get matches() { return prefersDark; }, media: '(prefers-color-scheme: dark)',
        addEventListener: (_t: string, f: () => void) => subs.add(f), removeEventListener: (_t: string, f: () => void) => subs.delete(f) };
      window.matchMedia = ((q: string) => (q.includes('prefers-color-scheme') ? mql : realMM.call(window, q))) as typeof window.matchMedia;
      const flip = (dark: boolean) => { prefersDark = dark; subs.forEach((f) => f()); };
      try {
        class AutoShell extends BAppShell {
          start = 'auto'; themes = [BUILTIN_THEMES.light, BUILTIN_THEMES.dark];
          protected get brandName() { return 'Smoke'; }
          protected get storagePrefix() { return 'smoke-971'; }
          protected get defaultTheme() { return this.start; }
          protected getAvailableThemes() { return this.themes; }
          protected getUserName() { return ''; }
          protected t(key: string) { return key; }
          protected onSignOut() {}
          protected getRibbonTabs() { return []; }
          protected getActiveTabId() { return ''; }
          protected onTabChange() {}
          protected get showStatusBar() { return false; }
          protected get showCommandPalette() { return false; }
          menu() { return ((this.shadowRoot!.querySelector('#theme-dropdown') as unknown as { _items: { id: string; label: string }[] })._items ?? []); }
        }
        if (!customElements.get('smoke-auto-shell')) define('smoke-auto-shell', AutoShell);
        const mount = async (setup: (s: AutoShell) => void) => {
          const sh = document.createElement('smoke-auto-shell') as AutoShell; setup(sh);
          document.body.appendChild(sh); await new Promise((r) => setTimeout(r, 30)); return sh;
        };
        localStorage.removeItem('smoke-971-theme');
        let sh = await mount(() => {});
        const first = { current: sh.currentTheme, applied: sh.appliedTheme, attr: html.getAttribute('data-theme'), menu: sh.menu().map((i) => i.id).join(), ticked: sh.menu()[0]?.label };
        flip(false);
        const afterLight = { applied: sh.appliedTheme, attr: html.getAttribute('data-theme') };
        flip(true);
        const afterDark = html.getAttribute('data-theme');
        check(`TASK-971: an app starting on Auto follows the browser setting, live (${JSON.stringify(first)}, light ${JSON.stringify(afterLight)}, dark again ${afterDark})`,
          first.current === 'auto' && first.applied === 'dark' && first.attr === 'dark' && first.menu === 'auto,light,dark' && first.ticked === '&#10003; Auto'
          && afterLight.applied === 'light' && afterLight.attr === null && afterDark === 'dark');
        sh.setTheme('light');
        const saved = localStorage.getItem('smoke-971-theme');
        flip(true);
        const fixed = html.getAttribute('data-theme');
        sh.setTheme('auto');
        const savedAuto = localStorage.getItem('smoke-971-theme');
        sh.remove();
        check(`TASK-971: a chosen theme is kept whatever the browser says (saved ${saved}, applied ${fixed}); Auto is saved as auto (${savedAuto}); the browser listener goes with the shell (${subs.size} left)`,
          saved === 'light' && fixed === null && savedAuto === 'auto' && subs.size === 0);
        sh = await mount((s) => { s.themes = [BUILTIN_THEMES.light, BUILTIN_THEMES.neon]; });
        const noDark = { applied: sh.appliedTheme, attr: html.getAttribute('data-theme'), menu: sh.menu().map((i) => i.id).join() };
        sh.remove();
        localStorage.removeItem('smoke-971-theme');
        sh = await mount((s) => { s.start = 'light'; });
        const byDefault = { current: sh.currentTheme, attr: html.getAttribute('data-theme') };
        sh.remove();
        check(`TASK-971: without dark, Auto is light and not offered (${JSON.stringify(noDark)}); an app that does not opt in starts light (${JSON.stringify(byDefault)})`,
          noDark.applied === 'light' && noDark.attr === null && noDark.menu === 'light,neon' && byDefault.current === 'light' && byDefault.attr === null);

        const boot = (saved: string | null, opts: Parameters<typeof themeBootScript>[0]) => {
          html.removeAttribute('data-theme');
          if (saved === null) localStorage.removeItem('smoke-972-theme'); else localStorage.setItem('smoke-972-theme', saved);
          new Function(themeBootScript({ prefix: 'smoke-972', ...opts }))();
          return html.getAttribute('data-theme');
        };
        prefersDark = true;
        const cases = { autoDark: boot('auto', {}), autoNoDark: boot('auto', { hasDark: false }), defaultAuto: boot(null, { defaultTheme: 'auto' }),
          defaultLight: boot(null, {}), savedNeon: boot('neon', {}) };
        prefersDark = false;
        const autoLight = boot('auto', {});
        localStorage.removeItem('smoke-972-theme');
        check(`TASK-972: the first-paint script applies what the shell would (${JSON.stringify({ ...cases, autoLight })})`,
          cases.autoDark === 'dark' && cases.autoNoDark === null && cases.defaultAuto === 'dark' && cases.defaultLight === null
          && cases.savedNeon === 'neon' && autoLight === null);
      } finally {
        window.matchMedia = realMM;
        if (prevTheme) html.setAttribute('data-theme', prevTheme); else html.removeAttribute('data-theme');
        localStorage.removeItem('smoke-971-theme');
      }
    }

    // Birko TASK-966 (reported by DraCode): the default user menu always offered Profile (#/profile), a dead link in an
    // app with no profile page. It is now opt-in through showProfileMenuItem.
    {
      class SmokeMenuShell extends BAppShell {
        profile = false;
        protected get brandName() { return 'Smoke'; }
        protected get storagePrefix() { return 'smoke-966'; }
        protected getUserName() { return 'Ann'; }
        protected t(key: string) { return key; }
        protected onSignOut() {}
        protected getRibbonTabs() { return []; }
        protected getActiveTabId() { return ''; }
        protected onTabChange() {}
        protected get showStatusBar() { return false; }
        protected get showCommandPalette() { return false; }
        protected get showProfileMenuItem() { return this.profile; }
        ids() { return this.getUserMenuItems().map((i) => i.id); }
      }
      if (!customElements.get('smoke-menu-shell')) define('smoke-menu-shell', SmokeMenuShell);
      const shell = document.createElement('smoke-menu-shell') as SmokeMenuShell;
      const byDefault = shell.ids();
      shell.profile = true;
      const optedIn = shell.ids();
      check(`TASK-966: the default user menu has no Profile (${byDefault.join(', ')}); an app that opts in gets it first (${optedIn.join(', ')})`,
        byDefault.join() === 'settings,signout' && optedIn.join() === 'profile,settings,signout');
    }

    // Birko TASK-962 (reported by DraCode): a page's redraw removed every attribute its render did not contain, so an
    // attribute a component set on itself (b-kanban stacked, b-checkbox checked, ...) was lost at the page's next update.
    // Now only an attribute the page rendered and has stopped rendering is removed.
    {
      const frames = (n = 3) => new Promise<void>((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      if (!customElements.get('smoke-self-attr')) {
        customElements.define('smoke-self-attr', class extends HTMLElement {
          connectedCallback() { if (!this.hasAttribute('data-own')) this.setAttribute('data-own', 'connected'); }
        });
      }
      class MorphHost extends BaseComponent {
        title_ = true; tip = 'one'; late = false;
        render() {
          // The morph matches children by position, so the element that appears later goes last.
          return '<smoke-self-attr id="early"></smoke-self-attr>'
            + `<div id="plain"${this.title_ ? ' title="t"' : ''} data-tip="${this.tip}"></div>`
            + '<b-checkbox id="cb" label="Agree"></b-checkbox>'
            + '<div style="width:360px"><b-kanban id="kb"></b-kanban></div>'
            + (this.late ? '<smoke-self-attr id="late"></smoke-self-attr>' : '');
        }
        redraw() { this.update(); }
      }
      if (!customElements.get('smoke-morph-host')) define('smoke-morph-host', MorphHost);
      const host = document.createElement('smoke-morph-host') as MorphHost;
      document.body.appendChild(host);
      await frames(2);
      const q = <T extends Element = HTMLElement>(sel: string) => host.shadowRoot!.querySelector(sel) as T;
      const kb = q<BKanban>('#kb');
      kb.setConfig({ stackBelow: '44rem', columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], cards: [] } as never);
      (q('#cb') as unknown as { checked: boolean }).checked = true;
      q('#early').setAttribute('data-later', 'set-by-itself');
      await frames(4);
      const before = { own: q('#early').getAttribute('data-own'), later: q('#early').getAttribute('data-later'),
        checked: q('#cb').hasAttribute('checked'), stacked: kb.hasAttribute('stacked') };
      host.late = true;
      host.redraw();
      q('#late').setAttribute('data-later', 'set-by-itself');
      host.tip = 'two'; host.title_ = false;
      host.redraw();
      await frames(2);
      const same = q('#cb') !== null && q('#kb') === kb;
      const after = { same, own: q('#early').getAttribute('data-own'), later: q('#early').getAttribute('data-later'),
        lateOwn: q('#late')?.getAttribute('data-later'), checked: q('#cb').hasAttribute('checked'), stacked: q('#kb').hasAttribute('stacked') };
      check(`TASK-962: attributes components set on themselves survive their page's redraw (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`,
        before.own === 'connected' && before.checked && before.stacked
        && after.same && after.own === 'connected' && after.later === 'set-by-itself' && after.lateOwn === 'set-by-itself' && after.checked && after.stacked);
      const plain = q('#plain');
      check(`TASK-962: ...while an attribute the page stopped rendering is removed and a changed one updates (title ${plain.getAttribute('title')}, tip ${plain.getAttribute('data-tip')})`,
        !plain.hasAttribute('title') && plain.getAttribute('data-tip') === 'two');
      host.remove();
    }

    // Birko TASK-943 (reported by DraCode): BMarkdownEditor.renderMarkdown escaped only & < >, so a link, image or
    // code-fence language could close its attribute and add a handler, and a link or image target was never checked
    // for its scheme (javascript: ran). Parsed inertly with DOMParser, so nothing here can execute.
    {
      const parse = (md: string) => new DOMParser().parseFromString(`<body>${BMarkdownEditor.renderMarkdown(md)}</body>`, 'text/html').body;
      const hostile = [
        '<script>window.__pwned = 1</script>',
        '<img src=x onerror="window.__pwned = 2">',
        '[click](javascript:window.__pwned=3)',
        '[quote](x" onmouseover="window.__pwned=4)',
        '![pic](y" onerror="window.__pwned=5)',
        '![a" onerror="window.__pwned=6](z.png)',
        '[tab](java\tscript:window.__pwned=7)',
        '[case](JaVaScRiPt:window.__pwned=8)',
        "[single](x' onmouseover='window.__pwned=9)",
        '```js" onmouseover="window.__pwned=10\ncode\n```',
        '[data](data:text/html,<script>window.__pwned=11</script>)',
      ];
      const handlersOf = (root: Element) => [root, ...root.querySelectorAll('*')]
        .flatMap((el) => [...el.attributes].filter((a) => a.name.startsWith('on')).map((a) => `${el.tagName.toLowerCase()}[${a.name}]`));
      const unsafeTargets = (root: Element) => [...root.querySelectorAll('[href], [src]')]
        .map((el) => el.getAttribute('href') ?? el.getAttribute('src') ?? '')
        // A browser ignores control characters and whitespace inside a scheme, so collapse them before asking.
        .map((v) => Array.from(v).filter((c) => c.charCodeAt(0) > 0x20).join('').toLowerCase())
        .filter((v) => /^[a-z][a-z0-9+.-]*:/.test(v) && !/^(https?|mailto|tel):/.test(v));
      for (const md of hostile) {
        const body = parse(md);
        const handlers = handlersOf(body);
        const bad = unsafeTargets(body);
        check(`TASK-943: ${JSON.stringify(md)} → no script (${body.querySelectorAll('script').length}), handlers ${JSON.stringify(handlers)}, unsafe targets ${JSON.stringify(bad)}`,
          body.querySelectorAll('script').length === 0 && handlers.length === 0 && bad.length === 0);
      }
      {
        const body = parse('[click](javascript:alert(1))');
        check(`TASK-943: a refused link stays visible as text (${JSON.stringify(body.textContent)}, ${body.querySelectorAll('a').length} links)`,
          body.querySelectorAll('a').length === 0 && (body.textContent ?? '').includes('click'));
      }
      const safe: [string, string, string][] = [
        ['[fine](https://example.com/docs)', 'a', 'https://example.com/docs'],
        ['[rel](/docs/page)', 'a', '/docs/page'],
        ['[frag](#section)', 'a', '#section'],
        ['[mail](mailto:a@example.com)', 'a', 'mailto:a@example.com'],
        ['[q](https://example.com/?a=1&b=2)', 'a', 'https://example.com/?a=1&b=2'],
        ['![pic](https://example.com/p.png)', 'img', 'https://example.com/p.png'],
        ['![pic](images/p.png)', 'img', 'images/p.png'],
      ];
      for (const [md, tag, want] of safe) {
        const el = parse(md).querySelector(tag);
        const got = el?.getAttribute(tag === 'a' ? 'href' : 'src') ?? null;
        check(`TASK-943: a safe target is kept: ${md} → ${JSON.stringify(got)}`, got === want);
      }
      check('TASK-943: a fenced language still becomes the code class',
        parse('```ts\nconst a = 1;\n```').querySelector('code')?.className === 'language-ts');
    }

    // Birko TASK-944 (reported by DraCode): three rendering bugs in BMarkdownEditor.renderMarkdown.
    {
      const parse = (md: string) => new DOMParser().parseFromString(`<body>${BMarkdownEditor.renderMarkdown(md)}</body>`, 'text/html').body;
      {
        const body = parse('1. waver.js exports greet(name). greet returns\n   `Hello, <name>!`.\n2. second');
        const items = [...body.querySelectorAll('ol > li')].map((li) => li.textContent);
        check(`TASK-944: an indented continuation line stays in its ordered item (${JSON.stringify(items)}, ${body.querySelectorAll('ol').length} lists, ${body.querySelectorAll('p').length} paragraphs)`,
          body.querySelectorAll('ol').length === 1 && items.length === 2 && (items[0] ?? '').includes('Hello, <name>!') && body.querySelectorAll('p').length === 0);
      }
      {
        const body = parse('- first item\n  continues here\n- second');
        const items = [...body.querySelectorAll('ul > li')].map((li) => li.textContent);
        check(`TASK-944: ...and in its unordered item (${JSON.stringify(items)})`,
          body.querySelectorAll('ul').length === 1 && items.length === 2 && (items[0] ?? '').includes('continues here'));
      }
      {
        const body = parse('Components:\n- a\n- b');
        const ul = body.querySelector('ul');
        check(`TASK-944: a list right after a paragraph line has no <br> between its items (${ul?.querySelectorAll('br').length ?? 'no list'} br, ${ul?.querySelectorAll('li').length ?? 0} items)`,
          !!ul && ul.querySelectorAll('br').length === 0 && ul.querySelectorAll('li').length === 2);
        check(`TASK-944: ...and the paragraph line is kept (${JSON.stringify(body.querySelector('p')?.textContent ?? null)})`,
          (body.querySelector('p')?.textContent ?? '').trim() === 'Components:');
      }
      {
        const code = parse('```\nfirst line\nsecond line\n```').querySelector('pre > code')?.textContent ?? '';
        check(`TASK-944: a fence with no language starts on its first line (${JSON.stringify(code.slice(0, 12))})`, code.startsWith('first line'));
      }
    }

    // Birko TASK-945 (reported by DraCode): b-chat put its placeholder (twice) and send label into markup unescaped, so a
    // `"` closed the attribute and could add a handler or an element.
    {
      if (!customElements.get('b-chat')) define('b-chat', BChat);
      const placeholder = 'Ask "anything" & <more>" onfocus="window.__pwned=12';
      const sendLabel = 'Go <img src=x onerror="window.__pwned=13">';
      const viaAttr = document.createElement('b-chat') as BChat;
      viaAttr.setAttribute('placeholder', placeholder);
      document.body.appendChild(viaAttr);
      const viaConfig = document.createElement('b-chat') as BChat;
      document.body.appendChild(viaConfig);
      viaConfig.setConfig({ placeholder, sendLabel });
      await new Promise((r) => setTimeout(r, 10));
      for (const [label, chat] of [['attribute', viaAttr], ['config', viaConfig]] as const) {
        const ta = chat.shadowRoot?.querySelector('textarea');
        const handlers = [...(chat.shadowRoot?.querySelectorAll('*') ?? [])]
          .flatMap((el) => [...el.attributes].filter((a) => a.name.startsWith('on')).map((a) => `${el.tagName.toLowerCase()}[${a.name}]`));
        check(`TASK-945: a placeholder set by ${label} stays one attribute value (placeholder ${JSON.stringify(ta?.getAttribute('placeholder'))}, handlers ${JSON.stringify(handlers)})`,
          ta?.getAttribute('placeholder') === placeholder && ta?.getAttribute('aria-label') === placeholder && handlers.length === 0);
      }
      const btn = viaConfig.shadowRoot?.querySelector('.send-btn');
      check(`TASK-945: the send label is text, not markup (${btn?.querySelectorAll('img').length ?? 'no button'} img, ${JSON.stringify(btn?.textContent)})`,
        !!btn && btn.querySelectorAll('img').length === 0 && btn.textContent === sendLabel);
      viaAttr.remove();
      viaConfig.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] backport-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] backport-smoke ${r}`);

  // i18n-message-smoke registers messages on the GLOBAL i18n singleton, which would change the English
  // validation strings this suite asserts above ('Enter a number.', 'Rate is required'). `addMessages`
  // cannot be undone, so that suite waits on this flag rather than racing us.
  (window as unknown as { __backportSmokeDone?: boolean }).__backportSmokeDone = true;
})();

// Visible review moved to first-class gallery cards (b-sync-status + pg-device-demo) in app.ts.
