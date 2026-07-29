// STORY-049 / TASK-097 ribbon-overflow smoke — asserts that an overflowing ribbon has a *visible*
// affordance for the commands you cannot see.
//
// The defect this guards: `.ribbon-panel-inner` was `overflow-x: auto` with `scrollbar-width: none`
// and no buttons, so overflowing groups were scrollable in theory and invisible in practice — a mouse
// without a horizontal wheel could not reach them. The tab strip had buttons but only re-evaluated
// them on `scroll` and on re-render, so narrowing the window left the arrow hidden while the tabs
// overflowed.
//
// `Birko.Web.Components` ships no unit runner, so the regression gate is a real browser via the
// playground's headless verify (verify.mjs surfaces `[playground]` console logs + page errors).
import 'birko-web-components/nav';

interface Item { id: string; label: string; icon?: string }
interface Group { id: string; label: string; items: Item[] }
interface Tab { id: string; label: string; groups: Group[] }

const group = (n: string): Group => ({
  id: n.toLowerCase(), label: n,
  items: [{ id: `${n}-a`, label: `${n} Alpha` }, { id: `${n}-b`, label: `${n} Beta` }],
});

/** Many tabs AND many groups — neither fits a narrow host. */
const CROWDED: Tab[] = [
  { id: 'home', label: 'Home', groups: ['Clipboard', 'Records', 'Layout', 'Styles', 'Review', 'Export'].map(group) },
  ...['Insert', 'Design', 'Transitions', 'Animations', 'SlideShow', 'View', 'Developer']
    .map((n) => ({ id: n.toLowerCase(), label: n, groups: [group(n)] })),
];

const ROOMY: Tab[] = [
  { id: 'home', label: 'Home', groups: [group('Clipboard')] },
  { id: 'view', label: 'View', groups: [group('Zoom')] },
];

type Ribbon = HTMLElement & { setTabs(t: Tab[]): void };

/** Mount a ribbon at an explicit width. On-screen layout is the point, so no display:none. */
async function mount(tabs: Tab[], width: number, expanded = true): Promise<Ribbon> {
  const el = document.createElement('b-ribbon') as Ribbon;
  el.style.width = `${width}px`;
  if (expanded) el.setAttribute('expanded', '');
  el.setAttribute('pinned', ''); // pinned = in-flow panel, so it has a real measured box
  document.body.appendChild(el);
  await settle();
  el.setTabs(tabs);
  await settle();
  return el;
}

/** Two frames + a tick: enough for render(), requestAnimationFrame(sync) and a ResizeObserver flush. */
function settle(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));
}

const visible = (el: Ribbon, sel: string): boolean =>
  !!el.shadowRoot?.querySelector(sel)?.classList.contains('visible');

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. Narrow: both tracks advertise their overflow ──
    {
      const el = await mount(CROWDED, 320);
      check('narrow ribbon shows the tab-strip forward chevron', visible(el, '#scroll-right'));
      check('narrow ribbon shows the PANEL forward chevron (the defect this task fixes)',
        visible(el, '#panel-scroll-right'));
      check('nothing is scrolled off to the left yet', !visible(el, '#scroll-left'));
      el.remove();
    }

    // ── 2. Wide: no chevrons, so they cost nothing in the common case ──
    {
      const el = await mount(ROOMY, 1600);
      check('wide ribbon hides the tab chevrons', !visible(el, '#scroll-right') && !visible(el, '#scroll-left'));
      check('wide ribbon hides the panel chevrons',
        !visible(el, '#panel-scroll-right') && !visible(el, '#panel-scroll-left'));
      el.remove();
    }

    // ── 3. Clicking a chevron actually scrolls the track ──
    {
      const el = await mount(CROWDED, 320);
      const track = el.shadowRoot!.querySelector('.ribbon-panel-inner') as HTMLElement;
      const before = track.scrollLeft;
      (el.shadowRoot!.querySelector('#panel-scroll-right') as HTMLElement).click();
      await settle();
      check('clicking the panel chevron scrolls the groups', track.scrollLeft > before);
      check('the back chevron appears once scrolled', visible(el, '#panel-scroll-left'));
      el.remove();
    }

    // ── 4. RESIZE ALONE reveals the chevrons — no scroll, no re-render, no reload ──
    // This is the specific bug: updateArrows ran on `scroll` and on render only, so a narrowing
    // window left the arrow hidden while the tabs overflowed.
    {
      const el = await mount(CROWDED, 1600);
      check('starts wide with the tab chevron hidden', !visible(el, '#scroll-right'));
      el.style.width = '320px'; // nothing else — no setTabs, no attribute change, no scroll
      await settle(120);
      check('narrowing alone reveals the tab chevron (ResizeObserver)', visible(el, '#scroll-right'));
      check('narrowing alone reveals the panel chevron', visible(el, '#panel-scroll-right'));
      el.remove();
    }

    // ── 5. Widening again retracts them (the affordance is not sticky) ──
    {
      const el = await mount(CROWDED, 320);
      check('narrow first', visible(el, '#scroll-right'));
      el.style.width = '1600px';
      await settle(120);
      check('widening alone hides the tab chevron again', !visible(el, '#scroll-right'));
      el.remove();
    }

    // ── 6. The scrollbar stays hidden — the chevrons are the affordance, on both tracks ──
    {
      const el = await mount(CROWDED, 320);
      const panel = el.shadowRoot!.querySelector('.ribbon-panel-inner') as HTMLElement;
      const tabs = el.shadowRoot!.querySelector('.ribbon-tabs') as HTMLElement;
      check('panel track is scrollable', panel.scrollWidth > panel.clientWidth);
      check('tab track is scrollable', tabs.scrollWidth > tabs.clientWidth);
      check('panel track has no visible scrollbar', getComputedStyle(panel).scrollbarWidth === 'none');
      el.remove();
    }

    // ── 7. The chevrons must survive a re-render without blinking out ──
    // Reported from the field on an UNPINNED ribbon: the right chevron flickers and is hard to click,
    // and the click lands on a tab instead. Mechanism: `visible` is applied imperatively, but
    // update() morphs synchronously and the template's `class` attribute overwrites it, so the button
    // goes display:none for a frame until requestAnimationFrame(sync) restores it. While it is hidden
    // the flex row reflows and a TAB slides under the cursor. Unpinned hover expand/collapse triggers
    // a re-render on every mouse move across the strip, so this fires constantly.
    {
      const el = await mount(CROWDED, 320, true);
      el.removeAttribute('pinned'); // the reported configuration
      await settle();
      check('unpinned: chevron visible before the re-render', visible(el, '#scroll-right'));

      // Synchronous check straight after an observed-attribute change — update() has already morphed,
      // and this is the exact frame in which the button used to vanish.
      el.setAttribute('active', 'design');
      check('tab chevron survives a re-render (no blank frame)', visible(el, '#scroll-right'));

      el.setAttribute('active', 'home');
      check('panel chevron survives a re-render (no blank frame)', visible(el, '#panel-scroll-right'));
      el.remove();
    }

    // ── 8. Chevrons carry an accessible name (they are the only route to hidden commands) ──
    {
      const el = await mount(CROWDED, 320);
      const named = ['#scroll-left', '#scroll-right', '#panel-scroll-left', '#panel-scroll-right']
        .every((s) => (el.shadowRoot!.querySelector(s)?.getAttribute('aria-label') ?? '').length > 0);
      check('all four chevrons have an aria-label', named);
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-overflow-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-overflow-smoke ${r}`);
})();
