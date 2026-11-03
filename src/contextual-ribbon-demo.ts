// Birko TASK-804 — a contextual ribbon tab raised by a Shell page, for the "Contextual tab (Shell)" card: a small
// BAppShell (Sales / Stock, switching tabs navigates nowhere, so the page stays) with an orders BaseSplitPage in it.
// Select an order: its "Order" tab appears and opens; Confirm / Ship / Cancel change the order, and what is enabled
// follows its status. Deselect (the detail's ✕) and the tab goes.
import { BAppShell, BaseSplitPage, type ContextualRibbon } from 'birko-web-shell';
import { toast } from 'birko-web-components/feedback';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { RibbonTab } from 'birko-web-components';
import type { TableColumn } from 'birko-web-components/data';

type Order = { id: string; name: string; customer: string; status: 'new' | 'confirmed' | 'shipped' | 'cancelled' } & Record<string, unknown>;
const orders: Order[] = [
  { id: 'o-1001', name: 'Order 1001', customer: 'Acme', status: 'new' },
  { id: 'o-1002', name: 'Order 1002', customer: 'Globex', status: 'confirmed' },
  { id: 'o-1003', name: 'Order 1003', customer: 'Initech', status: 'shipped' },
];
const ok = (data: unknown): ApiResponse => ({ ok: true, status: 200, data, headers: new Headers() }) as ApiResponse;
const api = {
  get: async (url: string) => {
    const id = url.split('?')[0].split('/').pop();
    const one = orders.find((o) => o.id === id);
    return ok(one ? { ...one } : orders.map((o) => ({ ...o })));
  },
} as unknown as ApiClient;

const TABS: RibbonTab[] = [
  { id: 'sales', label: 'Sales', icon: '💼', groups: [{ id: 'pages', label: 'Sales', items: [{ id: 'orders', label: 'Orders', icon: '🧾', active: true }] }] },
  { id: 'stock', label: 'Stock', icon: '📦', groups: [{ id: 'pages', label: 'Stock', items: [{ id: 'items', label: 'Items', icon: '📦' }] }] },
];

class PgCtxShell extends BAppShell {
  private _active = 'sales';
  protected get brandName() { return 'Contextual demo'; }
  protected get storagePrefix() { return 'pg-ctx'; }
  protected getUserName() { return 'You'; }
  protected t(key: string) { return key; }
  protected onSignOut() {}
  protected getRibbonTabs() { return TABS; }
  protected getActiveTabId() { return this._active; }
  protected onTabChange(tabId: string) { this._active = tabId; this.refreshRibbon(); }
  protected get showStatusBar() { return false; }
  protected get showCommandPalette() { return false; }
}

class PgCtxOrders extends BaseSplitPage<Order> {
  protected endpoint = 'api/orders';
  protected get api() { return api; }
  protected get pageTitle() { return 'Orders'; }
  protected get columns(): TableColumn[] {
    return [{ key: 'name', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'status', label: 'Status' }];
  }
  protected renderDetail(o: Order) { return `<p><b>${o.name}</b> for ${o.customer}: <b>${o.status}</b></p>`; }
  protected getContextualRibbon(o: Order): ContextualRibbon {
    return {
      set: { id: 'order', label: 'Order', color: 'warning' },
      tabs: [{ id: 'order-tools', label: o.name, groups: [{ id: 'workflow', label: 'Workflow', items: [
        { id: 'confirm', label: 'Confirm', icon: '✔', disabled: o.status !== 'new', description: 'Confirm a new order.' },
        { id: 'ship', label: 'Ship', icon: '🚚', disabled: o.status !== 'confirmed', description: 'Ship a confirmed order.' },
        { id: 'cancel', label: 'Cancel', icon: '✖', disabled: o.status === 'shipped' || o.status === 'cancelled' },
      ] }] }],
    };
  }
  protected onContextualAction(itemId: string, o: Order) {
    const row = orders.find((r) => r.id === o.id);
    if (!row) return;
    row.status = itemId === 'confirm' ? 'confirmed' : itemId === 'ship' ? 'shipped' : 'cancelled';
    toast.success(`${o.name}: ${row.status}`);
    void this.reloadDetail(); // re-raises the tab, so what is enabled follows the new status
    void (this.$('#table') as unknown as { reload?: () => void } | null)?.reload?.();
  }
}

if (!customElements.get('pg-ctx-shell')) customElements.define('pg-ctx-shell', PgCtxShell);
if (!customElements.get('pg-ctx-orders')) customElements.define('pg-ctx-orders', PgCtxOrders);

// Pinned open on a first visit, so the tab and its commands are in view.
try {
  if (localStorage.getItem('pg-ctx-ribbon-pinned') === null) {
    localStorage.setItem('pg-ctx-ribbon-pinned', 'true');
    localStorage.setItem('pg-ctx-ribbon-expanded', 'true');
  }
} catch { /* storage blocked: the ribbon starts unpinned */ }

/** What the card renders inside `<pg-ctx-shell>`. */
export const CONTEXTUAL_DEMO_PAGE = '<pg-ctx-orders></pg-ctx-orders>';
