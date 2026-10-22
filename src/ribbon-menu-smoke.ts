// TASK-732 (FEATURE-019 D3) — b-ribbon split buttons and menu buttons: the parts and their ARIA, text never parsed,
// the large layout, and the mobile list. Nothing here OPENS a popover: this page runs every suite at once, and an auto
// popover closes every other one (and a modal elsewhere closes it), so open/close, choices and focus are checked in
// keyboard-check.mjs, which has the page to itself.
import 'birko-web-components/nav';
import type { RibbonGroup } from 'birko-web-components';

type Ribbon = HTMLElement & { setTabs(t: { id: string; label: string; groups: RibbonGroup[] }[]): void };
const settle = (ms = 80) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));

const groups = (hostile = false): RibbonGroup[] => [
  { id: 'clip', label: 'Clipboard', icon: '📋', items: [
    { id: 'paste', label: 'Paste', icon: '📋', split: true, menu: [
      { id: 'paste-text', label: hostile ? '<img src=x onerror="window.__ribbonMenuXss=1">' : 'Paste as text', icon: '📝', shortcut: 'Ctrl+Shift+V' },
      { id: 'paste-pic', label: 'Paste as picture' },
      { separator: true },
      { id: 'paste-off', label: 'Paste special', disabled: true },
    ] },
    { id: 'cut', label: 'Cut', icon: '✂️' },
  ] },
  { id: 'exp', label: 'Export', icon: '📤', items: [
    { id: 'csv', label: 'CSV', icon: '📊', menu: [{ id: 'csv-comma', label: 'Comma' }, { id: 'csv-semi', label: 'Semicolon' }] },
    { id: 'pdf', label: 'PDF', icon: '📄' },
  ] },
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(host);
  const mount = async (width: number, g = groups(), attrs: Record<string, string> = {}) => {
    const el = document.createElement('b-ribbon') as Ribbon;
    el.style.width = `${width}px`;
    el.setAttribute('expanded', '');
    el.setAttribute('pinned', '');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    host.appendChild(el);
    await settle(20);
    el.setTabs([{ id: 'home', label: 'Home', groups: g }]);
    await settle(160);
    return el;
  };

  try {
    // ── 1. Markup and ARIA ──
    {
      const el = await mount(1000);
      const sr = el.shadowRoot!;
      const split = sr.querySelector<HTMLElement>('.ribbon-split');
      const main = split?.querySelector<HTMLElement>('.ribbon-split-main');
      const arrow = split?.querySelector<HTMLElement>('.ribbon-split-arrow');
      check('a split command renders a main part and a ▾ part', !!main && !!arrow);
      check('the main part is the command (data-item, no popup)', main?.dataset.item === 'paste' && !main.hasAttribute('aria-haspopup'));
      check('the ▾ part declares a menu popup, collapsed', arrow?.getAttribute('aria-haspopup') === 'menu' && arrow.getAttribute('aria-expanded') === 'false');
      const menu = sr.getElementById(arrow?.getAttribute('aria-controls') ?? '');
      check('aria-controls names its menu: role="menu", a popover', menu?.getAttribute('role') === 'menu' && menu.getAttribute('popover') !== null);
      check(`the ▾ part is named "More options: Paste" (${arrow?.getAttribute('aria-label')})`, arrow?.getAttribute('aria-label') === 'More options: Paste');
      const csv = sr.querySelector<HTMLElement>('.ribbon-item[data-item="csv"]');
      check('a menu-only command is one button that opens the menu', !!csv?.hasAttribute('data-menu-trigger') && csv.getAttribute('aria-haspopup') === 'menu' && !!csv.querySelector('.ribbon-caret'));
      const items = [...(menu?.querySelectorAll<HTMLElement>('.ribbon-menu-item') ?? [])];
      check(`menu items are menuitems out of the Tab order (${items.length})`, items.length === 3 && items.every((i) => i.getAttribute('role') === 'menuitem' && i.tabIndex === -1));
      check('a disabled choice is aria-disabled', items[2]?.getAttribute('aria-disabled') === 'true');
      check('a separator is role="separator"', menu?.querySelectorAll('[role="separator"]').length === 1);
      const sc = items[0]?.querySelector('kbd');
      check(`a shortcut is shown and exposed (${sc?.textContent}, ${items[0]?.getAttribute('aria-keyshortcuts')})`, sc?.textContent === 'Ctrl+Shift+V' && items[0].getAttribute('aria-keyshortcuts') === 'Ctrl+Shift+V');
      check('icons line up: an item without one keeps an empty icon cell', items[1]?.querySelector('.ribbon-menu-icon')?.textContent === '');
      const stops = [...sr.querySelectorAll<HTMLElement>('.ribbon-panel-inner .ribbon-split > *')];
      check('both split parts are keyboard stops (roving tabindex set)', stops.length === 2 && stops.every((s) => s.tabIndex === 0 || s.tabIndex === -1));
      el.remove();
    }

    // ── 2. Text, never markup ──
    {
      const el = await mount(1000, groups(true));
      const sr = el.shadowRoot!;
      check('a choice label is text: no element parsed from it', !sr.querySelector('.ribbon-menu img') && !(globalThis as { __ribbonMenuXss?: number }).__ribbonMenuXss);
      check('and it reads as written', sr.querySelector('.ribbon-menu-label')?.textContent === '<img src=x onerror="window.__ribbonMenuXss=1">');
      el.remove();
    }

    // ── 3. Large: icon runs the command, "Label ▾" below opens the menu ──
    {
      const el = await mount(1000, groups(), { 'preferred-group-size': 'large' });
      const sr = el.shadowRoot!;
      const split = sr.querySelector<HTMLElement>('.ribbon-group.size-large .ribbon-split');
      check('large: the split renders', !!split);
      if (split) {
        const main = split.querySelector<HTMLElement>('.ribbon-split-main')!;
        const arrow = split.querySelector<HTMLElement>('.ribbon-split-arrow')!;
        check('large: the parts stack, the ▾ part below', arrow.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 1);
        check('large: the label moves to the ▾ part', getComputedStyle(main.querySelector('.ribbon-item-label')!).display === 'none'
          && getComputedStyle(arrow.querySelector('.ribbon-split-arrow-label')!).display !== 'none');
      }
      el.remove();
    }

    // ── 4. Mobile list ──
    {
      const el = await mount(1000);
      const sr = el.shadowRoot!;
      const subs = [...sr.querySelectorAll<HTMLElement>('.mobile-subitem')];
      check(`choices are listed under their command on mobile (${subs.map((s) => s.dataset.item).join(',')})`,
        subs.map((s) => s.dataset.item).join(',') === 'paste-text,paste-pic,paste-off,csv-comma,csv-semi' && subs.every((s) => !!s.dataset.parent));
      check('a disabled choice is disabled there too', !!sr.querySelector<HTMLButtonElement>('.mobile-subitem[data-item="paste-off"]')?.disabled);
      check('a menu-only command is their heading, not a button', !!sr.querySelector('.mobile-item-heading') && !sr.querySelector('.mobile-item[data-item="csv"]'));
      const got: Record<string, unknown>[] = [];
      el.addEventListener('item-click', (e) => got.push((e as CustomEvent).detail));
      sr.querySelector<HTMLElement>('.mobile-subitem[data-item="csv-semi"]')!.click();
      check(`a mobile choice reports its parent (${JSON.stringify(got[0])})`, (got[0] as { parentId?: string })?.parentId === 'csv');
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-menu-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-menu-smoke ${r}`);
})();
