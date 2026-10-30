// Birko TASK-789 — b-tree-menu's sortable mode, everything an in-page event can drive: the grip per node, keyboard
// pick-up / move / reparent / drop, Escape, Tab away, the announcements, one `reorder` per move with today's detail
// shape, the consumer's arrays left alone, the deprecated ▲ / ▼ behind `sortControls`, `handleOnly`, and no listener
// growth across re-renders. A pointer drag needs trusted input, so it is in sortable-drag-check.mjs.
import 'birko-web-components/nav';
import type { BTreeMenu, TreeMenuItem, TreeReorderDetail } from 'birko-web-components';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));
const deepActive = (): Element | null => {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};

const ITEMS = (): TreeMenuItem[] => [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo', expanded: true, children: [{ id: 'b1', label: 'Bravo one' }, { id: 'b2', label: 'Bravo two' }] },
  { id: 'c', label: 'Charlie' },
  { id: 'd', label: 'Delta' },
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // Focus is asserted here, and an open modal elsewhere makes the page inert; run after the suites that open one.
  {
    const flags = ['__gallerySmokeDone', '__modalFocusSmokeDone', '__toastModalSmokeDone', '__undoDeleteSmokeDone', '__sortableSmokeDone', '__bulkBarSmokeDone'];
    const w = window as unknown as Record<string, boolean | undefined> & { __smokeSuites?: string[] };
    const owner = (f: string) => f.replace(/^__/, '').replace(/Done$/, '').replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const pending = () => flags.filter((f) => w[f] !== true && (w.__smokeSuites ?? []).includes(owner(f)));
    const deadline = Date.now() + 180_000;
    while (pending().length && Date.now() < deadline) await sleep(50);
    check(`the suites that open modals finished first (still running: ${pending().join(', ') || 'none'})`, pending().length === 0);
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:480px;z-index:99990;background:var(--b-bg)';
  document.body.append(host);

  const mount = async (extra: Partial<Parameters<BTreeMenu['setConfig']>[0]> = {}) => {
    host.innerHTML = '<b-tree-menu></b-tree-menu>';
    const tree = host.querySelector('b-tree-menu') as BTreeMenu;
    await waitFor(() => !!tree.shadowRoot);
    const said: string[] = [];
    (tree as unknown as { ariaNotify: (t: string) => void }).ariaNotify = (t: string) => { said.push(t); };
    const items = ITEMS();
    tree.setConfig({ items, sortable: true, ...extra });
    await frames();
    const reorders: TreeReorderDetail[] = [];
    tree.addEventListener('reorder', (e) => reorders.push((e as CustomEvent<TreeReorderDetail>).detail));
    const grip = (id: string) => tree.shadowRoot!.querySelector<HTMLButtonElement>(`[data-grip="${id}"]`)!;
    /** The tree on screen: ids in DOM order, a child list in brackets. */
    const shown = (): string => {
      const level = (ul: Element | null): string => [...(ul?.children ?? [])].map((li) => {
        const kids = li.querySelector(':scope > ul');
        return (li as HTMLElement).dataset.id + (kids ? `[${level(kids)}]` : '');
      }).join(',');
      return level(tree.shadowRoot!.querySelector('.tree'));
    };
    return { tree, items, said, reorders, grip, shown, last: () => said.at(-1) ?? '' };
  };

  try {
    // ── 1. The grip, and what is gone by default ──
    {
      const t = await mount();
      const g = t.grip('a');
      check(`a grip per node, named with its place ("${g?.getAttribute('aria-label')}")`,
        !!g && g.getAttribute('aria-label') === 'Alpha, position 1 of 4' && t.grip('b2')?.getAttribute('aria-label') === 'Bravo two, position 2 of 2');
      check('no ▲ / ▼ controls and no HTML5 draggable by default',
        !t.tree.shadowRoot!.querySelector('.sort-btn, .sort-order') && !t.tree.shadowRoot!.querySelector('[draggable]'));
      check('the whole row drags by default (the row carries the drag cursor)', !!t.tree.shadowRoot!.querySelector('.node-row.whole'));
    }

    // ── 2. Keyboard: pick up, move, drop ──
    {
      const t = await mount();
      const g = t.grip('a');
      g.focus();
      key(g, ' ');
      await frames();
      check(`Space picks the node up (aria-pressed, announced: "${t.last()}")`,
        t.grip('a').getAttribute('aria-pressed') === 'true' && /^Alpha picked up, position 1 of 4 at the top level\./.test(t.last()));
      key(t.grip('a'), 'ArrowDown');
      await frames();
      check(`↓ moves it below Bravo, and no reorder yet (shown ${t.shown()}, announced "${t.last()}")`,
        t.shown() === 'b[b1,b2],a,c,d' && t.reorders.length === 0 && t.last() === 'Alpha, position 2 of 4 at the top level.');
      check('focus stays on the moved node\'s grip', deepActive() === t.grip('a'));
      key(t.grip('a'), ' ');
      await frames();
      const r = t.reorders[0];
      check(`Space drops it: one reorder, after its new previous sibling (${JSON.stringify(t.reorders.map(({ sourceId, targetId, position }) => ({ sourceId, targetId, position })))})`,
        t.reorders.length === 1 && r.sourceId === 'a' && r.targetId === 'b' && r.position === 'after');
      check(`the drop is announced ("${t.last()}")`, t.last() === 'Alpha dropped at position 2 of 4 at the top level.');
      check('reorder reports the consumer\'s own objects', r.sourceItem === t.items[0] && r.targetItem === t.items[1]);
      check(`the consumer's array is not reordered (${t.items.map((i) => i.id).join(',')})`, t.items.map((i) => i.id).join(',') === 'a,b,c,d');
    }

    // ── 3. Reparent: → into the node above, ← out of the parent ──
    {
      const t = await mount();
      t.grip('c').focus();
      key(t.grip('c'), ' ');
      key(t.grip('c'), 'ArrowRight');
      await frames();
      check(`→ moves Charlie into Bravo, as its last child (shown ${t.shown()}, "${t.last()}")`,
        t.shown() === 'a,b[b1,b2,c],d' && t.last() === 'Charlie, position 3 of 3 in Bravo.');
      key(t.grip('c'), 'ArrowLeft');
      await frames();
      check(`← moves it out to after Bravo (shown ${t.shown()}, "${t.last()}")`,
        t.shown() === 'a,b[b1,b2],c,d' && t.last() === 'Charlie, position 3 of 4 at the top level.');
      key(t.grip('c'), 'ArrowUp');
      key(t.grip('c'), 'ArrowRight');
      await frames();
      check(`↑ then → puts it inside Alpha, a leaf until now (shown ${t.shown()})`, t.shown() === 'a[c],b[b1,b2],d');
      key(t.grip('c'), ' ');
      await frames();
      const r = t.reorders[0];
      check(`an only child is reported inside its parent (${JSON.stringify(r && { s: r.sourceId, t: r.targetId, p: r.position })})`,
        t.reorders.length === 1 && r.sourceId === 'c' && r.targetId === 'a' && r.position === 'inside');
      check('Alpha opened so focus could follow into it', !!t.tree.shadowRoot!.querySelector('li[data-id="a"] > ul.children:not(.collapsed)') && deepActive() === t.grip('c'));
    }

    // ── 4. The edges say why nothing moved ──
    {
      const t = await mount();
      t.grip('a').focus();
      key(t.grip('a'), ' ');
      key(t.grip('a'), 'ArrowUp');
      check(`↑ on the first: "${t.last()}"`, t.last() === 'Alpha is already first at the top level.');
      key(t.grip('a'), 'ArrowRight');
      check(`→ with nothing above: "${t.last()}"`, t.last() === 'There is nothing above Alpha to move into.');
      key(t.grip('a'), 'ArrowLeft');
      check(`← at the top level: "${t.last()}"`, t.last() === 'Alpha is already at the top level.');
      key(t.grip('a'), ' ');
      await frames();
      check(`a drop where it started emits nothing ("${t.last()}")`, t.reorders.length === 0 && t.last() === 'Alpha dropped, still at position 1 of 4 at the top level.');
    }

    // ── 5. Escape puts it back; Tab away drops it ──
    {
      const t = await mount();
      let outside = 0;
      const onDoc = (e: KeyboardEvent) => { if (e.key === 'Escape') outside++; };
      document.addEventListener('keydown', onDoc);
      t.grip('b').focus();
      key(t.grip('b'), ' ');
      key(t.grip('b'), 'ArrowDown');
      key(t.grip('b'), 'ArrowDown');
      key(t.grip('b'), 'Escape');
      await frames();
      document.removeEventListener('keydown', onDoc);
      check(`Escape restores the start, emits nothing, and goes no further than the tree (shown ${t.shown()}, "${t.last()}")`,
        t.shown() === 'a,b[b1,b2],c,d' && t.reorders.length === 0 && outside === 0 && t.last() === 'Cancelled. Bravo is back at position 2 of 4 at the top level.');
      key(t.grip('b'), ' ');
      key(t.grip('b'), 'ArrowDown');
      await frames();
      (document.activeElement as HTMLElement | null)?.blur();
      await frames();
      check(`Tab away drops it where it is: one reorder (${t.reorders.length}, shown ${t.shown()})`,
        t.reorders.length === 1 && t.reorders[0].sourceId === 'b' && t.reorders[0].targetId === 'c' && t.reorders[0].position === 'after');
    }

    // ── 6. Clicks: the row still selects, the grip does not ──
    {
      const t = await mount();
      const selected: string[] = [];
      t.tree.addEventListener('select', (e) => selected.push((e as CustomEvent<{ id: string }>).detail.id));
      (t.tree.shadowRoot!.querySelector('[data-item="c"] .node-label') as HTMLElement).click();
      t.grip('d').click();
      check(`a row click selects, a grip click does not (${selected.join(',')})`, selected.join(',') === 'c');
    }

    // ── 7. sortControls: the deprecated ▲ / number / ▼, still emitting ──
    {
      const t = await mount({ sortControls: true });
      const sorts: { id: string; direction: string; item: unknown }[] = [];
      t.tree.addEventListener('sort', (e) => sorts.push((e as CustomEvent).detail));
      const up = t.tree.shadowRoot!.querySelector<HTMLButtonElement>('[data-node="c"][data-sort="up"]');
      check(`sortControls renders ▲ / number / ▼ beside the grip (title "${up?.title}")`, !!up && up.title === 'Move up' && !!t.grip('c') && !!t.tree.shadowRoot!.querySelector('[data-sort-input="c"]'));
      up?.click();
      check('▲ still emits sort, with the consumer\'s item', sorts.length === 1 && sorts[0].id === 'c' && sorts[0].direction === 'up' && sorts[0].item === t.items[2]);
    }

    // ── 8. handleOnly ──
    {
      const t = await mount({ handleOnly: true });
      check('handleOnly: the rows are not drag targets, the grips are there', !t.tree.shadowRoot!.querySelector('.node-row.whole') && !!t.grip('a'));
    }

    // ── 9. No listener growth: re-renders, then one move is one reorder ──
    {
      const t = await mount();
      for (let i = 0; i < 4; i++) { t.tree.setItems(ITEMS()); await frames(); }
      t.grip('a').focus();
      key(t.grip('a'), ' ');
      key(t.grip('a'), 'ArrowDown');
      key(t.grip('a'), ' ');
      await frames();
      check(`after four re-renders, one move is still one reorder and one drop announcement (${t.reorders.length}, ${t.said.filter((s) => s.includes('dropped at')).length})`,
        t.reorders.length === 1 && t.said.filter((s) => s.includes('dropped at')).length === 1);
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();
  (window as unknown as Record<string, boolean>).__treeSortSmokeDone = true;

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] tree-sort-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] tree-sort-smoke ${r}`);
})();
