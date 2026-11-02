// Birko TASK-803 — a category ribbon as an app shell builds it: buildCategoryRibbon over a few modules, the active
// module following the hash, as b-app-shell's subclasses do. Used by the "Category ribbon (Shell)" card, by
// category-ribbon-smoke and by category-ribbon-check.mjs (through window.__pgCategoryRibbon).
import { buildCategoryRibbon, type ModuleManifest, type CategoryDef, type CategoryRibbonOptions } from 'birko-web-shell';
import type { RibbonTab } from 'birko-web-components';

export const DEMO_MODULES = (): ModuleManifest[] => [
  { id: 'sales', label: 'Sales', icon: '💶', order: 1, category: 'business', permissions: [],
    description: 'Orders, invoices and quotes.', options: [
      { id: 'orders', label: 'Orders', icon: '🧾', route: '/demo/sales/orders', description: 'Every order, newest first.' },
      { id: 'invoices', label: 'Invoices', icon: '📄', route: '/demo/sales/invoices' },
      { id: 'quotes', label: 'Quotes', icon: '💬', route: '/demo/sales/quotes', group: 'drafts', groupLabel: 'Drafts' },
      { id: 'export', label: 'Export orders', icon: '📤', route: '/demo/sales/export', group: 'tools', actionOnly: true },
    ] },
  { id: 'catalogue', label: 'Catalogue', icon: '📦', order: 2, category: 'business', permissions: [],
    descriptionKey: 'demo.catalogue.description', description: 'Products and their categories.', options: [
      { id: 'products', label: 'Products', icon: '🌸', route: '/demo/catalogue/products' },
      { id: 'categories', label: 'Categories', icon: '🗂', route: '/demo/catalogue/categories' },
    ] },
  { id: 'users', label: 'Users', icon: '👤', order: 3, category: 'admin', permissions: [], options: [
      { id: 'list', label: 'Users', icon: '👤', route: '/demo/users/list' },
    ] },
];

export const DEMO_CATEGORIES: CategoryDef[] = [
  { id: 'business', label: 'Business', order: 1 },
  { id: 'admin', label: 'Admin', order: 2 },
];

/** The demo's label resolver: one key, upper-cased so a test can tell it ran. */
export const demoResolve = (key: string | undefined, fallback: string) =>
  key === 'demo.catalogue.description' ? 'PRODUCTS AND THEIR CATEGORIES.' : fallback;

/** The module and route the current hash points at, as a shell's route table would say. */
export function activeFromHash(hash = location.hash): { moduleId?: string; route?: string } {
  const route = hash.replace(/^#/, '');
  const mod = DEMO_MODULES().find((m) => m.options.some((o) => o.route === route));
  return mod ? { moduleId: mod.id, route } : {};
}

export function demoTabs(moduleId?: string, route?: string, options?: CategoryRibbonOptions): RibbonTab[] {
  return buildCategoryRibbon(DEMO_MODULES(), DEMO_CATEGORIES, demoResolve, moduleId, route, options);
}

type Ribbon = HTMLElement & { setTabs(t: RibbonTab[]): void };

/** Feeds a b-ribbon from the hash and keeps it in step, as an app shell does; records item-click. */
export function mountCategoryRibbon(el: HTMLElement): { clicks: Record<string, unknown>[]; stop(): void } {
  const ribbon = el as Ribbon;
  const clicks: Record<string, unknown>[] = [];
  const refresh = () => {
    const { moduleId, route } = activeFromHash();
    ribbon.setTabs(demoTabs(moduleId, route));
    const tab = DEMO_MODULES().find((m) => m.id === moduleId)?.category;
    if (tab) ribbon.setAttribute('active', tab);
  };
  const onClick = (e: Event) => {
    clicks.push((e as CustomEvent).detail);
    console.log('[playground] category ribbon item-click', JSON.stringify((e as CustomEvent).detail));
  };
  ribbon.addEventListener('item-click', onClick);
  window.addEventListener('hashchange', refresh);
  refresh();
  return { clicks, stop: () => { window.removeEventListener('hashchange', refresh); ribbon.removeEventListener('item-click', onClick); } };
}

(window as unknown as { __pgCategoryRibbon?: unknown }).__pgCategoryRibbon = { mountCategoryRibbon, demoTabs };
