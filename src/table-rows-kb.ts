// TASK-978 — fixtures for table-rows-keyboard-check.mjs (loaded on /?rows=1 only). A table row could be opened only by
// a mouse click, so a split page's detail (with its Delete) was out of a keyboard user's reach. The check drives these
// with trusted keys: a split page in undo mode laid out like Symbio's HR Positions, a list page that opens rows and
// one that does not, and a selectable data table.
import 'birko-web-components/data';
import type { BDataTable, TableColumn } from 'birko-web-components/data';
import { BaseListPage, BaseSplitPage } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { FormSchema } from 'birko-web-components/inputs';

type Row = { id: string; name: string } & Record<string, unknown>;
const ok = (data: unknown): ApiResponse => ({ ok: true, status: 200, data, headers: new Headers() });

/** An in-memory soft-deleting endpoint: `GET api/x` lists, `GET api/x/{id}` reads one. */
export class RowsApi {
  live: Row[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' }];
  trash: Row[] = [];
  async get(path: string) {
    const parts = path.split('?')[0].split('/');
    if (parts.length > 2) {
      const row = this.live.find((r) => r.id === parts[2]);
      return row ? ok({ ...row }) : { ok: false, status: 404, data: null, headers: new Headers() } as ApiResponse;
    }
    return ok(this.live.map((r) => ({ ...r })));
  }
  async delete(path: string) {
    const id = path.split('/').pop()!;
    this.trash.push(...this.live.filter((r) => r.id === id));
    this.live = this.live.filter((r) => r.id !== id);
    return ok(null);
  }
  async restore(id: string) {
    this.live.push(...this.trash.filter((r) => r.id === id));
    this.trash = this.trash.filter((r) => r.id !== id);
    return ok(null);
  }
}

const COLUMNS: TableColumn[] = [{ key: 'name', label: 'Name', sortable: true }];
const SCHEMA: FormSchema = { name: 'rows', children: [] };

class RowsSplitPage extends BaseSplitPage<Row> {
  fake = new RowsApi();
  protected endpoint = 'api/rows-split';
  protected deleteMode = 'undo' as const;
  protected get api() { return this.fake as unknown as ApiClient; }
  protected get columns() { return COLUMNS; }
  protected get formSchema() { return SCHEMA; }
  protected get pageTitle() { return 'Rows: split'; }
  protected renderDetail(e: Row) { return `<p class="detail-name">${e.name}</p>`; }
  protected restoreDeleted(id: string) { return this.fake.restore(id); }
}
customElements.define('rows-split-page', RowsSplitPage);

class RowsOpenListPage extends BaseListPage<Row> {
  fake = new RowsApi();
  opened: string[] = [];
  protected endpoint = 'api/rows-open';
  protected get api() { return this.fake as unknown as ApiClient; }
  protected get columns() { return COLUMNS; }
  protected get formSchema() { return SCHEMA; }
  protected get pageTitle() { return 'Rows: list that opens rows'; }
  protected onRowClick(id: string) { this.opened.push(id); }
}
customElements.define('rows-open-list-page', RowsOpenListPage);

class RowsPlainListPage extends BaseListPage<Row> {
  fake = new RowsApi();
  protected endpoint = 'api/rows-plain';
  protected get api() { return this.fake as unknown as ApiClient; }
  protected get columns() { return COLUMNS; }
  protected get formSchema() { return SCHEMA; }
  protected get pageTitle() { return 'Rows: list that opens nothing'; }
}
customElements.define('rows-plain-list-page', RowsPlainListPage);

/** A selectable data table that also opens rows: Space must toggle the row's checkbox, Enter open the row. */
async function mountSelectable(host: HTMLElement): Promise<{ table: BDataTable; opened: string[] }> {
  const table = document.createElement('b-data-table') as BDataTable;
  table.id = 'rows-selectable';
  host.appendChild(table);
  const opened: string[] = [];
  table.addEventListener('row-click', (e) => opened.push((e as CustomEvent).detail.id));
  table.setConfig({ endpoint: 'api/rows-sel', apiClient: new RowsApi() as unknown as ApiClient, columns: COLUMNS,
    flatArray: true, selectable: true, clickableRows: true });
  await table.load();
  return { table, opened };
}

(window as unknown as Record<string, unknown>).__rowsKb = { mountSelectable };

// /?rows=show — the split page on screen, for a person to try with the keyboard (TASK-978's human test).
if (new URLSearchParams(location.search).get('rows') === 'show') {
  const box = document.createElement('section');
  box.style.cssText = 'padding:16px;border-bottom:2px solid var(--b-border);background:var(--b-bg)';
  box.innerHTML = '<p style="margin:0 0 8px">TASK-978 test page: Tab into the table, ↑/↓ between rows, Enter opens the detail, '
    + 'then Tab to Delete, Enter, and Enter on Undo.</p><rows-split-page></rows-split-page>';
  document.body.prepend(box);
}
