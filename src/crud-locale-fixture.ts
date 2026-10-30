// Birko TASK-801 — a Shell list page whose entity name comes from t() through a getter, for locale-switch-check.mjs
// (loaded on /?crud=1 only). A locale switch must relabel the page heading and an open create modal's title.
import { t } from 'birko-web-core';
import { BaseListPage } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { TableColumn } from 'birko-web-components/data';
import type { FormSchema } from 'birko-web-components/inputs';

type Row = { id: string; name: string } & Record<string, unknown>;
const ok = (data: unknown): ApiResponse => ({ ok: true, status: 200, data, headers: new Headers() });

class CrudLocalePage extends BaseListPage<Row> {
  protected endpoint = 'api/crud-locale';
  protected override get entityLabel() { return t('pg.crud.entity', {}, 'Device'); }
  protected get api() { return { get: async () => ok([{ id: 'a', name: 'Alpha' }]) } as unknown as ApiClient; }
  protected get columns(): TableColumn[] { return [{ key: 'name', label: 'Name' }]; }
  protected get formSchema(): FormSchema {
    return { name: 'root', children: [{ name: 'name', type: 'text', label: t('pg.form.name', {}, 'Name') }] };
  }
  openCreate() { this._openCreate(); }
}
customElements.define('crud-locale-page', CrudLocalePage);
