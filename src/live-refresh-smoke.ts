// TASK-583 — an open BaseListPage reloads when the server announces a change to its entity type (Symbio TASK-898's
// `entity-changed` contract). Through a fake injected source and a fake API that counts list loads: a burst is one
// reload; other modules / types and malformed payloads are ignored; nothing reloads under an open create/edit modal
// until it closes; unmounting unsubscribes and cancels a pending reload; opting in without a source throws.
import 'birko-web-components/data';
import 'birko-web-components/layout';
import { BaseListPage, setEntityChangeSource, parseEntityChangedEvent } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { TableColumn } from 'birko-web-components/data';
import type { FormSchema } from 'birko-web-components/inputs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};

/** A fake `SseClient.on('entity-changed', …)`: handlers it holds, and a way to push payloads to them. */
const handlers = new Set<(payload: unknown) => void>();
const push = (payload: unknown) => handlers.forEach((h) => h(payload));
const event = (over: Record<string, unknown> = {}) =>
  ({ moduleId: 'wh', entityType: 'StockCard', entityGuid: 'g-1', kind: 'updated', ...over });

class CountingApi {
  loads = 0;
  async get(): Promise<ApiResponse> { this.loads++; return { ok: true, status: 200, data: [{ id: 'a', name: 'Alpha' }], headers: new Headers() }; }
}

class LrPage extends BaseListPage<{ id: string; name: string } & Record<string, unknown>> {
  fake = new CountingApi();
  protected endpoint = 'api/lr';
  protected liveRefresh = { moduleId: 'wh', entityType: 'StockCard', debounceMs: 100 };
  protected get api() { return this.fake as unknown as ApiClient; }
  protected get columns(): TableColumn[] { return [{ key: 'name', label: 'Name' }]; }
  protected get formSchema(): FormSchema { return { name: 'lr', children: [] }; }
  protected get pageTitle() { return 'Live refresh'; }
}
class LrOff extends LrPage {
  protected liveRefresh = undefined as never;
}
customElements.define('lr-page', LrPage);
customElements.define('lr-off', LrOff);

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px';
  document.body.appendChild(host);

  setEntityChangeSource((h) => { handlers.add(h); return () => handlers.delete(h); });

  const mount = async (tag = 'lr-page') => {
    const el = document.createElement(tag) as LrPage;
    host.appendChild(el);
    await waitFor(() => el.fake.loads >= 1);
    await sleep(50);
    return el;
  };

  try {
    // ── 0. The payload reader ──
    check('parse: an object is read', parseEntityChangedEvent(event())?.entityType === 'StockCard');
    check('parse: JSON text is read', parseEntityChangedEvent(JSON.stringify(event()))?.moduleId === 'wh');
    check('parse: entityGuid null is valid', parseEntityChangedEvent(event({ entityGuid: null }))?.entityGuid === null);
    for (const [name, bad] of [['null', null], ['a number', 7], ['bad JSON', '{x'], ['no moduleId', event({ moduleId: '' })],
      ['entityGuid a number', event({ entityGuid: 5 })], ['an unknown kind', event({ kind: 'renamed' })]] as const) {
      check(`parse: ${name} is null`, parseEntityChangedEvent(bad) === null);
    }

    // ── 1. A burst of matching events is one reload ──
    {
      const page = await mount();
      check(`one subscription while mounted (${handlers.size})`, handlers.size === 1);
      const before = page.fake.loads;
      for (let i = 0; i < 5; i++) { push(event({ entityGuid: `g-${i}` })); await sleep(10); }
      await sleep(300);
      check(`5 events in a burst → 1 reload (loads +${page.fake.loads - before})`, page.fake.loads - before === 1);

      // ── 2. Matching ──
      const b2 = page.fake.loads;
      push(event({ moduleId: 'other' }));
      push(event({ entityType: 'Other' }));
      push({ junk: true });
      push('not json');
      push(event({ kind: 'renamed' }));
      await sleep(300);
      check(`other module, other type and malformed payloads cause no reload (loads +${page.fake.loads - b2})`, page.fake.loads === b2);
      push(JSON.stringify(event({ entityGuid: null, kind: 'deleted' })));
      await sleep(300);
      check(`a bulk change (entityGuid null) as JSON text reloads (loads +${page.fake.loads - b2})`, page.fake.loads - b2 === 1);

      // ── 3. Not under an open modal: deferred to its close, once ──
      const modal = page.shadowRoot!.querySelector('#modal') as HTMLElement & { open(): void; close(): void };
      modal.open();
      const b3 = page.fake.loads;
      push(event());
      await sleep(250);
      push(event({ kind: 'created' }));
      await sleep(250);
      check(`no reload while the create/edit modal is open (loads +${page.fake.loads - b3})`, page.fake.loads === b3);
      modal.close();
      await waitFor(() => page.fake.loads > b3, 1000);
      await sleep(150);
      check(`closing the modal runs the deferred reload, once (loads +${page.fake.loads - b3})`, page.fake.loads - b3 === 1);
      const b4 = page.fake.loads;
      modal.open(); modal.close();
      await sleep(150);
      check('a later close with nothing pending does not reload', page.fake.loads === b4);

      // ── 4. Unmount: unsubscribed, and a reload already pending does not run ──
      push(event());
      page.remove();
      await sleep(300);
      check(`after unmount no handler is left (${handlers.size})`, handlers.size === 0);
      check(`a reload pending at unmount does not run (loads +${page.fake.loads - b4})`, page.fake.loads === b4);

      // Reconnect: one subscription again, not two.
      host.appendChild(page);
      await sleep(100);
      check(`reconnecting subscribes once (${handlers.size})`, handlers.size === 1);
      page.remove();
    }

    // ── 5. Off by default ──
    {
      const off = await mount('lr-off');
      check(`a page without liveRefresh does not subscribe (${handlers.size})`, handlers.size === 0);
      off.remove();
    }

    // ── 6. Opting in without a source fails loudly, at connect ──
    {
      setEntityChangeSource(null);
      const el = document.createElement('lr-page') as LrPage & { connectedCallback(): Promise<void> };
      let threw: unknown = null;
      try { await el.connectedCallback(); } catch (e) { threw = e; }
      check(`liveRefresh without a source throws (got: ${(threw as Error)?.message ?? 'nothing'})`,
        threw instanceof Error && /setEntityChangeSource/.test(threw.message));
      (el as unknown as { disconnectedCallback(): void }).disconnectedCallback();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  setEntityChangeSource(null);
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] live-refresh-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] live-refresh-smoke ${r}`);
})();
