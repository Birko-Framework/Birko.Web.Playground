// TASK-486 (moved from Symbio TASK-499) — `b-table` escapes header labels; `headerRender` is the
// HTML opt-in, and `b-data-table`'s select-all checkbox goes through it. Pins both halves of that
// asymmetry: an ordinary `label` stays escaped (no stored-XSS route), and `headerRender` produces a
// real element that selects and clears the page's rows.
import 'birko-web-components/data';
import type { DataTableConfig, TableColumn } from 'birko-web-components/data';

async function mount(tag: string): Promise<any> {
  const el = document.createElement(tag);
  // Off-screen rather than display:none — a hidden subtree skips layout, and the table queries nodes.
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. An ordinary `label` is still escaped — the XSS guard ──
    {
      const t = await mount('b-table');
      // Deliberately hostile: if this ever stops being escaped, this suite fails rather than a page.
      const cols: TableColumn[] = [{ key: 'name', label: '<b>Name</b><img src=x onerror="window.__pwned=1">' }];
      t.setColumns(cols);
      t.setData([{ name: 'ok' }]);
      await new Promise((r) => setTimeout(r, 0));
      const th: HTMLTableCellElement = t.shadowRoot!.querySelector('th')!;
      check('a plain label creates no elements', !th.querySelector('b, img'));
      check('...its angle brackets are visible text', (th.textContent ?? '').includes('<b>Name</b>'));
      check('...and it is escaped in the markup', th.innerHTML.includes('&lt;b&gt;'));
      check('...no script ran', !(window as any).__pwned);
      t.remove();
    }

    // ── 2. `headerRender` is the explicit HTML opt-in (the symmetric half) ──
    {
      const t = await mount('b-table');
      t.setColumns([{
        key: 'name',
        label: 'Name',
        headerRender: () => '<input type="checkbox" class="hdr-cb" aria-label="Pick" />',
      }]);
      t.setData([{ name: 'ok' }]);
      await new Promise((r) => setTimeout(r, 0));
      const th: HTMLTableCellElement = t.shadowRoot!.querySelector('th')!;
      check('headerRender emits a real element', !!th.querySelector('input.hdr-cb'));
      check('headerRender output is not also shown as text', !(th.textContent ?? '').includes('<input'));
      t.remove();
    }

    // ── 3. `b-data-table` selectable drives the select-all header through that opt-in ──
    {
      const rows = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
      const dt = await mount('b-data-table');
      const cfg: DataTableConfig = {
        endpoint: '/smoke/rows',
        columns: [{ key: 'name', label: 'Name' }],
        // A stub, not the network: this asserts the table's own wiring, not a server.
        apiClient: { get: async () => ({ ok: true, data: rows }) } as any,
        selectable: true,
        flatArray: true,
        idField: 'id',
        labels: { selectAll: 'Vybrať všetko' },
      };
      dt.setConfig(cfg);
      await dt.load();
      await frame(); await frame();

      const tableNow = () => dt.shadowRoot!.querySelector('b-table')!;
      const selectAllNow = () => tableNow().shadowRoot!.querySelector('input.select-all') as HTMLInputElement | null;

      const selectAll = selectAllNow();
      check('the header renders a real checkbox', !!selectAll);
      check('...with the localized accessible name',
        selectAll?.getAttribute('aria-label') === 'Vybrať všetko');
      check('...and the header shows no literal <input> text',
        !(tableNow().shadowRoot!.querySelector('thead')?.textContent ?? '').includes('<input'));
      check(`per-row checkboxes still render (${tableNow().shadowRoot!.querySelectorAll('input.row-select').length})`,
        tableNow().shadowRoot!.querySelectorAll('input.row-select').length === rows.length);

      const seen: Array<{ selected: string[]; count: number }> = [];
      dt.addEventListener('selection-change', (e: any) => seen.push(e.detail));

      // Select all — re-query after every interaction: the handler re-renders, so the old node is detached.
      selectAllNow()!.click();
      await frame(); await frame();
      check(`clicking select-all selects every page row (${dt.getSelected().length}/${rows.length})`,
        dt.getSelected().length === rows.length);
      check('...and emits selection-change with the count',
        seen.length > 0 && seen[seen.length - 1].count === rows.length);
      check('...the header checkbox reflects the all-selected state', selectAllNow()?.checked === true);

      // Clear all
      selectAllNow()!.click();
      await frame(); await frame();
      check('clicking select-all again clears the selection', dt.getSelected().length === 0);
      check('...and the header checkbox is unchecked', selectAllNow()?.checked === false);

      // Mixed state — the three-state affordance the human test plan calls a judgement, asserted.
      (tableNow().shadowRoot!.querySelector('input.row-select') as HTMLInputElement).click();
      await frame(); await frame();
      const hdr = selectAllNow()!;
      check('one row selected leaves the header indeterminate, not checked',
        hdr.indeterminate && !hdr.checked);
      dt.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] table-header-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] table-header-smoke ${r}`);
})();