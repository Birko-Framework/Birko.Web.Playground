// EPIC-002 web backport smoke — exercises the new Birko.Web.Core APIs in a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
// This is how the framework's frontend backports are verified (no in-framework unit runner).
import { getFormatter, createWakeLockManager, createAudioCue, MirrorStore, readThrough, define, registerServiceWorker, I18n, signal, setPersistPrefix, SyncManager, Store, unwrapList, apiErrorMessage, ApiClient } from 'birko-web-core';
import { BSyncStatus, type SyncSource } from 'birko-web-components/feedback';
import { BTreeMenu } from 'birko-web-components/nav';
import { BMarkdownEditor } from 'birko-web-components/inputs';
import { BPagination, BKanban } from 'birko-web-components/data';
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
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] backport-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] backport-smoke ${r}`);
})();

// Visible review moved to first-class gallery cards (b-sync-status + pg-device-demo) in app.ts.
