// STORY-049 / TASK-099 — the ribbon's progressive-scaling POLICY, plus the rendered result.
//
// The first half is a **parity table**: the same cases, numbers and expectations as
// `Birko.Xaml.Core.Tests/RibbonScalingTests.cs`. The rendering is necessarily forked (CSS vs AXAML) but
// the policy must not be — which group gives way, how far, and when is exactly what a user would notice
// differing between the desktop and web skins of the same ribbon. Keeping the tables identical means a
// change made on one side and not the other fails here instead of drifting silently.
//
// (Stronger option, not built: have the C# suite emit this table as a JSON fixture that this smoke
// consumes, so the two cannot even be edited apart. Worth doing if the policy grows.)
import 'birko-web-components/nav';
import { resolveRibbonSizes, ribbonItemSizes, type RibbonGroupMetrics, type RibbonGroup, type RibbonGroupSize, type RibbonItemSize } from 'birko-web-components/nav';

/** Mirrors the C# helper `G(...)`: variants cost 100 / 60 / 30 / 10. */
const G = (
  priority = 0,
  minSize: 'large' | 'medium' | 'small' | 'popup' = 'popup',
  large = 100, medium = 60, small = 30, popup = 10,
): RibbonGroupMetrics => ({
  scalingPriority: priority,
  minSize,
  widths: { large, medium, small, popup },
});

interface Item { id: string; label: string; icon?: string }
interface Group { id: string; label: string; items: Item[]; scalingPriority?: number; icon?: string }
type Ribbon = HTMLElement & { setTabs(t: { id: string; label: string; groups: Group[] }[]): void };

const items = (n: string): Item[] =>
  [1, 2, 3].map((i) => ({ id: `${n}${i}`, label: `${n} Item ${i}`, icon: '●' }));

function settle(ms = 80): Promise<void> {
  return new Promise((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));
}

async function mountRibbon(groups: Group[], width: number, preferred?: string): Promise<Ribbon> {
  const el = document.createElement('b-ribbon') as Ribbon;
  el.style.width = `${width}px`;
  el.setAttribute('expanded', '');
  el.setAttribute('pinned', '');
  if (preferred) el.setAttribute('preferred-group-size', preferred);
  document.body.appendChild(el);
  await settle(20);
  el.setTabs([{ id: 'home', label: 'Home', groups }]);
  await settle(140);
  return el;
}

