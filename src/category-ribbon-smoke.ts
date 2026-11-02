// Birko TASK-803 — buildCategoryRibbon's module split buttons and b-ribbon's link parts. What the builder returns, and
// what b-ribbon renders from it: the split main part and every page choice are links, an action choice is a button.
// Nothing here opens a popover (see ribbon-menu-smoke): opening, picking and navigating are in category-ribbon-check.mjs.
import 'birko-web-components/nav';
import type { RibbonItem, RibbonMenuItem, RibbonTab } from 'birko-web-components';
import { demoTabs } from './category-ribbon-demo.js';

type Ribbon = HTMLElement & { setTabs(t: RibbonTab[]): void };
const settle = (ms = 80) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));
const modulesGroup = (tabs: RibbonTab[], tab: string) => tabs.find((t) => t.id === tab)?.groups.find((g) => g.id === '_modules');
const moduleItem = (tabs: RibbonTab[], tab: string, id: string) => modulesGroup(tabs, tab)?.items.find((i) => i.id === id);
const choices = (item?: RibbonItem) => (item?.menu ?? []).filter((e): e is RibbonMenuItem => !('separator' in e));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;width:1000px';
  document.body.appendChild(host);

  try {
    // ── 1. The builder ──
    {
      const tabs = demoTabs('sales', '/demo/sales/invoices');
      const sales = moduleItem(tabs, 'business', 'sales');
      const users = moduleItem(tabs, 'admin', 'users');
      check('a module with two or more pages is a split button with a menu', sales?.split === true && choices(sales).length === 4);
      check('its main part keeps the link to its first page', sales?.href === '#/demo/sales/orders');
      check('a module with one page stays a plain link button', !!users && !users.split && !users.menu && users.href === '#/demo/users/list');
      check(`menu ids are <moduleId>:<optionId> (${choices(sales).map((c) => c.id).join(',')})`,
        choices(sales).map((c) => c.id).join(',') === 'sales:orders,sales:invoices,sales:quotes,sales:export');
      check('a page choice links to its route, with label and icon', choices(sales)[1]?.href === '#/demo/sales/invoices' && choices(sales)[1]?.label === 'Invoices' && choices(sales)[1]?.icon === '📄');
      check('an actionOnly choice has no link', choices(sales)[3]?.href === undefined);
      const seps = (sales?.menu ?? []).map((e) => ('separator' in e ? '|' : 'x')).join('');
      check(`a separator wherever the page group changes (${seps})`, seps === 'xx|x|x');
      check('a module description is the tooltip line', sales?.description === 'Orders, invoices and quotes.');
      check('a description key goes through the label resolver', moduleItem(tabs, 'business', 'catalogue')?.description === 'PRODUCTS AND THEIR CATEGORIES.');
      const pages = tabs.find((t) => t.id === 'business')?.groups.find((g) => g.id === 'sales');
      check('the active module\'s pages group stays by default', pages?.items.length === 4);
      check('a page description reaches its pages-group item', pages?.items[0]?.description === 'Every order, newest first.');
      check('the active page is marked in the pages group', pages?.items.find((i) => i.active)?.id === 'sales:invoices');
      const off = demoTabs('sales', '/demo/sales/invoices', { activePagesGroup: false, moduleMenus: false });
      check('activePagesGroup: false drops the pages group', off.find((t) => t.id === 'business')?.groups.length === 1);
      check('moduleMenus: false keeps plain module buttons', !moduleItem(off, 'business', 'sales')?.split && !moduleItem(off, 'business', 'sales')?.menu);
    }

    // ── 2. What b-ribbon renders ──
    {
      const el = document.createElement('b-ribbon') as Ribbon;
      el.setAttribute('expanded', '');
      el.setAttribute('pinned', '');
      el.setAttribute('active', 'business');
      host.appendChild(el);
      await settle(20);
      el.setTabs(demoTabs('sales', '/demo/sales/orders'));
      await settle(160);
      const sr = el.shadowRoot!;
      const main = sr.querySelector<HTMLElement>('.ribbon-split-main[data-item="sales"]');
      check(`the split main part is a link to the first page (${main?.tagName})`, main instanceof HTMLAnchorElement && main.getAttribute('href') === '#/demo/sales/orders');
      check('the ▾ part is still a button that opens a menu', sr.querySelector('.ribbon-split-arrow[data-arrow="sales"]')?.getAttribute('aria-haspopup') === 'menu');
      const page = sr.querySelector<HTMLElement>('.ribbon-menu-item[data-parent="sales"][data-menu-item="sales:quotes"]');
      check(`a page choice is a link menuitem (${page?.tagName}, ${page?.getAttribute('href')})`,
        page instanceof HTMLAnchorElement && page.getAttribute('href') === '#/demo/sales/quotes' && page.getAttribute('role') === 'menuitem' && page.tabIndex === -1);
      const action = sr.querySelector<HTMLElement>('.ribbon-menu-item[data-menu-item="sales:export"]');
      check('an action choice is a button', action instanceof HTMLButtonElement);
      check('the module tooltip is its accessible description', main?.getAttribute('aria-description') === 'Orders, invoices and quotes.');
      const noLink = demoTabs();
      noLink[0].groups[0].items = [{ ...noLink[0].groups[0].items[0], href: undefined }];
      el.setTabs(noLink);
      await settle(120);
      check('a split command with no link keeps a <button> main part', sr.querySelector('.ribbon-split-main[data-item="sales"]') instanceof HTMLButtonElement);
      el.setTabs(demoTabs('sales', '/demo/sales/orders'));
      await settle(160);

      // A choice clicked: item-click with the module as parentId, and the link left to navigate (no preventDefault).
      const clicks: { itemId?: string; parentId?: string }[] = [];
      el.addEventListener('item-click', (e) => clicks.push((e as CustomEvent).detail));
      const before = location.hash;
      sr.querySelector<HTMLElement>('.ribbon-menu-item[data-menu-item="sales:invoices"]')?.click();
      const after = location.hash;
      history.replaceState(null, '', `${location.pathname}${location.search}${before}`);
      check(`a page choice emits item-click with the module as parentId (${JSON.stringify(clicks[0])})`, clicks[0]?.itemId === 'sales:invoices' && clicks[0]?.parentId === 'sales');
      check(`and navigates to its page (${after})`, after === '#/demo/sales/invoices');
      sr.querySelector<HTMLElement>('.ribbon-menu-item[data-menu-item="sales:export"]')?.click();
      check('an action choice emits item-click as before, and navigates nowhere', clicks[1]?.itemId === 'sales:export' && clicks[1]?.parentId === 'sales' && location.hash === before);
      el.remove();
    }

    // ── 3. The phone list ──
    {
      const el = document.createElement('b-ribbon') as Ribbon;
      el.setAttribute('active', 'business');
      host.appendChild(el);
      await settle(20);
      el.setTabs(demoTabs());
      await settle(160);
      const sub = el.shadowRoot!.querySelector<HTMLElement>('.mobile-subitem[data-parent="sales"][data-item="sales:invoices"]');
      const act = el.shadowRoot!.querySelector<HTMLElement>('.mobile-subitem[data-parent="sales"][data-item="sales:export"]');
      check(`on the phone list a page choice is a link (${sub?.tagName})`, sub instanceof HTMLAnchorElement && sub.getAttribute('href') === '#/demo/sales/invoices');
      check('and an action choice a button', act instanceof HTMLButtonElement);
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] category-ribbon-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] category-ribbon-smoke ${r}`);
})();
