// TASK-552 — b-editable-table re-rendered setData() and a row removal through the DOM morph, which syncs the
// `value` / `checked` / `selected` ATTRIBUTES but leaves a control the user has typed in on its own dirty value.
// The table's data was right and the screen was wrong, and the next keystroke wrote into a row the user was not
// looking at. Each check types into cells first (that is what makes a control dirty), then changes the rows.
import type { BEditableTable } from 'birko-web-components/data';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = Record<string, unknown>;

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const table = document.createElement('b-editable-table') as BEditableTable;
  table.style.cssText = 'position:absolute;left:-10000px;width:600px';
  document.body.appendChild(table);

  const cell = (idx: number, key: string) =>
    table.shadowRoot!.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-idx="${idx}"][data-key="${key}"]`)!;
  const type = (idx: number, key: string, value: string) => {
    const el = cell(idx, key);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pick = (idx: number, key: string, value: string) => {
    const el = cell(idx, key);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const tick = (idx: number, key: string, checked: boolean) => {
    const el = cell(idx, key);
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const shown = (idx: number) => ({
    url: cell(idx, 'url').value,
    qty: cell(idx, 'qty').value,
    fit: cell(idx, 'fit').value,
    on: cell(idx, 'on').checked,
  });
  const expect = (idx: number, row: Row) => ({
    url: String(row.url ?? ''),
    qty: row.qty === null || row.qty === undefined ? '' : String(row.qty),
    fit: String(row.fit),
    on: Boolean(row.on),
  });
  const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
  const showsData = (label: string) => {
    const data = table.getData();
    data.forEach((row, idx) => {
      const s = shown(idx);
      const e = expect(idx, row);
      check(`${label}: row ${idx} shows its data (shown ${JSON.stringify(s)}, data ${JSON.stringify(e)})`, same(s, e));
    });
  };

  try {
    await sleep(0);
    table.setConfig({
      columns: [
        { key: 'url', label: 'URL', type: 'text' },
        { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'fit', label: 'Fit', type: 'select', options: [{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }] },
        { key: 'on', label: 'On', type: 'checkbox' },
      ],
    });

    // 1 — the Symbio TASK-900 shape: type into two rows, swap them through getData → setData.
    table.setData([
      { url: '', qty: 1, fit: 'cover', on: false },
      { url: '', qty: 2, fit: 'cover', on: false },
    ]);
    type(0, 'url', '/media/tulips.png'); type(0, 'qty', '5'); pick(0, 'fit', 'contain'); tick(0, 'on', true);
    type(1, 'url', '/media/roses.png');  type(1, 'qty', '9');
    const rows = table.getData();
    table.setData([rows[1], rows[0]]);
    showsData('swap via setData');

    // 2 — a keystroke appends to what the cell SHOWS, so a stale cell overwrites the row's real value with it.
    type(0, 'url', cell(0, 'url').value + 'X');
    const after = table.getData();
    check(`a keystroke after setData edits the value on screen (row 0 url = ${String(after[0].url)})`, after[0].url === '/media/roses.pngX');
    check(`…and leaves the other row alone (row 1 url = ${String(after[1].url)})`, after[1].url === '/media/tulips.png');

    // 3 — setData with entirely new rows replaces every typed value, including clearing one.
    table.setData([{ url: 'a', qty: null, fit: 'cover', on: false }, { url: 'b', qty: 3, fit: 'contain', on: true }]);
    showsData('fresh setData');

    // 4 — the built-in remove button: type rows 0–2, remove row 1, row 1 must now show the old row 2.
    table.setData([
      { url: '', qty: 0, fit: 'cover', on: false },
      { url: '', qty: 0, fit: 'cover', on: false },
      { url: '', qty: 0, fit: 'cover', on: false },
    ]);
    type(0, 'url', 'first');  type(0, 'qty', '1');
    type(1, 'url', 'second'); type(1, 'qty', '2'); pick(1, 'fit', 'contain'); tick(1, 'on', true);
    type(2, 'url', 'third');  type(2, 'qty', '3');
    table.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="remove"][data-idx="1"]')!.click();
    const left = table.getData();
    check(`remove: data keeps rows 0 and 2 (${left.map((r) => r.url).join(', ')})`, left.length === 2 && left[0].url === 'first' && left[1].url === 'third');
    showsData('remove row 1');
    check(`remove: row 1's url cell shows 'third' (shows '${cell(1, 'url').value}')`, cell(1, 'url').value === 'third');
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  table.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] editable-table-sync-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] editable-table-sync-smoke ${r}`);
})();