const sizesOf = (el: Ribbon): string[] =>
  Array.from(el.shadowRoot!.querySelectorAll('.ribbon-group'))
    .map((g) => (Array.from(g.classList).find((c) => c.startsWith('size-')) ?? '').replace('size-', ''));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, actual: unknown, expected: unknown) =>
    check(`${name} (got ${JSON.stringify(actual)})`, JSON.stringify(actual) === JSON.stringify(expected));

  try {
    // ── Item sizes: parity with RibbonItemSizingTests.cs (TASK-120, FEATURE-015 D13 / D14) ──
    {
      const item = (id: string, size?: RibbonItemSize) => ({ id, label: id, ...(size ? { size } : {}) });
      const plain = { label: 'Plain', items: [item('a'), item('b'), item('c')] };
      const clipboard = (layouts?: RibbonGroup['layouts']) =>
        ({ label: 'Clipboard', items: [item('paste', 'large'), item('cut'), item('copy'), item('format')], layouts });
      const sizes = (g: Parameters<typeof ribbonItemSizes>[0], step: RibbonGroupSize, start: RibbonGroupSize = 'medium') =>
        ribbonItemSizes(g, step, start).map((s) => s[0].toUpperCase()).join(',');
      const throws = (f: () => unknown, pattern: RegExp) => { try { f(); return false; } catch (e) { return pattern.test((e as Error).message); } };

      for (const [step, expected] of [['large', 'L,L,L'], ['medium', 'M,M,M'], ['small', 'S,S,S'], ['popup', 'L,L,L']] as const)
        eq(`item sizes: no item sizes, ${step} renders every item at the step`, sizes(plain, step), expected);
      for (const [step, expected] of [['large', 'L,L,L,L'], ['medium', 'L,M,M,M'], ['small', 'M,S,S,S'], ['popup', 'L,L,L,L']] as const)
        eq(`item sizes: anchored Paste keeps its offset at ${step}`, sizes(clipboard(), step), expected);
      for (const [step, expected] of [['large', 'M'], ['medium', 'S'], ['small', 'S']] as const)
        eq(`item sizes: a smaller anchor clamps at small (${step})`, sizes({ label: 'G', items: [item('x', 'small')] }, step), expected);
      const officeSmall = clipboard({ small: { paste: 'large' } });
      for (const [step, expected] of [['large', 'L,L,L,L'], ['medium', 'L,M,M,M'], ['small', 'L,S,S,S']] as const)
        eq(`item sizes: a declared layout overrides the anchor (${step})`, sizes(officeSmall, step), expected);
      eq('item sizes: the offset is from the starting step (start large, step large)', sizes(clipboard(), 'large', 'large'), 'L,L,L,L');
      eq('item sizes: the offset is from the starting step (start large, step medium)', sizes(clipboard(), 'medium', 'large'), 'M,M,M,M');
      check('item sizes: an item sized popup is refused',
        throws(() => sizes({ label: 'G', items: [{ id: 'x', label: 'x', size: 'popup' as RibbonItemSize }] }, 'medium'), /'x'.*cannot be popup/));
      check('item sizes: a layout for the popup step is refused',
        throws(() => sizes(clipboard({ popup: { paste: 'large' } } as RibbonGroup['layouts']), 'medium'), /layout for popup/));
      check('item sizes: a layout naming an unknown item is refused',
        throws(() => sizes(clipboard({ small: { pastee: 'large' } }), 'small'), /'pastee'.*not one of its items/));
      check('item sizes: a layout size of popup is refused',
        throws(() => sizes(clipboard({ small: { paste: 'popup' as RibbonItemSize } }), 'small'), /'paste' as popup/));
      check('item sizes: a popup starting step is refused', throws(() => sizes(clipboard(), 'medium', 'popup'), /starting step cannot be popup/));
      // TASK-121: layouts never get roomier at a tighter step.
      check('item sizes: a layout making an item roomier at a tighter step is refused',
        throws(() => sizes(clipboard({ small: { cut: 'large' } }), 'medium'), /'cut' is large, medium, large.*same or get smaller/));
    }

    // ── TASK-121: the ladder over mixed groups — parity with RibbonItemSizingTests.cs ──
    {
      // The Clipboard group's widths as measured from its resolved layouts (start medium).
      const mixed = (scalingPriority = 0, minSize: RibbonGroupSize = 'popup'): RibbonGroupMetrics =>
        ({ widths: { large: 200, medium: 140, small: 90, popup: 40 }, scalingPriority, minSize });
      const uniform = (scalingPriority = 0): RibbonGroupMetrics =>
        ({ widths: { large: 100, medium: 60, small: 30, popup: 10 }, scalingPriority });
      const row = () => [mixed(10), uniform(0)];
      for (const [available, expected] of [
        [400, 'medium,medium'], [200, 'medium,medium'], [199, 'medium,small'], [170, 'medium,small'], [169, 'medium,popup'],
        [150, 'medium,popup'], [149, 'small,popup'], [100, 'small,popup'], [99, 'popup,popup'],
      ] as const)
        eq(`mixed ladder: ${available}px`, resolveRibbonSizes(row(), available).join(','), expected);
      const first = resolveRibbonSizes(row(), 160).join(',');
      resolveRibbonSizes(row(), 1000); resolveRibbonSizes(row(), 1);
      eq('mixed ladder: a pure function whatever ran before', resolveRibbonSizes(row(), 160).join(','), first);
      const up = new Map<number, string>();
      for (let w = 60; w <= 260; w++) up.set(w, resolveRibbonSizes(row(), w).join(','));
      let sweep = 'same';
      for (let w = 260; w >= 60; w--) if (resolveRibbonSizes(row(), w).join(',') !== up.get(w)) { sweep = `differs at ${w}px`; break; }
      eq('mixed ladder: a boundary sweep resolves the same in both directions', sweep, 'same');
      const floored = () => [mixed(0, 'small'), uniform(10)];
      eq('mixed ladder: a floor holds while another group can still give (100px)', resolveRibbonSizes(floored(), 100).join(','), 'small,popup');
      eq('mixed ladder: then gives way rather than overflowing (99px)', resolveRibbonSizes(floored(), 99).join(','), 'popup,popup');
    }

    // ── Policy parity with RibbonScalingTests.cs ──────────────────────────────
    eq('everything stays at preferred when it fits',
      resolveRibbonSizes([G(), G(), G()], 1000, 'large'), ['large', 'large', 'large']);

    eq('medium is the default preferred variant',
      resolveRibbonSizes([G()], 1000), ['medium']);

    eq('the least important group degrades first',
      resolveRibbonSizes([G(10), G(0)], 160, 'large'), ['large', 'medium']);

    eq('a low-priority group bottoms out before a high-priority one gives anything',
      resolveRibbonSizes([G(10), G(0)], 135, 'large'), ['large', 'small']);

    eq('a floor is honoured even when it forces another group lower',
      resolveRibbonSizes([G(0, 'medium'), G(5)], 95, 'large'), ['medium', 'small']);

    eq('a floor tighter than preferred does not make a group roomier',
      resolveRibbonSizes([G(0, 'popup')], 10_000, 'small'), ['small']);

    eq('widening promotes back up',
      resolveRibbonSizes([G(), G()], 1000, 'large'), ['large', 'large']);

    // Floors are soft: reachability beats legibility when they conflict.
    eq('a floor gives way rather than letting the row overflow',
      resolveRibbonSizes([G(100, 'small'), G(0)], 25, 'large'), ['popup', 'popup']);

    eq('a floor is still honoured whenever the row can fit without breaking it',
      resolveRibbonSizes([G(100, 'small'), G(0)], 45, 'large'), ['small', 'popup']);

    eq('it gives up rather than looping when nothing can degrade further',
      resolveRibbonSizes([G(), G()], 1, 'large'), ['popup', 'popup']);

    eq('gaps count towards the budget — no gap',
      resolveRibbonSizes([G(), G()], 130, 'medium', 0), ['medium', 'medium']);
    check('gaps count towards the budget — 20px gap forces a step',
      resolveRibbonSizes([G(), G()], 130, 'medium', 20).includes('small'));

    eq('an unmeasured variant is costed as the nearest roomier one',
      resolveRibbonSizes([{ widths: { large: 100 } }], 50, 'large'), ['popup']);

    eq('an empty row resolves to nothing', resolveRibbonSizes([], 100), []);

    // Determinism: the same width, reached from both directions, must resolve identically.
    {
      const groups = [G(2), G(1), G(0)];
      let stable = true;
      for (let w = 60; w <= 320; w += 10) {
        const a = resolveRibbonSizes(groups, w, 'large').join(',');
        const b = resolveRibbonSizes(groups, w, 'large').join(',');
        if (a !== b) stable = false;
      }
      check('the policy is a pure function of width', stable);
    }

    // ── The rendered result ───────────────────────────────────────────────────
    const G3 = (name: string, priority: number): Group =>
      ({ id: name.toLowerCase(), label: name, icon: '▦', scalingPriority: priority, items: items(name) });

    {
      const el = await mountRibbon([G3('Clipboard', 10), G3('Export', 0)], 1400);
      eq('wide: both groups render at medium by default', sizesOf(el), ['medium', 'medium']);
      el.remove();
    }

    {
      const el = await mountRibbon([G3('Clipboard', 10), G3('Export', 0)], 1400, 'large');
      eq('large is available as an opt-in', sizesOf(el), ['large', 'large']);
      el.remove();
    }

    {
      const el = await mountRibbon(
        ['Clipboard', 'Records', 'Layout', 'Styles', 'Review', 'Export'].map((n, i) => G3(n, 10 - i)),
        360);
      const sizes = sizesOf(el);
      check(`narrow: not everything stays at medium (got ${JSON.stringify(sizes)})`,
        sizes.some((s) => s !== 'medium'));
      check('narrow: the least important group is no roomier than the most important',
        ['large', 'medium', 'small', 'popup'].indexOf(sizes[sizes.length - 1])
        >= ['large', 'medium', 'small', 'popup'].indexOf(sizes[0]));
      el.remove();
    }

    // Small keeps the command nameable even though the label is not drawn.
    {
      const el = await mountRibbon([G3('Clipboard', 0)], 1400, 'small');
      eq('small can be requested outright', sizesOf(el), ['small']);
      const item = el.shadowRoot!.querySelector('.ribbon-group.size-small .ribbon-item') as HTMLElement;
      // Its name is aria-label (and the tooltip's heading, TASK-738), no longer a native title.
      check('a small item still carries its name', (item?.getAttribute('aria-label') ?? '').length > 0);
      const labelSpan = item?.querySelector('.ribbon-item-label') as HTMLElement | null;
      check('a small item does not draw its label',
        !!labelSpan && getComputedStyle(labelSpan).display === 'none');
      el.remove();
    }

    // Popup: the chunk button, its flyout, and dismissal on invoke.
    {
      const el = await mountRibbon([G3('Clipboard', 0)], 1400, 'popup');
      eq('popup can be requested outright', sizesOf(el), ['popup']);

      const chunk = el.shadowRoot!.querySelector('.ribbon-chunk') as HTMLElement;
      check('the collapsed group renders one chunk button', !!chunk);
      check('the chunk button is expandable and named',
        chunk?.getAttribute('aria-haspopup') === 'true'
        && chunk?.getAttribute('aria-expanded') === 'false'
        && (chunk?.getAttribute('aria-label') ?? '').length > 0);

      const flyout = el.shadowRoot!.querySelector('.ribbon-flyout') as HTMLElement;
      check('the flyout is closed to begin with', getComputedStyle(flyout).display === 'none');

      // The flyout MUST be a popover. Reported from the playground: it was cut off on the right and the
      // bottom, because it was position:absolute inside two overflow:hidden ancestors -- .ribbon-panel (for
      // its max-height collapse) and .ribbon-panel-inner (which became overflow:hidden when the scroller was
      // removed). An absolutely-positioned element cannot escape an overflow:hidden ancestor; the top layer
      // can. Asserted structurally on purpose: clipping does not change getBoundingClientRect, so no
      // rect-based check could ever have caught this.
      check('the flyout is a popover, so no overflow:hidden ancestor can clip it',
        flyout.hasAttribute('popover'));
      const panelInner = el.shadowRoot!.querySelector('.ribbon-panel-inner') as HTMLElement;
      check('and the ancestor that would have clipped it still does clip, so that matters',
        getComputedStyle(panelInner).overflow === 'hidden');

      // Another suite's modal (gallery-smoke's zoom) closes every popover in the page, and another suite's auto popover
      // closes this one as it opens: the checks below failed about one run in three. Wait for no modal, and retry
      // while the flyout did not stay open.
      const modalOpen = () => {
        const walk = (root: Document | ShadowRoot): boolean => [...root.querySelectorAll('*')].some((n) => n.matches('dialog:modal') || (!!n.shadowRoot && walk(n.shadowRoot)));
        return walk(document);
      };
      for (let attempt = 0; attempt < 4; attempt++) {
        for (let i = 0; i < 200 && modalOpen(); i++) await settle(25);
        if (!flyout.matches(':popover-open')) chunk.click();
        await settle(20);
        if (flyout.matches(':popover-open')) break;
      }
      check('clicking the chunk opens the flyout', getComputedStyle(flyout).display !== 'none');
      check('and it is in the top layer while open', flyout.matches(':popover-open'));
      check('and reports itself expanded', chunk.getAttribute('aria-expanded') === 'true');
      check('the flyout holds the group\'s items', flyout.querySelectorAll('.ribbon-item').length === 3);

      (flyout.querySelector('.ribbon-item') as HTMLElement).click();
      await settle(20);
      check('invoking from the flyout dismisses it', getComputedStyle(flyout).display === 'none');
      check('and clears the expanded state', chunk.getAttribute('aria-expanded') === 'false');
      el.remove();
    }
    // At the extreme the chunk buttons drop their group names, so the row fits widths a labelled row
    // cannot. The name stays in title/aria-label, so nothing becomes anonymous.
    {
      const groups = ['Clipboard', 'Records', 'Layout', 'Styles', 'Review', 'Export'].map((n, i) => G3(n, 10 - i));
      const el = await mountRibbon(groups, 240);
      const chunk = el.shadowRoot!.querySelector('.ribbon-group.size-popup .ribbon-chunk') as HTMLElement;
      const name = chunk?.querySelector('.ribbon-chunk-name') as HTMLElement | null;

      eq('every group collapsed at 240px', sizesOf(el), ['popup', 'popup', 'popup', 'popup', 'popup', 'popup']);
      check('the chunk row went compact', !!el.shadowRoot!.querySelector('.ribbon-group.size-popup.compact'));
      check('the group name is not drawn on the chunk face',
        !!name && getComputedStyle(name).display === 'none');
      check('but the chunk still carries the name',
        (chunk?.getAttribute('aria-label') ?? '').length > 0);

      const track = el.shadowRoot!.querySelector('.ribbon-panel-inner') as HTMLElement;
      check(`and the row fits, so no group is clipped (${track.scrollWidth} <= ${track.clientWidth})`,
        track.scrollWidth <= track.clientWidth + 1);
      el.remove();
    }
    // Hover-previewing a tab must re-scale for THAT tab. Reported from the playground: toggling pinned and
    // hovering Home showed the panel sometimes narrowed and sometimes not, with groups missing -- because
    // _showTabContent re-rendered using the previous tab's decisions and never re-measured, and the panel is
    // overflow:hidden, so anything that did not fit was silently clipped.
    {
      const dense = ['Clipboard', 'Records', 'Layout', 'Styles', 'Review', 'Export'].map((n, i) => G3(n, 10 - i));
      const el = document.createElement('b-ribbon') as Ribbon;
      el.style.width = '420px';
      el.setAttribute('expanded', '');
      el.setAttribute('pinned', '');
      document.body.appendChild(el);
      await settle(20);
      el.setTabs([
        { id: 'sparse', label: 'Sparse', groups: [G3('Solo', 0)] },
        { id: 'dense', label: 'Dense', groups: dense },
      ]);
      await settle(140);

      eq('the one-group tab needs no degrading at 420px', sizesOf(el), ['medium']);

      // Preview the dense tab the way a hover does.
      const denseTab = el.shadowRoot!.querySelector('[data-tab="dense"]') as HTMLElement;
      denseTab.dispatchEvent(new MouseEvent('mouseenter'));
      await settle(180);

      const sizes = sizesOf(el);
      check(`previewing the dense tab re-scales for it (got ${JSON.stringify(sizes)})`,
        sizes.length === 6 && sizes.some((s) => s !== 'medium'));

      const track = el.shadowRoot!.querySelector('.ribbon-panel-inner') as HTMLElement;
      check(`and its groups are not clipped (${track.scrollWidth} <= ${track.clientWidth})`,
        track.scrollWidth <= track.clientWidth + 1);
      el.remove();
    }
    // The rendered result must SETTLE. Reported from the playground: toggling pinned and hovering Home
    // narrowed the panel on some renders and not others. Cause: the probe rendered through _renderGroup,
    // which read this._compactChunks, so an already-compact row measured compact chunks and a labelled row
    // measured labelled ones -- the decision became a function of the applied layout and flipped every pass.
    // Asserted by letting several measure passes run and requiring the outcome to stop changing.
    {
      const dense = ['Clipboard', 'Records', 'Layout', 'Styles', 'Review', 'Export'].map((n, i) => G3(n, 10 - i));
      const el = await mountRibbon(dense, 300);

      const snapshot = () => `${sizesOf(el).join(',')}|${!!el.shadowRoot!.querySelector('.compact')}`;
      const first = snapshot();
      for (let i = 0; i < 4; i++) await settle(60);
      const after = snapshot();

      check(`the layout settles instead of oscillating (${first} -> ${after})`, first === after);
      const track = el.shadowRoot!.querySelector('.ribbon-panel-inner') as HTMLElement;
      check(`and the settled row is not clipped (${track.scrollWidth} <= ${track.clientWidth})`,
        track.scrollWidth <= track.clientWidth + 1);
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  // gallery-smoke opens a modal (which light-dismisses popovers and makes the page inert); it waits for this.
  (window as unknown as { __ribbonScalingSmokeDone?: boolean }).__ribbonScalingSmokeDone = true;
  console.log(`[playground] ribbon-scaling-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-scaling-smoke ${r}`);
})();
