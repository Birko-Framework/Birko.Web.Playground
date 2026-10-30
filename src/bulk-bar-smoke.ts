// Birko TASK-788 — b-data-table's bulk action bar, redesigned (decided by the user on a clickable preview): it floats
// above the table's sticky footer, centred on the table; a prominent count and ×; actions in b-button's look with a
// primary and a danger variant; as many as fit, the rest in More; b-confirm-dialog instead of the browser's confirm();
// "Select all N matching" (opt-in) selecting every id client-side, or flagging allMatching server-side; a toolbar
// with one tab stop; Escape clears; the count announced. The bulkActions config and the bulk-action event keep working.
import 'birko-web-components/data';
import type { BDataTable, BulkActionDetail } from 'birko-web-components';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};

const ACTIONS = [
  { id: 'publish', label: 'Publish', variant: 'primary' as const },
  { id: 'unpublish', label: 'Unpublish' },
  { id: 'delete', label: 'Delete', variant: 'danger' as const, confirm: true, confirmMessage: 'Delete {count} products?' },
  { id: 'categories-add', label: 'Add to categories' },
  { id: 'categories-remove', label: 'Remove from categories' },
  { id: 'export', label: '<b>Export</b> CSV' },
  { id: 'duplicate', label: 'Duplicate' },
];
const ROWS = Array.from({ length: 24 }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${i + 1}` }));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // SERIALISATION: this suite moves focus and opens a confirm dialog (a modal, so the page is inert meanwhile).
  {
    const flags = ['__gallerySmokeDone', '__modalFocusSmokeDone', '__toastModalSmokeDone', '__undoDeleteSmokeDone', '__sortableSmokeDone'];
    const w = window as unknown as Record<string, boolean | undefined>;
    const pending = () => flags.filter((f) => w[f] !== true);
    const deadline = Date.now() + 180_000;
    while (pending().length && Date.now() < deadline) await sleep(50);
    check(`the suites that use focus or modals finished first (still running: ${pending().join(', ') || 'none'})`, pending().length === 0);
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:420px;overflow:auto;z-index:99990;background:var(--b-bg)';
  document.body.append(host);
  const said: string[] = [];
  const events: BulkActionDetail[] = [];

  /** A table over ROWS: client-paged, or server-paged with `total` rows reported. */
  const mount = async (server = false, total = 248, selectAllMatching = true, extra: Record<string, unknown> = {}) => {
    host.innerHTML = '<b-data-table></b-data-table>';
    const dt = host.querySelector('b-data-table') as BDataTable;
    (dt as unknown as { ariaNotify: (t: string) => void }).ariaNotify = (t: string) => { said.push(t); };
    const apiClient = {
      get: async () => ({ ok: true, status: 200, headers: new Headers(),
        data: server ? { items: ROWS.slice(0, 8), totalCount: total } : ROWS }),
    };
    await waitFor(() => !!dt.shadowRoot);
    dt.setConfig({ endpoint: '/x', apiClient: apiClient as never, idField: 'id', pageSize: 8, selectable: true, selectAllMatching,
      columns: [{ key: 'name', label: 'Name' }], bulkActions: ACTIONS, ...(server ? { flatArray: false } : {}), ...extra });
    dt.addEventListener('bulk-action', (e) => events.push((e as CustomEvent<BulkActionDetail>).detail));
    await dt.load();
    await waitFor(() => (dt.shadowRoot!.querySelector('b-table')?.shadowRoot?.querySelectorAll('.row-select').length ?? 0) === 8);
    await frames();
    return dt;
  };
  const sr = (dt: BDataTable) => dt.shadowRoot!;
  const tableSr = (dt: BDataTable) => sr(dt).querySelector('b-table')!.shadowRoot!;
  const tick = async (dt: BDataTable, i: number) => {
    const cb = tableSr(dt).querySelectorAll<HTMLInputElement>('.row-select')[i];
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await frames();
  };
  const tickPage = async (dt: BDataTable) => {
    const all = tableSr(dt).querySelector<HTMLInputElement>('.select-all')!;
    all.checked = true;
    all.dispatchEvent(new Event('change', { bubbles: true }));
    await frames();
  };
  const bar = (dt: BDataTable) => sr(dt).querySelector<HTMLElement>('.bulk-bar');
  const inline = (dt: BDataTable) => [...sr(dt).querySelectorAll<HTMLButtonElement>('.bulk-btn')].filter((b) => !b.hidden);
  const hidden = (dt: BDataTable) => [...sr(dt).querySelectorAll<HTMLButtonElement>('.bulk-btn')].filter((b) => b.hidden);
  const more = (dt: BDataTable) => sr(dt).querySelector<HTMLElement>('.bulk-more')!;

  try {
    // ── 1. Selecting shows the bar: count, toolbar, announcement ──
    let dt = await mount();
    check('no bar with nothing selected', !bar(dt));
    await tick(dt, 1);
    await tick(dt, 3);
    const b = bar(dt)!;
    check(`two ticks show the bar with a prominent count (${b?.querySelector('.bulk-count')?.textContent?.trim()})`,
      !!b && b.querySelector('.bulk-count strong')?.textContent === '2');
    check(`the bar is a labelled toolbar (${b.getAttribute('aria-label')})`, b.getAttribute('role') === 'toolbar' && b.getAttribute('aria-label') === 'Bulk actions: 2 selected');
    check(`the count change is announced ("${said.at(-1)}")`, said.at(-1) === '2 selected');

    // ── 2. Placement: above the footer, centred on the table, room under the last row ──
    {
      const br = b.getBoundingClientRect();
      const pager = sr(dt).querySelector('b-pagination')!.getBoundingClientRect();
      const footer = sr(dt).querySelector('.footer')!.getBoundingClientRect();
      const table = sr(dt).querySelector('b-table')!.getBoundingClientRect();
      check(`the bar sits above the footer, not over the pagination (bar bottom ${Math.round(br.bottom)}, footer top ${Math.round(footer.top)}, pagination top ${Math.round(pager.top)})`,
        br.bottom <= footer.top + 0.5 && br.bottom <= pager.top);
      check(`…centred on the table (${Math.round(br.left + br.width / 2)} vs ${Math.round(table.left + table.width / 2)})`,
        Math.abs(br.left + br.width / 2 - (table.left + table.width / 2)) < 2);
      // The footer, as the user saw it in Chrome: "24 items" glued to the table's edge, and an empty page-size box.
      const pgEl = sr(dt).querySelector<HTMLElement>('b-pagination')!;
      check(`the footer is inset like the cells, not on the table's edge (${Math.round(pager.left - table.left)}px)`, pager.left - table.left >= 8);
      const sizeSel = pgEl.shadowRoot!.querySelector<HTMLElement & { inputValue?: string }>('.page-size-select');
      check(`the page-size box shows the table's own size, 8, which the defaults lack (${sizeSel?.inputValue})`, sizeSel?.inputValue === '8');
      const room = parseFloat(getComputedStyle(sr(dt).querySelector('b-table')!).marginBottom);
      check(`while selecting the table keeps room under its last row for the bar (${room}px, bar ${Math.round(br.height)}px)`, room >= br.height);
    }

    // ── 3. Visible after scrolling ──
    {
      host.style.height = '260px';
      await frames();
      host.scrollTop = host.scrollHeight / 2;
      await frames();
      const hr = host.getBoundingClientRect();
      const br = bar(dt)!.getBoundingClientRect();
      check(`scrolled half way, the bar is still in view (bar ${Math.round(br.top)}–${Math.round(br.bottom)} in ${Math.round(hr.top)}–${Math.round(hr.bottom)})`,
        br.top >= hr.top && br.bottom <= hr.bottom && br.height > 0);
      host.style.height = '420px';
      host.scrollTop = 0;
      await frames();
    }

    // ── 4. Look: variants, order, escaped labels, one tab stop ──
    {
      const all = [...sr(dt).querySelectorAll<HTMLButtonElement>('.bulk-btn')];
      check(`danger actions come last (${all.map((x) => x.dataset.bulk).join(',')})`, all.at(-1)?.dataset.bulk === 'delete');
      check('Publish carries the primary variant, Delete the danger one',
        all[0].classList.contains('primary') && all.at(-1)!.classList.contains('danger'));
      const exp = all.find((x) => x.dataset.bulk === 'export')!;
      check(`a label is text, never markup (${JSON.stringify(exp.textContent)})`, exp.textContent === '<b>Export</b> CSV' && !exp.querySelector('b'));
      const stops = [...b.querySelectorAll<HTMLButtonElement>('button')].filter((x) => !x.hidden && !x.closest('[hidden]') && x.tabIndex === 0);
      check(`the toolbar is one tab stop (${stops.length})`, stops.length === 1);
      stops[0].focus();
      stops[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true }));
      const active = sr(dt).activeElement as HTMLElement | null;
      check(`ArrowRight moves focus along the toolbar (${active?.dataset.key})`, !!active && active !== stops[0] && active.tabIndex === 0 && stops[0].tabIndex === -1);
    }

    // ── 5. As many as fit; the rest in More; at phone width one stays ──
    {
      const wide = { inline: inline(dt).length, hidden: hidden(dt).length };
      check(`at 900px the actions that fit are inline, the rest in More (${wide.inline} inline, ${wide.hidden} in More, More ${more(dt).hidden ? 'hidden' : 'shown'})`,
        wide.inline + wide.hidden === ACTIONS.length && wide.inline >= 2 && (wide.hidden > 0) === !more(dt).hidden && b.scrollWidth <= b.clientWidth + 1);
      host.style.width = '290px'; // the table's width inside a Playground card on a 390px phone
      await sleep(80);
      await frames();
      // "As many as fit": the count is measured, so the check is the rule: something moved to More, the rest fits,
      // and one more would not have (the first hidden one is wider than the room left).
      const room = b.clientWidth - b.scrollWidth;
      const firstHidden = hidden(dt)[0];
      firstHidden.hidden = false;
      const wouldOverflow = b.scrollWidth > b.clientWidth + 1;
      firstHidden.hidden = true;
      check(`at 290px what fits stays inline and More takes the rest (${inline(dt).length} inline, ${hidden(dt).length} in More, ${room}px spare)`,
        inline(dt).length >= 1 && hidden(dt).length > 0 && inline(dt).length + hidden(dt).length === ACTIONS.length
        && !more(dt).hidden && b.scrollWidth <= b.clientWidth + 1 && wouldOverflow);
      check('…and the one that stays is the first, the danger one is in More', inline(dt)[0].dataset.bulk === 'publish' && hidden(dt).at(-1)?.dataset.bulk === 'delete');
      // Measured in Chrome at a 390px phone: the actions group shrank below its buttons (min-width: 0), so More sat on
      // top of × while the bar's own scrollWidth said it fitted. Overlap is what the user sees, so check that.
      {
        const shownBoxes = [...b.querySelectorAll<HTMLElement>('button')].filter((x) => !x.hidden && !x.closest('[hidden]'))
          .map((x) => ({ key: x.dataset.key ?? '?', r: x.getBoundingClientRect() }));
        const clash = shownBoxes.flatMap((a, i) => shownBoxes.slice(i + 1)
          .filter((c) => a.r.left < c.r.right - 0.5 && c.r.left < a.r.right - 0.5 && a.r.top < c.r.bottom && c.r.top < a.r.bottom)
          .map((c) => `${a.key}×${c.key}`));
        const acts = b.querySelector<HTMLElement>('.bulk-actions')!;
        check(`at 290px no two of the bar's controls overlap (${clash.join(', ') || 'none'}; actions ${acts.scrollWidth}/${acts.clientWidth})`,
          clash.length === 0 && acts.scrollWidth <= acts.clientWidth + 1);
      }
      // A More item runs its action.
      const dd = more(dt) as HTMLElement;
      dd.shadowRoot!.querySelector<HTMLElement>('.trigger')!.click();
      await frames();
      const item = [...dd.shadowRoot!.querySelectorAll<HTMLElement>('.item')].find((x) => x.textContent?.trim() === 'Duplicate');
      item?.click();
      await frames();
      check(`a More item fires bulk-action with the selection (${JSON.stringify(events.at(-1))})`,
        events.at(-1)?.action === 'duplicate' && events.at(-1)?.selected.join(',') === 'r2,r4' && events.at(-1)?.count === 2);
      host.style.width = '900px';
      await sleep(80);
      await frames();
    }

    // ── 6. A confirmed action asks in b-confirm-dialog, not the browser ──
    {
      const realConfirm = window.confirm;
      let nativeAsked = false;
      window.confirm = () => { nativeAsked = true; return true; };
      const n = events.length;
      dt.shadowRoot!.querySelector<HTMLButtonElement>('.bulk-btn[data-bulk="delete"]')!.click();
      const dlg = sr(dt).querySelector('b-confirm-dialog')!;
      await waitFor(() => !!dlg.shadowRoot?.querySelector('dialog')?.open);
      const msg = dlg.getAttribute('message');
      check(`Delete opens b-confirm-dialog with the count ("${msg}"), not window.confirm`, !!dlg.shadowRoot!.querySelector('dialog')?.open && msg === 'Delete 2 products?' && !nativeAsked);
      dlg.shadowRoot!.querySelector<HTMLElement>('.btn-cancel')!.click();
      await sleep(30);
      check('Cancel fires nothing', events.length === n);
      dt.shadowRoot!.querySelector<HTMLButtonElement>('.bulk-btn[data-bulk="delete"]')!.click();
      await waitFor(() => !!dlg.shadowRoot?.querySelector('dialog')?.open);
      dlg.shadowRoot!.querySelector<HTMLElement>('.btn-confirm')!.click();
      await waitFor(() => events.length > n);
      check(`confirming fires bulk-action (${events.at(-1)?.action})`, events.at(-1)?.action === 'delete' && events.length === n + 1);
      window.confirm = realConfirm;
    }

    // ── 7. × and Escape clear ──
    {
      bar(dt)!.querySelector<HTMLButtonElement>('[data-clear]')!.click();
      await frames();
      check(`× clears the selection and the bar goes (${dt.getSelected().length} selected)`, dt.getSelected().length === 0 && !bar(dt));
      check(`…announced ("${said.at(-1)}")`, said.at(-1) === 'Selection cleared');
      await tick(dt, 0);
      bar(dt)!.querySelector<HTMLButtonElement>('.bulk-btn')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }));
      await frames();
      check('Escape in the bar clears it too', dt.getSelected().length === 0 && !bar(dt));
    }

    // ── 8. Select all matching, client-paged: every id ──
    {
      await tickPage(dt);
      const link = bar(dt)!.querySelector<HTMLButtonElement>('[data-select-all]');
      check(`a whole page selected offers "${link?.textContent}"`, link?.textContent === 'Select all 24 matching');
      // The widest bar, on a phone (the user's case in Chrome at 390px): count + link left no room for an action, More
      // and ×, which were cut off past the bar and scrolled the card sideways. Now it wraps onto two rows.
      {
        host.style.width = '290px';
        await sleep(80);
        await frames();
        const bb = bar(dt)!;
        const boxes = [...bb.querySelectorAll<HTMLElement>('button')].filter((x) => !x.hidden && !x.closest('[hidden]'))
          .map((x) => ({ key: x.dataset.key ?? '?', r: x.getBoundingClientRect() }));
        const br = bb.getBoundingClientRect();
        const outside = boxes.filter((x) => x.r.left < br.left - 0.5 || x.r.right > br.right + 0.5).map((x) => x.key);
        const clash = boxes.flatMap((a, i) => boxes.slice(i + 1)
          .filter((c) => a.r.left < c.r.right - 0.5 && c.r.left < a.r.right - 0.5 && a.r.top < c.r.bottom - 0.5 && c.r.top < a.r.bottom - 0.5)
          .map((c) => `${a.key}×${c.key}`));
        const table = sr(dt).querySelector('b-table')!.getBoundingClientRect();
        check(`at 290px with "Select all" shown, every control is inside the bar, none overlap, the bar is inside the table (${boxes.map((x) => x.key).join(',')}; outside: ${outside.join(',') || 'none'}; clash: ${clash.join(',') || 'none'}; bar ${Math.round(br.left)}–${Math.round(br.right)}, table ${Math.round(table.left)}–${Math.round(table.right)})`,
          outside.length === 0 && clash.length === 0 && bb.scrollWidth <= bb.clientWidth + 1 && br.left >= table.left - 0.5 && br.right <= table.right + 0.5
          && boxes.some((x) => x.key === 'clear') && boxes.some((x) => x.key.startsWith('a:')));
        const room = parseFloat(getComputedStyle(sr(dt).querySelector('b-table')!).marginBottom);
        check(`…and the room under the last row covers the taller, wrapped bar (${room}px for ${Math.round(br.height)}px)`, room >= br.height);
        const info = sr(dt).querySelector('b-pagination')!.shadowRoot!.querySelector<HTMLElement>('.info')!;
        const lineH = parseFloat(getComputedStyle(info).lineHeight) || 20;
        check(`…and "${info.textContent?.trim()}" stays on one line (${Math.round(info.getBoundingClientRect().height)}px, a line is ${Math.round(lineH)}px)`,
          info.getBoundingClientRect().height < lineH * 1.5);
        host.style.width = '900px';
        await sleep(80);
        await frames();
      }
      link!.click();
      await frames();
      check(`client-paged it selects every row's id (${dt.getSelected().length}, allMatching ${dt.isAllMatching()})`, dt.getSelected().length === 24 && !dt.isAllMatching());
      bar(dt)!.querySelector<HTMLButtonElement>('.bulk-btn[data-bulk="publish"]')!.click();
      check(`the event carries all 24 ids (${events.at(-1)?.selected.length})`, events.at(-1)?.selected.length === 24 && !events.at(-1)?.allMatching);
    }

    // ── 9. Select all matching, server-paged: a flag with the filters, not ids ──
    {
      dt = await mount(true, 248);
      await tickPage(dt);
      bar(dt)!.querySelector<HTMLButtonElement>('[data-select-all]')!.click();
      await frames();
      check(`server-paged it selects all 248 by flag (count ${bar(dt)!.querySelector('.bulk-count strong')?.textContent}, allMatching ${dt.isAllMatching()})`,
        dt.isAllMatching() && bar(dt)!.querySelector('.bulk-count strong')?.textContent === '248');
      bar(dt)!.querySelector<HTMLButtonElement>('.bulk-btn[data-bulk="publish"]')!.click();
      const d = events.at(-1)!;
      check(`the event says allMatching with the filters and count (${JSON.stringify({ allMatching: d.allMatching, count: d.count, filters: d.filters })})`,
        d.allMatching === true && d.count === 248 && !!d.filters && d.selected.length === 8);
      bar(dt)!.querySelector<HTMLButtonElement>('[data-only-page]')!.click();
      await frames();
      check(`"Only the selected" goes back to the ticked rows (${bar(dt)!.querySelector('.bulk-count strong')?.textContent})`,
        !dt.isAllMatching() && bar(dt)!.querySelector('.bulk-count strong')?.textContent === '8');
      await tick(dt, 0);
      check('any change to the ticks drops "all matching"', !dt.isAllMatching());
    }

    // ── 9b. The user's report, walking the Playground: tick 2, ×, tick another — the ticks stayed on screen, and the
    // table grew laggy. Every re-render added another set of change listeners to the checkboxes the morph kept, so a
    // click ran its handler 2, 4, 8… times, each re-rendering again; and × never unticked a box the user had ticked
    // (the morph drops the attribute, the property stays). Real clicks, several rounds.
    {
      dt = await mount();
      let fired = 0;
      dt.addEventListener('selection-change', () => fired++);
      const boxes = () => [...tableSr(dt).querySelectorAll<HTMLInputElement>('.row-select')];
      const click = async (i: number) => { const before = fired; boxes()[i].click(); await frames(); await sleep(20); return fired - before; };
      const perClick: number[] = [];
      const stale: number[] = [];
      const counts: string[] = [];
      for (let round = 0; round < 5; round++) {
        perClick.push(await click(0), await click(2));
        bar(dt)!.querySelector<HTMLButtonElement>('[data-clear]')!.click();
        await frames();
        await sleep(20);
        stale.push(boxes().filter((b) => b.checked).length);
        perClick.push(await click(4));
        counts.push(`${bar(dt)?.querySelector('.bulk-count strong')?.textContent}/${boxes().filter((b) => b.checked).length}`);
        bar(dt)!.querySelector<HTMLButtonElement>('[data-clear]')!.click();
        await frames();
      }
      check(`× unticks every box on screen, every round (still ticked after ×: ${stale.join(',')})`, stale.every((n) => n === 0));
      check(`after ×, ticking one shows 1 selected and one tick (count/ticks: ${counts.join(' ')})`, counts.every((c) => c === '1/1'));
      check(`each click fires one selection-change, however many rounds (${perClick.join(',')})`, perClick.every((n) => n === 1));
    }

    // ── 10. Without the opt-in, no "select all matching" ──
    {
      dt = await mount(false, 248, false);
      await tickPage(dt);
      check('without selectAllMatching the link is not offered', !!bar(dt) && !bar(dt)!.querySelector('[data-select-all]'));
    }

    // ── 11. Long translations on a phone (the user's question, measured in Chrome with Slovak at 390px) ──
    {
      const slovak = {
        labels: { selected: 'vybraných produktov', selectAllMatching: 'Vybrať všetkých {count} zodpovedajúcich produktov', clearSelection: 'Zrušiť výber', moreActions: 'Ďalšie akcie' },
        bulkActions: [
          { id: 'publish', label: 'Zverejniť na e-shope a vo všetkých predajných kanáloch', variant: 'primary' as const },
          { id: 'unpublish', label: 'Skryť z e-shopu' },
          { id: 'delete', label: 'Odstrániť', variant: 'danger' as const },
        ],
      };
      dt = await mount(false, 248, true, slovak);
      host.style.width = '290px';
      await tickPage(dt);
      await sleep(80);
      await frames();
      const bb = bar(dt)!;
      const br = bb.getBoundingClientRect();
      const parts = [...bb.querySelectorAll<HTMLElement>('button, .bulk-count')].filter((x) => !x.hidden && !x.closest('[hidden]'))
        .map((x) => ({ key: x.dataset.key ?? x.className, r: x.getBoundingClientRect() }));
      const outside = parts.filter((x) => x.r.left < br.left - 0.5 || x.r.right > br.right + 0.5).map((x) => x.key);
      const clash = parts.flatMap((a, i) => parts.slice(i + 1)
        .filter((c) => a.r.left < c.r.right - 0.5 && c.r.left < a.r.right - 0.5 && a.r.top < c.r.bottom - 0.5 && c.r.top < a.r.bottom - 0.5)
        .map((c) => `${a.key}×${c.key}`));
      check(`long Slovak labels at 290px: nothing past the bar, nothing overlapping (outside: ${outside.join(',') || 'none'}; clash: ${clash.join(',') || 'none'}; bar ${bb.scrollWidth}/${bb.clientWidth})`,
        outside.length === 0 && clash.length === 0 && bb.scrollWidth <= bb.clientWidth + 1);
      const link = bb.querySelector<HTMLElement>('[data-select-all]')!;
      check(`…the select-all link is shown whole, wrapped if need be ("${link.textContent}")`,
        link.textContent === 'Vybrať všetkých 24 zodpovedajúcich produktov' && link.scrollWidth <= link.clientWidth + 1);
      const first = inline(dt)[0];
      check(`…a too-long action keeps its full name for assistive tech and a tooltip (${first.title === first.textContent ? 'title = text' : 'title missing'})`,
        first.dataset.bulk === 'publish' && first.textContent === 'Zverejniť na e-shope a vo všetkých predajných kanáloch' && first.title === first.textContent);
      host.style.width = '900px';
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();
  // tree-sort-smoke moves focus; it waits for this suite's confirm dialog to be gone.
  (window as unknown as Record<string, boolean>).__bulkBarSmokeDone = true;

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] bulk-bar-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] bulk-bar-smoke ${r}`);
})();
