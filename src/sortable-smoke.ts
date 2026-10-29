// Birko TASK-787 — b-sortable-list and b-sortable-picker, everything an in-page event can drive: keyboard moves in
// each layout (pick up, move, drop; cancel; Tab away), Remove, the `limit` line, the events and announcements, and the
// picker's search, duplicate, max and labels. A pointer drag needs trusted input and pointer capture, so it is in
// sortable-drag-check.mjs. The order is asserted from three sides each time: the change event, getOrder(), and the
// rows on screen (the handles' names, in DOM order), so a list that reported one order and showed another fails.
import 'birko-web-components/data';
import 'birko-web-components/inputs';
import type { BSortableList, BSortablePicker, SortableChangeDetail, SortableItemData } from 'birko-web-components';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};

const ITEMS: SortableItemData[] = ['Alder', 'Birch', 'Cedar', 'Douglas', 'Elm', 'Fir'].map((label) => ({ id: label[0].toLowerCase(), label }));
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true }));
const rows = (list: BSortableList) => [...list.shadowRoot!.querySelectorAll<HTMLLIElement>('li.row')];
const handle = (list: BSortableList, id: string) => rows(list).find((r) => r.dataset.id === id)!.querySelector<HTMLButtonElement>('.handle')!;
/** The order on screen: the rows' ids, in DOM order, and each handle's own position number agreeing with it. */
const shown = (list: BSortableList) => rows(list).map((r) => r.dataset.id).join('');
const named = (list: BSortableList) => rows(list).every((r, i) => (r.querySelector('.handle')!.getAttribute('aria-label') ?? '').includes(`position ${i + 1} of `));
// Record announcements: components call ariaNotify where the browser has it (Chrome/Edge do), else a live region.
const said = new WeakMap<Element, string[]>();
const record = (el: Element) => {
  const log: string[] = [];
  said.set(el, log);
  (el as unknown as { ariaNotify: (t: string) => void }).ariaNotify = (t: string) => { log.push(t); };
};
const live = (el: Element) => said.get(el)?.at(-1) ?? '';
const deepActive = (): Element | null => {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // SERIALISATION: this suite asserts where focus is, and an open modal elsewhere makes the page inert (focus() is
  // refused). Measured: 39/50 inside verify.mjs, 52/52 alone. So it runs after every suite that opens one.
  {
    const flags = ['__gallerySmokeDone', '__modalFocusSmokeDone', '__toastModalSmokeDone', '__undoDeleteSmokeDone'];
    const w = window as unknown as Record<string, boolean | undefined>;
    const pending = () => flags.filter((f) => w[f] !== true);
    const deadline = Date.now() + 150_000;
    while (pending().length && Date.now() < deadline) await sleep(50);
    check(`the suites that open modals finished first (still running: ${pending().join(', ') || 'none'})`, pending().length === 0);
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:640px;z-index:99990;background:var(--b-bg)';
  document.body.append(host);

  const mount = async (layout: string, extra = '') => {
    host.innerHTML = `<b-sortable-list label="Trees" layout="${layout}" removable ${extra}></b-sortable-list>`;
    const list = host.querySelector('b-sortable-list') as BSortableList;
    await waitFor(() => !!list.shadowRoot?.querySelector('.items'));
    record(list);
    list.setItems(ITEMS);
    await frames();
    const changes: SortableChangeDetail[] = [];
    list.addEventListener('change', (e) => changes.push((e as CustomEvent<SortableChangeDetail>).detail));
    return { list, changes };
  };

  try {
    // ── 1. Keyboard in every layout: Space picks up, arrows move, Space drops ──
    for (const layout of ['list', 'grid', 'inline']) {
      const { list, changes } = await mount(layout);
      check(`${layout}: six rows render in the given order (${shown(list)})`, shown(list) === 'abcdef' && list.getOrder().join('') === 'abcdef');
      const h = handle(list, 'a');
      h.focus();
      key(h, ' ');
      check(`${layout}: Space picks the row up (aria-pressed, announced: "${live(list)}")`,
        h.getAttribute('aria-pressed') === 'true' && /Alder picked up, position 1 of 6/.test(live(list)));
      // list: ↓↓ → position 3. grid: ↓ moves one row of tiles; → once more. inline: →→.
      const cols = layout === 'grid' ? rows(list).filter((r) => Math.round(r.getBoundingClientRect().top) === Math.round(rows(list)[0].getBoundingClientRect().top)).length : 1;
      const keys = layout === 'list' ? ['ArrowDown', 'ArrowDown'] : layout === 'grid' ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight', 'ArrowRight'];
      for (const k of keys) key(deepActive() ?? h, k);
      const to = layout === 'grid' ? cols + 1 : 2;
      const expected = 'bcdef'.slice(0, to) + 'a' + 'bcdef'.slice(to);
      check(`${layout}: the arrows move it, no change event yet (shown ${shown(list)}, want ${expected}${layout === 'grid' ? `, ${cols} columns` : ''})`,
        shown(list) === expected && changes.length === 0);
      check(`${layout}: focus stays on the moved row's handle`, deepActive() === handle(list, 'a'));
      key(handle(list, 'a'), ' ');
      check(`${layout}: Space drops it: one change with the new order (${JSON.stringify(changes.map((c) => c.order.join('')))})`,
        changes.length === 1 && changes[0].order.join('') === expected && changes[0].id === 'a' && changes[0].from === 0 && changes[0].to === to);
      check(`${layout}: the children are in the new order too, and the handles name it`,
        [...list.children].map((c) => (c as HTMLElement).dataset.id).join('') === expected && named(list));
      check(`${layout}: the drop is announced ("${live(list)}")`, live(list) === `Alder dropped at position ${to + 1} of 6.`);
      if (layout === 'grid') check(`grid: the layout really has more than one column (${cols})`, cols > 1);
    }

    // ── 2. Escape puts it back; Home/End; edges ──
    {
      const { list, changes } = await mount('list');
      handle(list, 'c').focus();
      key(handle(list, 'c'), ' ');
      key(handle(list, 'c'), 'Home');
      check(`Home moves it first while picked up (${shown(list)})`, shown(list) === 'cabdef');
      key(handle(list, 'c'), 'Escape');
      check(`Escape puts it back, with no change event (${shown(list)}, ${changes.length} events)`, shown(list) === 'abcdef' && changes.length === 0);
      check(`the cancel is announced ("${live(list)}")`, /Cancelled\. Cedar is back at position 3 of 6/.test(live(list)));
      key(handle(list, 'a'), 'ArrowDown');
      check('an arrow without Space first moves nothing', shown(list) === 'abcdef');
      handle(list, 'a').focus();
      key(handle(list, 'a'), ' ');
      key(handle(list, 'a'), 'ArrowUp');
      check(`at the top it says so ("${live(list)}")`, live(list) === 'Alder is already first.');
      key(handle(list, 'a'), 'End');
      handle(list, 'a').blur();
      await frames();
      check(`leaving the handle drops the row where it is (${shown(list)}, ${changes.length} event)`, shown(list) === 'bcdefa' && changes.length === 1);
    }

    // ── 3. Remove ──
    {
      const { list, changes } = await mount('list');
      const vetoed = (e: Event) => e.preventDefault();
      list.addEventListener('remove', vetoed);
      rows(list)[1].querySelector<HTMLButtonElement>('.remove')!.click();
      check('a cancelled remove event keeps the row', shown(list) === 'abcdef' && changes.length === 0);
      list.removeEventListener('remove', vetoed);
      rows(list)[1].querySelector<HTMLButtonElement>('.remove')!.click();
      await frames();
      check(`Remove takes the row out, emits the order (${shown(list)}, ${JSON.stringify(changes[0])})`,
        shown(list) === 'acdef' && changes.length === 1 && changes[0].removed === true && changes[0].order.join('') === 'acdef');
      check('focus goes to the next row\'s handle', deepActive() === handle(list, 'c'));
      check(`the removal is announced ("${live(list)}")`, live(list) === 'Removed Birch. 5 left.');
      for (const id of ['a', 'c', 'd', 'e', 'f']) rows(list).find((r) => r.dataset.id === id)!.querySelector<HTMLButtonElement>('.remove')!.click();
      await frames();
      const empty = list.shadowRoot!.querySelector<HTMLElement>('.empty')!;
      check('with no rows the empty state shows', !empty.hidden && empty.textContent!.includes('Nothing here yet.'));
    }

    // ── 4. Consumer rows: any element with data-id; the order follows the children ──
    {
      host.innerHTML = `<b-sortable-list label="Blocks" handle-only>
          <div data-id="hero" data-label="Hero">Hero <input aria-label="Hero title"></div>
          <div data-id="text">Text block</div>
          <div data-id="grid" data-label="Product grid">Product grid</div>
        </b-sortable-list>`;
      const list = host.querySelector('b-sortable-list') as BSortableList;
      await waitFor(() => rows(list).length === 3);
      check(`consumer children become rows (${shown(list)})`, shown(list) === 'herotextgrid');
      check('a row is named by data-label, else by its text',
        handle(list, 'hero').getAttribute('aria-label') === 'Hero, position 1 of 3' &&
        handle(list, 'text').getAttribute('aria-label') === 'Text block, position 2 of 3');
      const added = document.createElement('div');
      added.dataset.id = 'faq';
      added.textContent = 'FAQ';
      list.insertBefore(added, list.firstChild);
      await waitFor(() => rows(list).length === 4);
      check(`a child the consumer adds is a row in its place (${list.getOrder().join(',')})`, list.getOrder().join(',') === 'faq,hero,text,grid');
    }

    // ── 5. limit: the line and the dimmed rows ──
    {
      const { list } = await mount('list');
      list.setAttribute('limit', '4');
      await frames();
      const line = list.shadowRoot!.querySelector('.limit');
      const items = [...list.shadowRoot!.querySelector('.items')!.children];
      check(`limit=4 puts the line before row 5 (${line?.textContent})`, items.indexOf(line!) === 4 && line!.getAttribute('aria-hidden') === 'true');
      check('rows past the limit are dimmed, the rest are not', rows(list).map((r) => r.classList.contains('beyond') ? 1 : 0).join('') === '000011');
      list.setAttribute('limit', '6');
      await frames();
      check('no line when the list is within the limit', !list.shadowRoot!.querySelector('.limit'));
    }

    // ── 6. b-sortable-picker ──
    {
      const fabrics: SortableItemData[] = [
        { id: 'shaggy', label: 'Shaggy fur' }, { id: 'mink', label: 'Velvet mink' }, { id: 'fox', label: 'Arctic fox faux' },
        { id: 'lamb', label: 'Curly lamb' }, { id: 'plush', label: 'Short pile plush' },
      ];
      let calls = 0;
      let answered = 0;
      host.innerHTML = '<form id="sp-form"><b-sortable-picker name="products" label="Products" max="3"></b-sortable-picker></form>';
      const picker = host.querySelector('b-sortable-picker') as BSortablePicker;
      await waitFor(() => !!picker.shadowRoot?.querySelector('input'));
      picker.setSearch(async (q) => {
        calls++;
        await sleep(30);
        answered++;
        return fabrics.filter((f) => f.label.toLowerCase().includes(q.toLowerCase()));
      });
      picker.setItems([{ id: 'fox', label: 'Arctic fox faux' }]);
      const changes: string[][] = [];
      const rejects: string[] = [];
      picker.addEventListener('change', (e) => changes.push((e as CustomEvent).detail.value));
      picker.addEventListener('reject', (e) => rejects.push((e as CustomEvent).detail.reason));
      const sr = picker.shadowRoot!;
      const input = sr.querySelector('input')!;
      const list = sr.querySelector('b-sortable-list') as BSortableList;
      await waitFor(() => rows(list).length === 1);
      /** Type a query and wait for ITS answer to render: the previous results stay on screen until then. */
      const type = async (text: string) => {
        const before = answered;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => answered > before, 2000);
        await frames();
      };
      const add = sr.querySelector<HTMLButtonElement>('.add')!;
      const notice = () => sr.querySelector('.notice')!.textContent ?? '';

      check(`the Add button is as tall as the search input (${add.offsetHeight} vs ${input.offsetHeight})`, add.offsetHeight === input.offsetHeight);
      record(picker);
      await type('shag');
      check('typing searches after a pause and lists the results', sr.querySelectorAll('.option').length === 1 && calls === 1);
      key(input, 'Enter');
      check(`Enter adds the highlighted result at the end (${list.getOrder().join(',')})`, list.getOrder().join(',') === 'fox,shaggy' && changes.at(-1)?.join(',') === 'fox,shaggy');
      check('the picker reports one change, not the list\'s as well', changes.length === 1);
      await type('mink');
      add.click();
      check(`Add adds it (${picker.value})`, picker.value === 'fox,shaggy,mink');
      {
        input.value = 'curly';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        key(input, 'Enter');
        check(`Enter while the next search is pending adds nothing from the old results (${picker.value})`,
          picker.value === 'fox,shaggy,mink' && add.disabled);
      }
      await type('fur');
      key(input, 'Enter');
      check(`a duplicate pick is refused and pointed at ("${notice()}")`,
        picker.value === 'fox,shaggy,mink' && notice() === 'Shaggy fur is already in the list, at position 2.' && rejects.at(-1) === 'duplicate'
        && rows(list).find((r) => r.dataset.id === 'shaggy')!.classList.contains('flash'));
      await type('lamb');
      key(input, 'Enter');
      check(`at max a pick is refused with a notice ("${notice()}")`,
        picker.value === 'fox,shaggy,mink' && notice() === 'The list holds 3. Remove one to add Curly lamb.' && rejects.at(-1) === 'max');
      await type('zzz');
      check('a search with no match says so', /Nothing matches “zzz”/.test(sr.querySelector('.results')!.textContent ?? ''));
      check(`chosen labels survive a search that does not return them (${rows(list).map((r) => r.querySelector('.handle')!.getAttribute('aria-label')).join(' | ')})`,
        rows(list).map((r) => handle(list, r.dataset.id!).getAttribute('aria-label')!.split(',')[0]).join('|') === 'Arctic fox faux|Shaggy fur|Velvet mink');
      // Reorder inside the picker by keyboard: the picker's value follows.
      key(handle(list, 'mink'), ' ');
      key(handle(list, 'mink'), 'Home');
      key(handle(list, 'mink'), ' ');
      check(`a reorder in the list is the picker's value (${picker.value})`, picker.value === 'mink,fox,shaggy' && changes.at(-1)?.join(',') === 'mink,fox,shaggy');
      const fd = new FormData(host.querySelector('form')!);
      check(`the form gets one entry per id, in order (${JSON.stringify(fd.getAll('products'))})`, fd.getAll('products').join(',') === 'mink,fox,shaggy');
      // The limit lowered after picking: the extra rows stay, below a line, with a notice.
      picker.setAttribute('max', '2');
      await frames();
      check(`max lowered below the list: the line and the notice ("${notice()}")`,
        !!list.shadowRoot!.querySelector('.limit') && /Only the first 2 are used/.test(notice()) && picker.value === 'mink,fox,shaggy');
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] sortable-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] sortable-smoke ${r}`);
})();
