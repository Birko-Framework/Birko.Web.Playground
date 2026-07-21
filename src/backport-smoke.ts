// EPIC-002 web backport smoke — exercises the new Birko.Web.Core APIs in a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
// This is how the framework's frontend backports are verified (no in-framework unit runner).
import { getFormatter, createWakeLockManager, createAudioCue, MirrorStore, readThrough, define, registerServiceWorker, I18n, signal, setPersistPrefix, SyncManager, Store, unwrapList, apiErrorMessage, ApiClient } from 'birko-web-core';
import { BSyncStatus, type SyncSource } from 'birko-web-components/feedback';
import { BTreeMenu, BRibbon, type RibbonTab } from 'birko-web-components/nav';
import { BMarkdownEditor } from 'birko-web-components/inputs';
import { BPagination, BKanban, BDataTable } from 'birko-web-components/data';
import { confirm as dlgConfirm } from 'birko-web-components/dialogs';
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
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] backport-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] backport-smoke ${r}`);
})();

// Visible review moved to first-class gallery cards (b-sync-status + pg-device-demo) in app.ts.
