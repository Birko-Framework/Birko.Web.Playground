// TASK-744 (for Symbio TASK-955) — the base pages' "prerequisite missing" state is one overridable method,
// renderEmptyFilter(). The default must be exactly the markup the three pages inlined before; an override can put an
// action in b-empty's slot ("Create a building" on a tenant with no buildings).
import 'birko-web-components/data';
import 'birko-web-components/layout';
import 'birko-web-components/feedback';
import { BaseCrudPage, BaseListPage, BaseSplitPage } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { TableColumn } from 'birko-web-components/data';

type Row = { id: string; name: string } & Record<string, unknown>;
const api = { get: async (): Promise<ApiResponse> => ({ ok: true, status: 200, data: [], headers: new Headers() }) } as unknown as ApiClient;
const OLD = (message: string) => `<b-card><b-empty message="${message}"></b-empty></b-card>`;

class EfCrud extends BaseCrudPage<Row> {
  protected get api() { return api; }
  protected get requiredFilterSet() { return false; }
  protected get emptyFilterMessage() { return 'Pick a building first'; }
  protected get pageTitle() { return 'Crud'; }
  protected renderContent() { return '<p class="content">content</p>'; }
}
class EfList extends BaseListPage<Row> {
  protected endpoint = 'api/ef';
  protected get api() { return api; }
  protected get columns(): TableColumn[] { return [{ key: 'name', label: 'Name' }]; }
  protected get formSchema() { return null; }
  protected get requiredFilterSet() { return false; }
  protected get emptyFilterMessage() { return 'Pick a building first'; }
  protected get pageTitle() { return 'List'; }
}
class EfSplit extends BaseSplitPage<Row> {
  protected endpoint = 'api/ef';
  protected get api() { return api; }
  protected get columns(): TableColumn[] { return [{ key: 'name', label: 'Name' }]; }
  protected renderDetail(e: Row) { return `<p>${e.name}</p>`; }
  protected get requiredFilterSet() { return false; }
  protected get emptyFilterMessage() { return 'Pick a building first'; }
  protected get pageTitle() { return 'Split'; }
}
class EfAction extends EfList {
  protected renderEmptyFilter() {
    return `<b-card><b-empty message="${this.emptyFilterMessage}"><b-button class="create-building">Create a building</b-button></b-empty></b-card>`;
  }
}
class EfReady extends EfList {
  protected get requiredFilterSet() { return true; }
}
customElements.define('ef-crud', EfCrud);
customElements.define('ef-list', EfList);
customElements.define('ef-split', EfSplit);
customElements.define('ef-action', EfAction);
customElements.define('ef-ready', EfReady);

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px';
  document.body.appendChild(host);
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const mount = async (tag: string) => {
    const el = document.createElement(tag);
    host.appendChild(el);
    await settle();
    return el;
  };
  /** The page's empty-state card as markup, with what upgrade added to the elements' own attributes left out. */
  const emptyCard = (el: Element) => {
    const card = [...(el.shadowRoot?.querySelectorAll('b-card') ?? [])].find((c) => c.querySelector(':scope > b-empty'));
    if (!card) return null;
    const empty = card.querySelector(':scope > b-empty')!;
    return { card, empty, markup: `<b-card><b-empty message="${empty.getAttribute('message')}">${empty.innerHTML}</b-empty></b-card>` };
  };

  try {
    for (const tag of ['ef-crud', 'ef-list', 'ef-split']) {
      const el = await mount(tag);
      const page = el as unknown as { renderEmptyFilter(): string };
      check(`${tag}: renderEmptyFilter() is exactly the markup inlined before`, page.renderEmptyFilter() === OLD('Pick a building first'));
      const found = emptyCard(el);
      check(`${tag}: the page shows it (${found?.markup})`, found?.markup === OLD('Pick a building first'));
      check(`${tag}: and not its content`, !el.shadowRoot?.querySelector('.content, b-data-table, b-split-panel'));
      el.remove();
    }

    const ready = await mount('ef-ready');
    check('with the filter set, the empty state is not rendered', !emptyCard(ready));
    ready.remove();

    const el = await mount('ef-action');
    const found = emptyCard(el);
    const btn = found?.empty.querySelector<HTMLElement>('b-button.create-building');
    check('an override renders its action inside b-empty', !!btn && btn.textContent === 'Create a building');
    const slot = found?.empty.shadowRoot?.querySelector('slot');
    check('the action is slotted below the message (assigned to b-empty\'s slot)', !!slot && (slot as HTMLSlotElement).assignedElements().includes(btn!));
    let clicked = 0;
    btn?.addEventListener('click', () => clicked++);
    btn?.click();
    check('and it is clickable', clicked === 1);
    el.remove();
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] empty-filter-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] empty-filter-smoke ${r}`);
})();
