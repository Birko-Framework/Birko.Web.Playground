// TASK-545 — fixtures for keyboard-check.mjs (loaded on /?kb=1 only). Trusted input needs a page to drive: the toast
// manager on window, and an undo-mode list page over an in-memory soft-deleting table.
import 'birko-web-components/data';
import { toast } from 'birko-web-components/feedback';
import { BaseListPage } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { TableColumn } from 'birko-web-components/data';
import type { FormSchema } from 'birko-web-components/inputs';

type Row = { id: string; name: string } & Record<string, unknown>;
const ok = (data: unknown): ApiResponse => ({ ok: true, status: 200, data, headers: new Headers() });

class KbApi {
  live: Row[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }];
  trash: Row[] = [];
  async get() { return ok(this.live.map((r) => ({ ...r }))); }
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

class UdKbPage extends BaseListPage<Row> {
  fake = new KbApi();
  protected endpoint = 'api/kb-items';
  protected deleteMode = 'undo' as const;
  protected get api() { return this.fake as unknown as ApiClient; }
  protected get columns(): TableColumn[] { return [{ key: 'name', label: 'Name' }]; }
  protected get formSchema(): FormSchema { return { name: 'kb', children: [] }; }
  protected get pageTitle() { return 'Undo delete (keyboard)'; }
  protected restoreDeleted(id: string) { return this.fake.restore(id); }
  /** What the table emits when its Delete row action is chosen. */
  deleteRow(id: string) {
    this.shadowRoot!.querySelector('#table')!.dispatchEvent(
      new CustomEvent('row-action', { detail: { action: 'delete', id, row: { id } } }));
  }
}
customElements.define('ud-kb-page', UdKbPage);

(window as unknown as { __kbToast: typeof toast }).__kbToast = toast;
