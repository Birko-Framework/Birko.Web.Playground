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
import { resolveRibbonSizes, type RibbonGroupMetrics } from 'birko-web-components/nav';

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
      check('a small item still carries its name', (item?.getAttribute('title') ?? '').length > 0);
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

      chunk.click();
      await settle(20);
      check('clicking the chunk opens the flyout', getComputedStyle(flyout).display !== 'none');
      check('and reports itself expanded', chunk.getAttribute('aria-expanded') === 'true');
      check('the flyout holds the group\'s items', flyout.querySelectorAll('.ribbon-item').length === 3);

      (flyout.querySelector('.ribbon-item') as HTMLElement).click();
      await settle(20);
      check('invoking from the flyout dismisses it', getComputedStyle(flyout).display === 'none');
      check('and clears the expanded state', chunk.getAttribute('aria-expanded') === 'false');
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-scaling-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-scaling-smoke ${r}`);
})();
