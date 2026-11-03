// Birko TASK-804 (for Symbio TASK-1028) — a Shell page raises a contextual ribbon tab for the record it shows. A real
// BAppShell with a BaseSplitPage and a BaseDetailPage in it: the tab appears (and opens) on selection, keeps through a
// ribbon refresh, sends its commands to the page, follows the record, and goes on deselect and when the page is left,
// without navigating and without collapsing the ribbon.
import 'birko-web-components';
import { BAppShell, BaseSplitPage, BaseDetailPage, type ContextualRibbon } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { RibbonTab } from 'birko-web-components';
import type { TableColumn } from 'birko-web-components/data';
import type { FormSchema } from 'birko-web-components/inputs';

type Order = { id: string; name: string; status: string } & Record<string, unknown>;
const ORDERS: Record<string, Order> = {
  o1: { id: 'o1', name: 'Order 1', status: 'new' },
  o2: { id: 'o2', name: 'Order 2', status: 'confirmed' },
};
const ok = (data: unknown): ApiResponse => ({ ok: true, status: 200, data, headers: new Headers() }) as ApiResponse;
const api = {
  get: async (url: string) => { const id = url.split('/').pop()!; return ok(ORDERS[id] ?? []); },
  put: async (_url: string, body: unknown) => ok(body),
} as unknown as ApiClient;

const TABS: RibbonTab[] = [
  { id: 'sales', label: 'Sales', groups: [{ id: 'g', label: 'Sales', items: [{ id: 'orders', label: 'Orders' }] }] },
  { id: 'stock', label: 'Stock', groups: [{ id: 'g', label: 'Stock', items: [{ id: 'items', label: 'Items' }] }] },
];
const log = { tabChanges: [] as string[], itemClicks: [] as string[], actions: [] as string[] };
let openOnRaise = true;

const orderRibbon = (o: Order): ContextualRibbon => ({
  set: { id: 'order', label: 'Order', color: 'warning' },
  tabs: [{ id: 'order-tools', label: 'Order tools', groups: [{ id: 'wf', label: 'Workflow', items: [
    { id: 'confirm', label: 'Confirm', disabled: o.status === 'confirmed' },
    { id: 'ship', label: 'Ship' },
  ] }] }],
  open: openOnRaise,
});

class CtxShell extends BAppShell {
  active = 'sales';
  protected get brandName() { return 'Ctx'; }
  protected get storagePrefix() { return 'ctx'; }
  protected getUserName() { return 'tester'; }
  protected t(key: string) { return key; }
  protected onSignOut() {}
  protected getRibbonTabs() { return TABS.map((t) => ({ ...t })); }
  protected getActiveTabId() { return this.active; }
  // As an app shell does, but without navigating, so the page stays and the tab can be checked afterwards.
  protected onTabChange(tabId: string) { log.tabChanges.push(tabId); this.active = tabId; this.refreshRibbon(); }
  protected onItemClick(_tab: string, _group: string, itemId: string) { log.itemClicks.push(itemId); }
  protected get showStatusBar() { return false; }
  protected get showCommandPalette() { return false; }
  rerender() { this.update(); }
}
class CtxSplit extends BaseSplitPage<Order> {
  protected endpoint = 'api/orders';
  protected get api() { return api; }
  protected get columns(): TableColumn[] { return [{ key: 'name', label: 'Name' }]; }
  protected renderDetail(o: Order) { return `<p>${o.name}</p>`; }
  protected get pageTitle() { return 'Orders'; }
  protected getContextualRibbon(o: Order) { return orderRibbon(o); }
  protected onContextualAction(itemId: string, o: Order) { log.actions.push(`${itemId}:${o.id}`); }
  select(id: string) { return this.selectEntity(id); }
  deselect() { this.deselectEntity(); }
}
class CtxDetail extends BaseDetailPage<Order> {
  protected endpoint = 'api/orders';
  protected get api() { return api; }
  protected get formSchema(): FormSchema { return { name: 'root', children: [{ name: 'name', type: 'text', label: 'Name' }] }; }
  protected getContextualRibbon(o: Order) { return orderRibbon(o); }
  protected onContextualAction(itemId: string, o: Order) { log.actions.push(`detail:${itemId}:${o.id}`); }
}
customElements.define('ctx-shell', CtxShell);
customElements.define('ctx-split', CtxSplit);
customElements.define('ctx-detail', CtxDetail);

