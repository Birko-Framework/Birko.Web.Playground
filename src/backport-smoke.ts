// EPIC-002 web backport smoke — exercises the new Birko.Web.Core APIs in a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
// This is how the framework's frontend backports are verified (no in-framework unit runner).
import { getFormatter, createWakeLockManager, createAudioCue, MirrorStore, readThrough, readWindowThrough, syncWindow, inWindow, define, registerServiceWorker, I18n, signal, setPersistPrefix, SyncManager, Store, unwrapList, apiErrorMessage, ApiClient } from 'birko-web-core';
import { BSyncStatus, type SyncSource } from 'birko-web-components/feedback';
import { BTreeMenu, BRibbon, type RibbonTab } from 'birko-web-components/nav';
import { BMarkdownEditor } from 'birko-web-components/inputs';
import { BPagination, BKanban, BDataTable, BChart, niceScale, tickIntervalsForHeight, formatTick } from 'birko-web-components/data';
import { confirm as dlgConfirm } from 'birko-web-components/dialogs';
import { BCard } from 'birko-web-components/layout';
import { BMobileAppShell, type Surface } from 'birko-web-shell';
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
      update: async () => {},
      remove: async () => {},
    } as unknown as ConstructorParameters<typeof SyncManager>[0];
    const sm = new SyncManager(fakeQueue, {} as ConstructorParameters<typeof SyncManager>[1], { syncInterval: 1_000_000 });
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
    const resolved = resolveModuleFromHash(shellStore, '/inventory/stock/42');
    check('M266 resolveModuleFromHash parses module/option/entity',
      resolved.moduleId === 'inventory' && resolved.optionId === 'stock' && resolved.entityId === '42');
    check('M266 resolveModuleFromHash updates store', shellStore.get('activeModuleId') === 'inventory');

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
    } finally {
      globalThis.fetch = realFetch;
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
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] backport-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] backport-smoke ${r}`);
})();

// Visible review moved to first-class gallery cards (b-sync-status + pg-device-demo) in app.ts.
