// TASK-725 follow-up — a component's .sr-only text is position: absolute, so without a positioned ancestor inside the
// component its containing block lies OUTSIDE any scroll container the page puts it in. It then neither scrolls nor
// clips with that container, and it stretches the document instead: a FinStat tester page in BAppShell's scrolling
// main got a second, window-level scrollbar from b-json-diff (document 1524px tall in a 609px window).
//
// Measured behaviour, not the style: each .sr-only must move by exactly the container's scroll. The outer host is
// position: fixed on purpose — it is a positioned ancestor outside the scroller, so a component that provides no
// containing block of its own fails here as it does in an app shell.
import type { BJsonDiff, BTabs } from 'birko-web-components';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const tick = () => new Promise((r) => setTimeout(r, 30));

  const cases: [string, (el: HTMLElement) => void][] = [
    ['b-json-diff', (el) => (el as BJsonDiff).setData({ a: 1, b: { c: 2 } }, { a: 2, b: { c: 3 }, n: 1 })],
    ['b-tabs', (el) => (el as BTabs).setTabs([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }])],
    ['b-carousel', (el) => { el.innerHTML = '<div>1</div><div>2</div>'; }],
    // b-kanban, b-qty-stepper, b-rating and b-gallery fail this check today but measured no document growth, even with
    // text in their live regions: TASK-726 owns them. Add each here when it is fixed.
  ];

  try {
    for (const [tag, setup] of cases) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:600px;opacity:0;pointer-events:none;';
      const scroller = document.createElement('div');
      scroller.style.cssText = 'height:200px;overflow-y:auto;';
      scroller.innerHTML = `<div style="height:400px"></div><${tag}></${tag}>`;
      host.appendChild(scroller);
      document.body.appendChild(host);
      await tick();
      const el = scroller.querySelector<HTMLElement>(tag)!;
      setup(el);
      await tick();
      const hidden = [...(el.shadowRoot?.querySelectorAll<HTMLElement>('.sr-only') ?? [])];
      if (hidden.length === 0) {
        check(`${tag}: renders an .sr-only to measure`, false);
        host.remove();
        continue;
      }
      const before = hidden.map((h) => h.getBoundingClientRect().top);
      scroller.scrollTop = 150;
      const moved = scroller.scrollTop;
      const after = hidden.map((h) => h.getBoundingClientRect().top);
      const shifts = after.map((t, i) => Math.round(before[i] - t));
      check(`${tag}: ${hidden.length} .sr-only scroll with their container (scrolled ${moved}, moved ${shifts.join(',')})`,
        moved > 0 && shifts.every((s) => s === moved));
      host.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] sr-only-contain-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] sr-only-contain-smoke ${r}`);
})();
