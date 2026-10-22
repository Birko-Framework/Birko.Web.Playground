// TASK-739 (FEATURE-019 D10) — b-ribbon toggle buttons and one-of sets: ARIA state, a click flips it and reports
// `pressed`, a set keeps exactly one on, setPressed() is silent, the state survives a re-render and lives in the
// ribbon (the caller's objects are never written), and the mobile list toggles too.
import 'birko-web-components/nav';
import type { RibbonGroup } from 'birko-web-components';

type Ribbon = HTMLElement & {
  setTabs(t: { id: string; label: string; groups: RibbonGroup[] }[]): void;
  setPressed(id: string, pressed: boolean, tabId?: string): void;
  isPressed(id: string, tabId?: string): boolean;
};
const settle = (ms = 80) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));

const groups = (): RibbonGroup[] => [
  { id: 'font', label: 'Font', items: [
    { id: 'bold', label: 'Bold', icon: 'B', toggle: true, pressed: true },
    { id: 'italic', label: 'Italic', icon: 'I', toggle: true },
    { id: 'strike', label: 'Strike', icon: 'S', toggle: true, disabled: true },
  ] },
  { id: 'align', label: 'Alignment', items: [
    { id: 'left', label: 'Left', icon: '⯇', toggleGroup: 'al', pressed: true },
    { id: 'centre', label: 'Centre', icon: '≡', toggleGroup: 'al' },
    { id: 'right', label: 'Right', icon: '⯈', toggleGroup: 'al' },
  ] },
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(host);

  try {
    const data = groups();
    const el = document.createElement('b-ribbon') as Ribbon;
    el.style.width = '900px';
    el.setAttribute('expanded', '');
    el.setAttribute('pinned', '');
    host.appendChild(el);
    await settle(20);
    el.setTabs([{ id: 'home', label: 'Home', groups: data }]);
    await settle(160);
    const sr = el.shadowRoot!;
    const btn = (id: string) => sr.querySelector<HTMLElement>(`.ribbon-panel-inner .ribbon-item[data-item="${id}"]`)!;
    const clicks: Record<string, unknown>[] = [];
    el.addEventListener('item-click', (e) => clicks.push((e as CustomEvent).detail));

    // ── 1. ARIA ──
    check('a toggle is a button with aria-pressed from its data', btn('bold').getAttribute('aria-pressed') === 'true' && btn('italic').getAttribute('aria-pressed') === 'false');
    const rg = sr.querySelector<HTMLElement>('.ribbon-radiogroup');
    check(`a set is a radiogroup named after its group (${rg?.getAttribute('aria-label')})`, rg?.getAttribute('role') === 'radiogroup' && rg.getAttribute('aria-label') === 'Alignment');
    check('its members are radios with aria-checked', ['left', 'centre', 'right'].every((id) => btn(id).getAttribute('role') === 'radio')
      && btn('left').getAttribute('aria-checked') === 'true' && btn('centre').getAttribute('aria-checked') === 'false');
    check('the set keeps its grid cells (display: contents)', getComputedStyle(rg!).display === 'contents');
    const stops = [...sr.querySelectorAll<HTMLElement>('.ribbon-panel-inner .ribbon-item')].filter((s) => s.tabIndex === 0 || s.tabIndex === -1);
    check('set members are keyboard stops', ['left', 'centre', 'right'].every((id) => stops.includes(btn(id))));
    check('the pressed look differs from the plain one', getComputedStyle(btn('bold')).boxShadow !== getComputedStyle(btn('italic')).boxShadow);

    // ── 2. Clicks ──
    btn('italic').click();
    check(`a click turns a toggle on and reports it (${JSON.stringify(clicks.at(-1))})`, btn('italic').getAttribute('aria-pressed') === 'true' && (clicks.at(-1) as { pressed?: boolean })?.pressed === true);
    btn('italic').click();
    check('a second click turns it off', btn('italic').getAttribute('aria-pressed') === 'false' && (clicks.at(-1) as { pressed?: boolean })?.pressed === false);
    const n = clicks.length;
    btn('strike').click();
    check('a disabled toggle neither flips nor reports', btn('strike').getAttribute('aria-pressed') === 'false' && clicks.length === n);
    btn('centre').click();
    check('pressing a set member turns the others off', btn('centre').getAttribute('aria-checked') === 'true' && btn('left').getAttribute('aria-checked') === 'false'
      && (clicks.at(-1) as { pressed?: boolean })?.pressed === true);
    btn('centre').click();
    check('pressing the one that is on keeps it on', btn('centre').getAttribute('aria-checked') === 'true');
    check('the caller\'s objects are not written to', data[0].items[1].pressed === undefined && data[1].items[0].pressed === true);

    // ── 3. setPressed / isPressed ──
    const m = clicks.length;
    el.setPressed('bold', false);
    check('setPressed changes the state without an event', btn('bold').getAttribute('aria-pressed') === 'false' && clicks.length === m);
    el.setPressed('right', true);
    check('setPressed in a set releases the others', btn('right').getAttribute('aria-checked') === 'true' && btn('centre').getAttribute('aria-checked') === 'false');
    check('isPressed reads it', el.isPressed('right') && !el.isPressed('bold'));

    // ── 4. Re-render and new data ──
    el.style.width = '360px';
    await settle(200);
    const sizes = [...sr.querySelectorAll('.ribbon-panel-inner > .ribbon-group')].map((g) => [...g.classList].find((c) => c.startsWith('size-')));
    const right = sr.querySelector<HTMLElement>('.ribbon-item[data-item="right"]');
    check(`the state survives a scaling re-render (${sizes.join(',')}: ${right?.getAttribute('aria-checked')})`, right?.getAttribute('aria-checked') === 'true');
    el.style.width = '900px';
    await settle(200);
    el.setTabs([{ id: 'home', label: 'Home', groups: groups() }]);
    await settle(160);
    check('setTabs with new data takes its pressed values', btn('bold').getAttribute('aria-pressed') === 'true' && btn('left').getAttribute('aria-checked') === 'true' && !el.isPressed('right'));

    // ── 5. Mobile list ──
    const mob = sr.querySelector<HTMLElement>('.mobile-item[data-item="italic"]');
    check('a mobile toggle carries its state', mob?.getAttribute('aria-pressed') === 'false');
    mob?.click();
    check('and flips it', el.isPressed('italic') && mob?.getAttribute('aria-pressed') === 'true' && btn('italic').getAttribute('aria-pressed') === 'true');
    el.remove();
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-toggle-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-toggle-smoke ${r}`);
})();
