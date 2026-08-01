// EPIC-002 web backport smoke — exercises the new Birko.Web.Core APIs in a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
// This is how the framework's frontend backports are verified (no in-framework unit runner).
import { parseDecimal, getFormatter, createWakeLockManager, createAudioCue, MirrorStore, readThrough, readWindowThrough, syncWindow, inWindow, define, registerServiceWorker, I18n, signal, setPersistPrefix, SyncManager, Store, unwrapList, apiErrorMessage, ApiClient } from 'birko-web-core';
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

      // `valueMissing` is the one exclusion that is NOT just "required already covers it". Required
      // returns before the control is consulted, so adopting the flag would be a no-op almost
      // everywhere — except here, where the two genuinely disagree: b-form's emptiness test counts
      // `false` as a filled value, so an unchecked required checkbox passes its rule and never reaches
      // the control, while the control reports valueMissing. Pinned as-is: a real, pre-existing gap
      // that this change deliberately does not close, because closing it starts blocking forms that
      // have always submitted.
      {
        const f = await mkForm([{ name: 'agree', type: 'checkbox', label: 'Agree', required: true }]);
        check('premise: an unchecked required checkbox reports ITSELF invalid',
          field(f, 'agree')?.checkValidity() === false);
        check('...and validate() still passes it — a known b-form gap, left alone here on purpose',
          f.validate().valid === true);
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
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] backport-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] backport-smoke ${r}`);
})();

// Visible review moved to first-class gallery cards (b-sync-status + pg-device-demo) in app.ts.