const settle = (ms = 120) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));

void (async () => {
  const results: string[] = [];
  const check = (name: string, pass: boolean) => results.push(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;width:1100px;height:700px';
  document.body.appendChild(host);
  const savedHash = location.hash;
  try { localStorage.setItem('ctx-ribbon-pinned', 'true'); localStorage.setItem('ctx-ribbon-expanded', 'true'); } catch { /* none */ }

  try {
    const shell = document.createElement('ctx-shell') as CtxShell;
    host.appendChild(shell);
    await settle(200);
    const ribbon = () => shell.shadowRoot!.querySelector('#ribbon') as HTMLElement & { hideContextual(id: string): void };
    const sr = () => ribbon().shadowRoot!;
    const shown = () => !!sr().querySelector('.ribbon-tab[data-tab="order-tools"]');
    const active = () => ribbon().getAttribute('active');
    const expanded = () => ribbon().hasAttribute('expanded') && !!sr().querySelector('.ribbon-panel:not([hidden]) .ribbon-group');
    const cmd = (id: string) => sr().querySelector<HTMLElement>(`.ribbon-item[data-tab="order-tools"][data-item="${id}"]`);
    const disabled = (id: string) => { const c = cmd(id); return !!c && (c.hasAttribute('disabled') || c.getAttribute('aria-disabled') === 'true'); };

    check(`the shell starts on its module tab, no contextual tab (${active()}, ${shown()})`, active() === 'sales' && !shown());

    // ── A split page ──
    const page = document.createElement('ctx-split') as CtxSplit;
    shell.appendChild(page);
    await settle();
    await page.select('o1');
    await settle();
    check(`selecting a record shows its contextual tab, in its set (${shown()}, ${sr().querySelector('.ribbon-ctx-set')?.getAttribute('data-set')})`,
      shown() && sr().querySelector('.ribbon-ctx-set[data-set="order"]') !== null);
    check(`and opens it, without navigating (${active()}, tab changes ${JSON.stringify(log.tabChanges)})`, active() === 'order-tools' && log.tabChanges.length === 0);
    check(`its commands follow the record: Confirm enabled for a new order (${disabled('confirm')})`, cmd('confirm') !== null && !disabled('confirm'));

    cmd('ship')!.click();
    await settle(40);
    check(`a command reaches the page with its record, not the shell (${JSON.stringify(log.actions)}, ${JSON.stringify(log.itemClicks)})`,
      JSON.stringify(log.actions) === '["ship:o1"]' && log.itemClicks.length === 0);

    shell.refreshRibbon();
    shell.rerender();
    await settle();
    check(`a ribbon refresh (module, tenant, locale) keeps it shown and open (${shown()}, ${active()})`, shown() && active() === 'order-tools');

    await page.select('o2');
    await settle();
    check(`another record re-builds it: Confirm disabled for a confirmed order (${disabled('confirm')})`, disabled('confirm'));

    sr().querySelector<HTMLElement>('.ribbon-tab[data-tab="stock"]')!.click();
    await settle();
    check(`a normal tab still navigates (${JSON.stringify(log.tabChanges)}); the contextual tab stays shown (${shown()})`,
      JSON.stringify(log.tabChanges) === '["stock"]' && shown() && active() === 'stock');
    sr().querySelector<HTMLElement>('.ribbon-tab[data-tab="order-tools"]')!.click();
    await settle();
    check(`opening the contextual tab again navigates nowhere (${JSON.stringify(log.tabChanges)}, ${active()})`,
      JSON.stringify(log.tabChanges) === '["stock"]' && active() === 'order-tools');
    shell.refreshRibbon();
    await settle();
    check(`and a refresh keeps it open (${active()})`, active() === 'order-tools');

    page.deselect();
    await settle();
    check(`deselecting hides it and goes back to the module's tab, without navigating (${shown()}, ${active()}, ${JSON.stringify(log.tabChanges)})`,
      !shown() && active() === 'stock' && JSON.stringify(log.tabChanges) === '["stock"]');
    check(`the ribbon stays expanded (${expanded()})`, expanded());
    const isShown = (ribbon() as unknown as { isContextualShown(id: string): boolean }).isContextualShown('order');
    check(`the set is hidden in the ribbon too, not only dropped from its tabs (isContextualShown ${isShown})`, !isShown);

    await page.select('o1');
    await settle();
    const before = shown();
    page.remove();
    await settle();
    check(`leaving the page (removed with a record selected) hides it (${before} → ${shown()}, ${active()})`, before && !shown() && active() === 'stock');

    // ── open: false — shown, not opened (Office's behaviour) ──
    openOnRaise = false;
    const quiet = document.createElement('ctx-split') as CtxSplit;
    shell.appendChild(quiet);
    await settle();
    await quiet.select('o1');
    await settle();
    check(`with open: false the tab is shown but not opened (${shown()}, ${active()})`, shown() && active() === 'stock');
    quiet.remove();
    await settle();
    openOnRaise = true;

    // ── A detail page ──
    history.replaceState(null, '', '#/orders/o1');
    const detail = document.createElement('ctx-detail') as CtxDetail;
    shell.appendChild(detail);
    await settle(250);
    check(`a detail page raises it once its record loads (${shown()}, ${active()})`, shown() && active() === 'order-tools');
    cmd('confirm')!.click();
    await settle(40);
    check(`and gets its commands (${log.actions.at(-1)})`, log.actions.at(-1) === 'detail:confirm:o1');
    detail.remove();
    await settle();
    check(`leaving the detail page hides it (${shown()}, ${active()})`, !shown() && active() === 'stock');

    // ── b-ribbon: the tab a hidden set goes back to, when the APP set `active` (no click) ──
    type Solo = HTMLElement & { showContextual(id: string, o?: { select?: boolean }): void; hideContextual(id: string): void; setContextualSets(s: unknown[]): void; setTabs(t: RibbonTab[]): void };
    const solo = document.createElement('b-ribbon') as Solo;
    solo.setAttribute('expanded', ''); solo.setAttribute('pinned', '');
    host.appendChild(solo);
    await settle(20);
    solo.setContextualSets([{ id: 'order', label: 'Order' }]);
    solo.setTabs([...TABS, { id: 'order-tools', label: 'Order tools', contextualSet: 'order', groups: TABS[0].groups }]);
    solo.setAttribute('active', 'stock'); // as a shell does on navigation
    await settle(40);
    solo.showContextual('order', { select: true });
    await settle(40);
    solo.hideContextual('order');
    await settle(40);
    check(`b-ribbon: hiding a set goes back to the tab the app set, not the first (${solo.getAttribute('active')})`, solo.getAttribute('active') === 'stock');
    solo.remove();

    // ── The deprecated ribbon-actions event still works ──
    shell.dispatchEvent(new CustomEvent('ribbon-actions', { detail: { items: [{ id: 'legacy', label: 'Legacy' }] } }));
    await settle();
    check(`ribbon-actions still renders its loose buttons (${!!sr().querySelector('.ribbon-item[data-item="legacy"]')})`, !!sr().querySelector('.ribbon-item[data-item="legacy"]'));

    shell.remove();
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  history.replaceState(null, '', savedHash || location.pathname);
  try { localStorage.removeItem('ctx-ribbon-pinned'); localStorage.removeItem('ctx-ribbon-expanded'); } catch { /* none */ }
  host.remove();

  const passed = results.filter((x) => x.startsWith('PASS')).length;
  console.log(`[playground] contextual-ribbon-smoke: ${passed}/${results.length} passed`);
  for (const x of results) console.log(`[playground] contextual-ribbon-smoke ${x}`);
})();
