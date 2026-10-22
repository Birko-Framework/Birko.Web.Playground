// TASK-734 (FEATURE-019 D5) — b-ribbon contextual tabs: hidden until shown, then after the normal tabs inside a band,
// a pill or an edge (contextual-style, or per set); theme colours; hiding the open set goes back to the previous normal
// tab with tab-change; names are text; the mobile list and the arrow keys follow what is shown.
import 'birko-web-components/nav';
import type { RibbonTab, RibbonContextualSet } from 'birko-web-components';

type Ribbon = HTMLElement & {
  setTabs(t: RibbonTab[]): void;
  setContextualSets(s: RibbonContextualSet[]): void;
  showContextual(id: string, o?: { select?: boolean }): void;
  hideContextual(id: string): void;
  isContextualShown(id: string): boolean;
};
const settle = (ms = 80) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));
const g = (id: string) => [{ id: `${id}-g`, label: 'G', items: [{ id: `${id}-a`, label: 'A' }] }];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(host);

  try {
    const el = document.createElement('b-ribbon') as Ribbon;
    el.style.width = '1000px';
    el.setAttribute('expanded', '');
    el.setAttribute('pinned', '');
    host.appendChild(el);
    await settle(20);
    el.setTabs([
      { id: 'home', label: 'Home', groups: g('home') },
      { id: 'insert', label: 'Insert', groups: g('insert') },
      { id: 'td', label: 'Table Design', contextualSet: 'table', groups: g('td') },
      { id: 'tl', label: 'Layout', contextualSet: 'table', groups: g('tl') },
      { id: 'pic', label: 'Picture Format', contextualSet: 'picture', groups: g('pic') },
    ]);
    el.setContextualSets([
      { id: 'table', label: 'Table', color: 'success' },
      { id: 'picture', label: '<img src=x onerror="window.__ctxXss=1">', color: 'nope' as never, style: 'edge' },
    ]);
    await settle(120);
    const sr = el.shadowRoot!;
    const tabIds = () => [...sr.querySelectorAll<HTMLElement>('.ribbon-tabs .ribbon-tab')].map((t) => t.dataset.tab);
    const events: string[] = [];
    el.addEventListener('tab-change', (e) => events.push((e as CustomEvent).detail.tab));

    check(`contextual tabs are hidden until shown (${tabIds()})`, JSON.stringify(tabIds()) === '["home","insert"]');
    el.showContextual('table');
    await settle();
    check(`showContextual adds the set's tabs after the normal ones (${tabIds()})`, JSON.stringify(tabIds()) === '["home","insert","td","tl"]');
    const set = sr.querySelector<HTMLElement>('.ribbon-ctx-set[data-set="table"]');
    check('inside a band by default, named, in its colour', !!set && set.classList.contains('style-band') && set.classList.contains('color-success')
      && set.querySelector('.ribbon-ctx-name')?.textContent === 'Table');
    check('the name is decoration; each tab carries it as its description',
      set?.querySelector('.ribbon-ctx-name')?.getAttribute('aria-hidden') === 'true'
      && [...set!.querySelectorAll('.ribbon-tab')].every((t) => t.getAttribute('aria-description') === 'Table'));
    const probe = document.createElement('span');
    probe.style.color = 'var(--b-color-success-text)';
    host.appendChild(probe);
    check(`the name uses the colour's text token (${getComputedStyle(set!.querySelector('.ribbon-ctx-name')!).color})`,
      getComputedStyle(set!.querySelector('.ribbon-ctx-name')!).color === getComputedStyle(probe).color);
    probe.remove();
    check('the band keeps the tab row its height', Math.abs(set!.getBoundingClientRect().height - sr.querySelector('.ribbon-tabs')!.getBoundingClientRect().height) < 1);
    check('isContextualShown reads it', el.isContextualShown('table') && !el.isContextualShown('picture'));

    // Styles: attribute, per-set override, fallback colour, text name.
    el.setAttribute('contextual-style', 'pill');
    await settle();
    check('contextual-style="pill" switches every set', !!sr.querySelector('.ribbon-ctx-set[data-set="table"].style-pill'));
    el.setAttribute('contextual-style', 'edge');
    await settle();
    check('contextual-style="edge" too', !!sr.querySelector('.ribbon-ctx-set[data-set="table"].style-edge'));
    el.setAttribute('contextual-style', 'bogus');
    await settle();
    check('an unknown style falls back to band', !!sr.querySelector('.ribbon-ctx-set[data-set="table"].style-band'));
    el.removeAttribute('contextual-style');
    el.showContextual('picture');
    await settle();
    const pic = sr.querySelector<HTMLElement>('.ribbon-ctx-set[data-set="picture"]');
    check('a set can override the style for itself', !!pic?.classList.contains('style-edge'));
    check('an unknown colour falls back to primary', !!pic?.classList.contains('color-primary'));
    check('the set name is text, never markup', !pic?.querySelector('img') && !(globalThis as { __ctxXss?: number }).__ctxXss
      && pic?.querySelector('.ribbon-tab')?.getAttribute('aria-description') === '<img src=x onerror="window.__ctxXss=1">');

    // Hiding: back to the previous normal tab, only when one of its tabs is open.
    sr.querySelector<HTMLElement>('#ribbon-tab-insert')!.click();
    await settle();
    sr.querySelector<HTMLElement>('#ribbon-tab-td')!.click();
    await settle();
    const before = events.length;
    el.hideContextual('table');
    await settle();
    check(`hiding the open set goes back to the previous normal tab (${el.getAttribute('active')}, ${events.slice(before)})`,
      el.getAttribute('active') === 'insert' && JSON.stringify(events.slice(before)) === '["insert"]');
    check(`and its tabs are gone (${tabIds()})`, !tabIds().includes('td'));
    const n = events.length;
    el.hideContextual('picture');
    await settle();
    check('hiding a set that is not open changes nothing and emits nothing', el.getAttribute('active') === 'insert' && events.length === n);
    el.showContextual('table', { select: true });
    await settle();
    check(`showContextual({ select: true }) opens its first tab (${el.getAttribute('active')})`, el.getAttribute('active') === 'td');

    // Arrow keys in the tab strip move through shown contextual tabs.
    const tablist = sr.querySelector<HTMLElement>('.ribbon-tabs')!;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    check(`ArrowRight moves from a contextual tab to the next (${el.getAttribute('active')})`, el.getAttribute('active') === 'tl');
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    check(`and wraps to the first tab (${el.getAttribute('active')})`, el.getAttribute('active') === 'home');

    // Mobile list follows what is shown.
    const mobileTabs = () => [...sr.querySelectorAll<HTMLElement>('.mobile-tab-header')].map((h) => h.dataset.mobileTab);
    check(`the mobile list shows the shown set's tabs (${mobileTabs()})`, JSON.stringify(mobileTabs()) === '["home","insert","td","tl"]');
    el.hideContextual('table');
    await settle();
    check(`and drops them when it hides (${mobileTabs()})`, JSON.stringify(mobileTabs()) === '["home","insert"]');
    el.remove();
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-contextual-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-contextual-smoke ${r}`);
})();
