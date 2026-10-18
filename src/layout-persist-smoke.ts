// TASK-525 — b-tabs reorder (drag and Ctrl+Shift+Arrow), b-split-panel resize (pointer and keyboard) with sizes that
// persist under a key, and captureLayout / applyLayout saving a layout (tab order + split sizes) by layout-key.
import { applyLayout, captureLayout, type BSplitPanel, type BTabs } from 'birko-web-components';
import { focusable } from './smoke-focus.js';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) =>
    check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:900px;opacity:0;pointer-events:none;';
  document.body.appendChild(host);
  const storageKeys: string[] = [];

  const makeTabs = async (reorderable = true, key?: string) => {
    const el = document.createElement('b-tabs') as BTabs;
    if (reorderable) el.setAttribute('reorderable', '');
    if (key) el.setAttribute('layout-key', key);
    host.appendChild(el);
    await tick();
    el.setTabs([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }]);
    await tick();
    return el;
  };
  const tab = (el: BTabs, id: string) => el.shadowRoot!.querySelector<HTMLElement>(`.tab[data-tab="${id}"]`)!;
  const key = (target: HTMLElement, k: string, mods: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true, ...mods }));
  const makeSplit = async (attrs: Record<string, string>) => {
    const el = document.createElement('b-split-panel') as BSplitPanel;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.innerHTML = '<div slot="master">master</div><div slot="detail">detail</div>';
    host.appendChild(el);
    await tick();
    return el;
  };
  const handle = (el: BSplitPanel) => el.shadowRoot!.querySelector<HTMLElement>('.resizer');
  const masterPx = (el: BSplitPanel) => Math.round(el.shadowRoot!.querySelector<HTMLElement>('.master')!.getBoundingClientRect().width);

  try {
    // ── b-tabs ──
    const tabs = await makeTabs();
    const reorders: unknown[] = [];
    tabs.addEventListener('tab-reorder', (e) => reorders.push((e as CustomEvent).detail));
    eq('order reads the tab ids', tabs.order, ['a', 'b', 'c']);
    check('reorderable tabs are draggable', tab(tabs, 'a').getAttribute('draggable') === 'true');

    // Focus is page-global and other suites open modals: wait until the tab can take focus, then press the key
    // and check focus with no await in between (see smoke-focus.ts).
    check('precondition: the active tab can take focus', await focusable(tabs.shadowRoot!, tab(tabs, 'a')));
    key(tab(tabs, 'a'), 'ArrowRight', { ctrlKey: true, shiftKey: true });
    check('focus stays on the moved tab', tabs.shadowRoot!.activeElement === tab(tabs, 'a'));
    await tick();
    eq('Ctrl+Shift+ArrowRight moves the active tab right', tabs.order, ['b', 'a', 'c']);
    eq('and emits tab-reorder with the order', reorders[0], { order: ['b', 'a', 'c'], tab: 'a' });
    check('the move is announced', (tabs.shadowRoot!.querySelector('[aria-live]')?.textContent ?? '').includes('position 2 of 3'));

    key(tab(tabs, 'a'), 'End', { ctrlKey: true, shiftKey: true });
    await tick();
    eq('Ctrl+Shift+End moves it last', tabs.order, ['b', 'c', 'a']);
    key(tab(tabs, 'a'), 'ArrowRight', { ctrlKey: true, shiftKey: true });
    await tick();
    eq('moving past the end changes nothing and emits nothing', [tabs.order, reorders.length], [['b', 'c', 'a'], 2]);

    key(tab(tabs, 'a'), 'ArrowLeft');
    await tick();
    eq('a plain arrow still selects, without reordering', [tabs.getAttribute('active'), tabs.order], ['c', ['b', 'c', 'a']]);

    // drag c before b
    const dt = new DataTransfer();
    const box = (id: string) => tab(tabs, id).getBoundingClientRect();
    tab(tabs, 'c').dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: dt }));
    tab(tabs, 'b').dispatchEvent(new DragEvent('dragover', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: box('b').left + 2 }));
    tab(tabs, 'b').dispatchEvent(new DragEvent('drop', { bubbles: true, composed: true, cancelable: true, dataTransfer: dt, clientX: box('b').left + 2 }));
    tab(tabs, 'b')?.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true }));
    await tick();
    eq('dropping on the left half of a tab puts the dragged tab before it', tabs.order, ['c', 'b', 'a']);

    tabs.order = ['a', 'zzz', 'c'];
    await tick();
    eq('setting order ignores unknown ids and keeps the rest after', tabs.order, ['a', 'c', 'b']);
    eq('and emits nothing', reorders.length, 3);

    // Labels are text (decided by the user): markup in one is shown, never parsed, and an id cannot break out of its attribute.
    const marked = await makeTabs(false);
    marked.setTabs([{ id: 'x" onclick="1', label: '<img src=x onerror="window.__tabsXss=1"><b>bold</b>' }]);
    await tick();
    const markedTab = marked.shadowRoot!.querySelector<HTMLElement>('.tab')!;
    eq('a label with markup is shown as text', markedTab.textContent, '<img src=x onerror="window.__tabsXss=1"><b>bold</b>');
    check('and creates no elements', markedTab.children.length === 0 && !(window as { __tabsXss?: number }).__tabsXss);
    eq('an id with a quote stays one attribute value', [markedTab.dataset.tab, markedTab.hasAttribute('onclick')], ['x" onclick="1', false]);

    const fixed = await makeTabs(false);
    key(tab(fixed, 'a'), 'ArrowRight', { ctrlKey: true, shiftKey: true });
    await tick();
    eq('without reorderable, Ctrl+Shift+Arrow does not reorder', fixed.order, ['a', 'b', 'c']);
    check('and tabs are not draggable', !tab(fixed, 'a').hasAttribute('draggable'));

    // ── b-split-panel ──
    const persist = `smoke-${Date.now()}`;
    storageKeys.push(`birko-split:${persist}`);
    const split = await makeSplit({ resizable: '', 'master-width': '300px', 'persist-key': persist, 'collapse-at': '10px' });
    const resizes: unknown[] = [];
    split.addEventListener('split-resize', (e) => resizes.push((e as CustomEvent).detail));
    const sep = handle(split)!;
    check('resizable renders a vertical separator', sep?.getAttribute('role') === 'separator' && sep.getAttribute('aria-orientation') === 'vertical');
    eq('its value is the master width', sep.getAttribute('aria-valuenow'), '300');

    key(sep, 'ArrowRight');
    await tick();
    eq('ArrowRight widens the master by 16px', split.getAttribute('master-width'), '316px');
    eq('and emits split-resize with the sizes', resizes[0], { sizes: { master: '316px', detail: '1fr' } });
    eq('and saves them under persist-key', JSON.parse(localStorage.getItem(`birko-split:${persist}`) ?? 'null'), { master: '316px', detail: '1fr' });
    key(handle(split)!, 'ArrowLeft', { shiftKey: true });
    await tick();
    eq('Shift+ArrowLeft narrows by 64px', split.getAttribute('master-width'), '252px');
    key(handle(split)!, 'Home');
    await tick();
    eq('Home goes to the minimum', split.getAttribute('master-width'), '120px');

    const h = handle(split)!;
    const start = masterPx(split);
    const x = h.getBoundingClientRect().left;
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, pointerId: 7 }));
    h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 50, pointerId: 7 }));
    h.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 50, pointerId: 7 }));
    await tick();
    eq('dragging the separator 50px widens the master by 50px', split.getAttribute('master-width'), `${start + 50}px`);

    const restored = await makeSplit({ resizable: '', 'persist-key': persist });
    eq('a new panel with the same persist-key restores the sizes', restored.sizes, { master: `${start + 50}px`, detail: '1fr' });

    const hostile = `smoke-bad-${Date.now()}`;
    storageKeys.push(`birko-split:${hostile}`);
    localStorage.setItem(`birko-split:${hostile}`, JSON.stringify({ master: '1px; background: red', detail: '1fr' }));
    const guarded = await makeSplit({ resizable: '', 'persist-key': hostile });
    eq('a stored value that is not a CSS length is ignored', guarded.sizes.master, '18rem');

    let refused = false;
    try { split.sizes = { master: 'calc(1px); color: red', detail: '1fr' }; } catch (e) { refused = e instanceof TypeError; }
    check('setting sizes refuses a non-length', refused);
    split.sizes = { master: '20rem', detail: '2fr' };
    eq('and sets valid ones', [split.getAttribute('master-width'), split.getAttribute('detail-width')], ['20rem', '2fr']);
    const plain = await makeSplit({});
    check('without resizable there is no separator', handle(plain) === null);

    // ── layout hook ──
    const savedTabs = await makeTabs(true, 'ws-tabs');
    savedTabs.order = ['c', 'a', 'b'];
    const savedSplit = await makeSplit({ 'layout-key': 'ws-split', 'master-width': '410px' });
    const layout = captureLayout(host);
    eq('captureLayout reads tab order and split sizes by layout-key', [layout.tabs['ws-tabs'], layout.splits['ws-split']],
      [['c', 'a', 'b'], { master: '410px', detail: '1fr' }]);
    check('elements without layout-key are not captured', Object.keys(layout.tabs).length === 1 && Object.keys(layout.splits).length === 1);

    savedTabs.remove(); savedSplit.remove();
    const freshTabs = await makeTabs(true, 'ws-tabs');
    const freshSplit = await makeSplit({ 'layout-key': 'ws-split' });
    applyLayout({ ...layout, tabs: { ...layout.tabs, gone: ['x'] } }, host);
    await tick();
    eq('applyLayout restores both, skipping keys with no element', [freshTabs.order, freshSplit.sizes], [['c', 'a', 'b'], { master: '410px', detail: '1fr' }]);
    let threw = false;
    try { applyLayout({ splits: { 'ws-split': { master: 'url(x)', detail: '1fr' } } }, host); } catch { threw = true; }
    eq('an invalid saved size is skipped, not applied or thrown', [threw, freshSplit.sizes.master], [false, '410px']);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  } finally {
    host.remove();
    for (const k of storageKeys) localStorage.removeItem(k);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] layout-persist-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] layout-persist-smoke ${r}`);
})();
