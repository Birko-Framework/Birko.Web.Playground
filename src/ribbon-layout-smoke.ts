// TASK-730 (FEATURE-019 D1) — b-ribbon's groups are one height, their command rows line up, and each label sits
// under its group. Measured before: the Home tab's six groups were 97, 95, 94, 68, 71 and 97px tall, so the
// separators (each group's border-left) ended at different heights, and rows drifted with icon sizes.
// Checked at a wide width (medium groups), a middle one (some small) and a narrow one (folded groups).
import 'birko-web-components/nav';

interface Item { id: string; label: string; icon?: string }
interface Group { id: string; label: string; items: Item[]; scalingPriority?: number; icon?: string }
type Ribbon = HTMLElement & { setTabs(t: { id: string; label: string; groups: Group[] }[]): void };

const settle = (ms = 80) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));

// Uneven on purpose: 3, 3, 3, 2, 2 and 3 commands, mixed icon glyphs — the shape that showed the defect.
const GROUPS: Group[] = [
  { id: 'clip', icon: '📋', label: 'Clipboard', scalingPriority: 3, items: [{ id: 'p', label: 'Paste', icon: '📋' }, { id: 'x', label: 'Cut', icon: '✂️' }, { id: 'c', label: 'Copy', icon: '📄' }] },
  { id: 'rec', icon: '🗂', label: 'Records', items: [{ id: 'n', label: 'New', icon: '➕' }, { id: 'd', label: 'Delete', icon: '🗑' }, { id: 'u', label: 'Duplicate', icon: '⧉' }] },
  { id: 'font', icon: '🔤', label: 'Font', items: [{ id: 'b', label: 'Bold', icon: 'B' }, { id: 'i', label: 'Italic', icon: 'I' }, { id: 'o', label: 'Colour', icon: '🎨' }] },
  { id: 'lay', icon: '▦', label: 'Layout', items: [{ id: 'cols', label: 'Columns', icon: '▥' }, { id: 'rows', label: 'Rows', icon: '▤' }] },
  { id: 'rev', icon: '💬', label: 'Review', items: [{ id: 'cm', label: 'Comment', icon: '💬' }, { id: 'tr', label: 'Track', icon: '✓' }] },
  { id: 'exp', icon: '📤', label: 'Export', items: [{ id: 'pdf', label: 'PDF', icon: '📄' }, { id: 'csv', label: 'CSV', icon: '📊' }, { id: 'pr', label: 'Print', icon: '🖨' }] },
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(host);

  try {
    for (const width of [1100, 520, 260]) {
      const el = document.createElement('b-ribbon') as Ribbon;
      el.style.width = `${width}px`;
      el.setAttribute('expanded', '');
      el.setAttribute('pinned', '');
      host.appendChild(el);
      await settle(20);
      el.setTabs([{ id: 'home', label: 'Home', groups: GROUPS }]);
      await settle(160);
      const sr = el.shadowRoot!;
      const groups = [...sr.querySelectorAll<HTMLElement>('.ribbon-panel-inner > .ribbon-group')];
      const sizes = groups.map((g) => [...g.classList].find((c) => c.startsWith('size-'))?.slice(5) ?? '?');
      const tag = `${width}px [${sizes.join(',')}]`;
      const heights = groups.map((g) => Math.round(g.getBoundingClientRect().height));
      check(`${tag}: every group has one height (${heights.join(',')})`, heights.length === 6 && new Set(heights).size === 1);

      const labelled = groups.filter((g) => g.querySelector(':scope > .ribbon-group-label'));
      const labelTops = labelled.map((g) => Math.round(g.querySelector(':scope > .ribbon-group-label')!.getBoundingClientRect().top));
      check(`${tag}: labels share one line (${labelTops.join(',')})`, new Set(labelTops).size <= 1);
      check(`${tag}: each label is below its commands`, labelled.every((g) => {
        const label = g.querySelector(':scope > .ribbon-group-label')!.getBoundingClientRect();
        return [...g.querySelectorAll(':scope > .ribbon-group-items > .ribbon-item')].every((i) => i.getBoundingClientRect().bottom <= label.top + 1);
      }));

      // Rows: the n-th command of a column sits on the same line in every three-row group. Within 1px, since an
      // item is centred in its row and glyphs differ by a pixel.
      const rowed = groups.filter((g) => g.classList.contains('size-medium') || g.classList.contains('size-small'));
      if (rowed.length) {
        const rowTops = [0, 1, 2].map((n) => rowed
          .map((g) => g.querySelectorAll<HTMLElement>(':scope > .ribbon-group-items > .ribbon-item')[n])
          .filter(Boolean).map((i) => Math.round(i.getBoundingClientRect().top)));
        const spread = rowTops.map((tops) => tops.length ? Math.max(...tops) - Math.min(...tops) : 0);
        check(`${tag}: rows line up across groups (spread ${spread.join(',')}px)`, spread.every((s) => s <= 1));
      }

      const popups = groups.filter((g) => g.classList.contains('size-popup'));
      if (popups.length) {
        const fills = popups.map((g) => Math.round(g.querySelector<HTMLElement>('.ribbon-chunk')!.getBoundingClientRect().height) === Math.round(g.getBoundingClientRect().height));
        check(`${tag}: a folded group is one full-height button`, fills.every(Boolean));
      }

      const label = sr.querySelector<HTMLElement>('.ribbon-group-label');
      if (label) check(`${tag}: the label is first in the markup (read before the commands)`, label === label.parentElement!.firstElementChild);
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-layout-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-layout-smoke ${r}`);
})();
