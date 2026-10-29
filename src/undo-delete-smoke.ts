// TASK-545 — a reversible delete can offer Undo instead of a confirm dialog. Two halves:
//   1. b-toast takes an action: a real <button> beside the message, inside the live region, translatable, that
//      dismisses the toast and runs the callback; and no toast disappears while it is hovered or holds focus.
//   2. base-crud-page's `deleteMode: 'undo'`: delete at once, the row leaves, Undo calls the page's own
//      restoreDeleted. Opting in without one throws at connect; a failed restore says so and restores nothing.
// The pages run against a fake ApiClient over an in-memory row list, so "the row left" / "the row is back" are read
// off the rendered table, not off a flag.
import 'birko-web-components/data';
import 'birko-web-components/layout';
import { toast, type BToastItem } from 'birko-web-components/feedback';
import { BaseListPage } from 'birko-web-shell';
import type { ApiClient, ApiResponse } from 'birko-web-core/http';
import type { TableColumn } from 'birko-web-components/data';
import type { FormSchema } from 'birko-web-components/inputs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};

type Row = { id: string; name: string } & Record<string, unknown>;
const ok = <T,>(data: T, status = 200): ApiResponse<T> => ({ ok: true, status, data, headers: new Headers() });
const fail = (status: number, message: string): ApiResponse => ({ ok: false, status, data: { detail: message }, headers: new Headers() });

/** An ApiClient over a soft-deleting in-memory table — only what the list page and the table call. */
class FakeApi {
  live: Row[] = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }];
  trash: Row[] = [];
  deletes: string[] = [];
  restores: string[] = [];
  failRestore = false;
  throwRestore = false;
  async get(): Promise<ApiResponse> { return ok(this.live.map((r) => ({ ...r }))); }
  async delete(path: string): Promise<ApiResponse> {
    const id = path.split('/').pop()!;
    this.deletes.push(id);
    const i = this.live.findIndex((r) => r.id === id);
    if (i < 0) return fail(404, 'not found');
    this.trash.push(...this.live.splice(i, 1));
    return ok(null, 204);
  }
  async restore(id: string): Promise<ApiResponse> {
    this.restores.push(id);
    if (this.throwRestore) throw new Error('network down');
    if (this.failRestore) return fail(409, 'Restore refused by the server');
    const i = this.trash.findIndex((r) => r.id === id);
    if (i < 0) return fail(404, 'not in trash');
    this.live.push(...this.trash.splice(i, 1));
    return ok(null);
  }
}

const COLUMNS: TableColumn[] = [{ key: 'name', label: 'Name' }];

abstract class UdPage extends BaseListPage<Row> {
  fake = new FakeApi();
  protected endpoint = 'api/ud-items';
  protected entityLabel = 'Item';
  protected get api() { return this.fake as unknown as ApiClient; }
  protected get columns() { return COLUMNS; }
  protected get formSchema(): FormSchema { return { name: 'ud', children: [] }; }
  protected get pageTitle() { return 'Undo delete'; }
}
class UdConfirm extends UdPage {}
class UdUndo extends UdPage {
  protected deleteMode = 'undo' as const;
  protected restoreDeleted(id: string) { return this.fake.restore(id); }
}
class UdUndoNoRestore extends UdPage {
  protected deleteMode = 'undo' as const;
}
customElements.define('ud-confirm', UdConfirm);
customElements.define('ud-undo', UdUndo);
customElements.define('ud-undo-no-restore', UdUndoNoRestore);

void (async () => {
  const results: string[] = [];
  const check = (name: string, pass: boolean) => results.push(`${pass ? 'PASS' : 'FAIL'} ${name}`);

  // Toasts the base page shows are found through the real container, newest last.
  const toasts = () => [...document.querySelectorAll<BToastItem>('#b-toast-system b-toast-item')]
    .filter((t) => !t.classList.contains('fade-out'));
  const lastToast = () => toasts().at(-1) ?? null;
  const msgOf = (t: BToastItem | null) => t?.shadowRoot?.querySelector('.msg')?.textContent ?? '';
  const actionOf = (t: BToastItem | null) => t?.shadowRoot?.querySelector<HTMLButtonElement>('.action') ?? null;
  const clearToasts = () => document.querySelectorAll('b-toast-item').forEach((t) => t.remove());

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px';
  document.body.appendChild(host);

  try {
    // ── 1. The toast action ──
    {
      let clicks = 0;
      const t = toast.show('Thing deleted', 'success', undefined, { action: { onClick: () => { clicks++; } } });
      await waitFor(() => !!actionOf(t));
      const btn = actionOf(t);
      check('show() returns the toast item', t instanceof HTMLElement && t.localName === 'b-toast-item');
      check('the action renders as a real <button type="button">', btn?.localName === 'button' && btn.type === 'button');
      check(`the default label is "Undo" (got "${btn?.textContent}")`, btn?.textContent === 'Undo');
      const live = t.shadowRoot?.querySelector('[role="status"]');
      check('the action sits inside the toast\'s live region, so the announcement carries it', !!live && live.contains(btn));
      check('the action follows the message', btn?.previousElementSibling?.classList.contains('msg') === true);
      await waitFor(() => false, 30); // let onUpdated wire the click
      btn?.click();
      await sleep(10);
      check(`a click runs the callback once (clicks: ${clicks})`, clicks === 1);
      check('a click dismisses the toast', t.classList.contains('fade-out'));
      await sleep(350);
      check('the dismissed toast is removed', !t.isConnected);
    }
    {
      const t = toast.show('Plain', 'info', 200);
      check('a toast without an action renders no action button', !actionOf(t));
      await waitFor(() => !t.isConnected || t.classList.contains('fade-out'), 3000);
      check('a toast still dismisses itself after its duration', !t.isConnected || t.classList.contains('fade-out'));
    }
    {
      const t = toast.show('Custom', 'info', undefined, { action: { label: '<b>Bring back</b>', onClick: () => {} } });
      const btn = actionOf(t);
      check(`a caller's label is used, escaped (got "${btn?.textContent}")`, btn?.textContent === '<b>Bring back</b>' && !btn?.querySelector('b'));
      t.remove();
    }
    {
      let ran = false;
      const t = toast.notify('Notified', { href: '#/never', action: { label: 'Act', onClick: () => { ran = true; } } });
      const before = location.hash;
      await sleep(30);
      actionOf(t)?.click();
      await sleep(10);
      check('notify() takes an action too, and it runs', ran);
      check('the action click does not follow the toast\'s href', location.hash === before);
      t.remove();
    }
    {
      // A throwing callback is reported, never swallowed, and still dismisses.
      const errs: unknown[] = [];
      const realErr = console.error;
      console.error = (...a: unknown[]) => { errs.push(a[0]); };
      const t = toast.show('Throws', 'info', undefined, { action: { onClick: () => { throw new Error('boom'); } } });
      await sleep(30);
      actionOf(t)?.click();
      await sleep(20);
      console.error = realErr;
      check(`a throwing action is reported on console.error (got: ${String(errs[0])})`, errs.some((e) => String(e).includes('b-toast')));
      check('a throwing action still dismisses', t.classList.contains('fade-out'));
    }

    // ── 2. No toast disappears under the pointer or focus ──
    {
      // Dispatched, not real focus: focus is page-global and the concurrent suites move it, which would end the
      // hold at a random moment. Real focus and real hover are driven in keyboard-check.mjs, where nothing competes.
      const t = toast.show('Hold on focus', 'info', 300, { action: { onClick: () => {} } });
      await sleep(30);
      actionOf(t)!.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
      await sleep(600);
      check('a toast whose action holds focus outlives its duration', t.isConnected && !t.classList.contains('fade-out'));
      actionOf(t)!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
      await sleep(400);
      check('it stays at least 1 s after focus leaves', t.isConnected && !t.classList.contains('fade-out'));
      await sleep(1100);
      check('then it dismisses', !t.isConnected || t.classList.contains('fade-out'));
    }
    {
      const t = toast.show('Hold on hover', 'info', 300);
      t.dispatchEvent(new PointerEvent('pointerenter'));
      await sleep(600);
      check('a hovered toast outlives its duration', t.isConnected && !t.classList.contains('fade-out'));
      t.dispatchEvent(new PointerEvent('pointerleave'));
      await sleep(1500);
      check('it dismisses after the pointer leaves', !t.isConnected || t.classList.contains('fade-out'));
    }
    {
      const t = toast.show('Default with action', 'info', undefined, { action: { onClick: () => {} } });
      await sleep(4500);
      check('an action toast outlives the plain 4 s default', t.isConnected && !t.classList.contains('fade-out'));
      t.remove();
    }
    clearToasts();

    // ── 3. Default mode is unchanged: the confirm dialog, and nothing deleted until it is answered ──
    const mount = async <P extends UdPage>(tag: string): Promise<P> => {
      const el = document.createElement(tag) as P;
      host.appendChild(el);
      await waitFor(() => tableText(el).includes('Alpha'));
      return el;
    };
    const table = (p: UdPage) => p.shadowRoot!.querySelector('#table') as HTMLElement;
    /** Text of the table including its nested shadow roots (the rows live in <b-table> inside <b-data-table>). */
    const deepText = (n: Node | null | undefined): string => {
      if (!n) return '';
      let out = n.nodeType === Node.TEXT_NODE ? n.textContent ?? '' : '';
      if (n instanceof Element && n.shadowRoot) out += deepText(n.shadowRoot);
      for (const c of n.childNodes) out += deepText(c);
      return out;
    };
    const tableText = (p: UdPage) => deepText(table(p));
    const deleteRow = (p: UdPage, id: string) =>
      table(p).dispatchEvent(new CustomEvent('row-action', { detail: { action: 'delete', id, row: { id } } }));

    {
      const page = await mount<UdConfirm>('ud-confirm');
      check('precondition: the confirm page lists Alpha', tableText(page).includes('Alpha'));
      deleteRow(page, 'a');
      const confirm = page.shadowRoot!.querySelector('#confirm') as HTMLElement & { _answer(v: boolean): void };
      const dlg = () => confirm.shadowRoot?.querySelector<HTMLDialogElement>('#dlg');
      await waitFor(() => dlg()?.open === true);
      check('confirm mode (the default) opens the confirm dialog', dlg()?.open === true);
      check('nothing is deleted before the dialog is answered', page.fake.deletes.length === 0);
      confirm._answer(false);
      await sleep(50);
      check('cancelling deletes nothing', page.fake.deletes.length === 0 && tableText(page).includes('Alpha'));
      deleteRow(page, 'a');
      await waitFor(() => dlg()?.open === true);
      confirm._answer(true);
      await waitFor(() => !tableText(page).includes('Alpha'));
      check('confirming deletes the row', page.fake.deletes.join() === 'a' && !tableText(page).includes('Alpha'));
      check('confirm mode offers no Undo', !actionOf(lastToast()));
      page.remove();
      clearToasts();
    }

    // ── 4. Undo mode: delete at once, the row leaves, Undo brings it back from the server ──
    {
      const page = await mount<UdUndo>('ud-undo');
      deleteRow(page, 'a');
      await waitFor(() => !tableText(page).includes('Alpha'));
      const confirm = page.shadowRoot!.querySelector('#confirm');
      check('undo mode deletes at once, with no dialog', page.fake.deletes.join() === 'a'
        && confirm?.shadowRoot?.querySelector<HTMLDialogElement>('#dlg')?.open !== true);
      check('the row leaves the view', !tableText(page).includes('Alpha') && tableText(page).includes('Bravo'));
      const t = lastToast();
      check(`the toast says it was deleted (got "${msgOf(t)}")`, msgOf(t) === 'Item deleted');
      check('the toast offers Undo', actionOf(t)?.textContent === 'Undo');
      await sleep(30);
      actionOf(t)!.click();
      await waitFor(() => tableText(page).includes('Alpha'));
      check('Undo calls the page\'s restoreDeleted with the id', page.fake.restores.join() === 'a');
      check('the row is back, read from the server', tableText(page).includes('Alpha') && page.fake.live.some((r) => r.id === 'a'));
      check(`a restored toast follows (got "${msgOf(lastToast())}")`, msgOf(lastToast()) === 'Item restored');
      clearToasts();

      // A refused restore: an error toast, and the row does not come back.
      page.fake.failRestore = true;
      deleteRow(page, 'b');
      await waitFor(() => !tableText(page).includes('Bravo'));
      await sleep(30);
      actionOf(lastToast())!.click();
      await waitFor(() => msgOf(lastToast()).includes('Restore refused'));
      check(`a failed restore shows the server's error (got "${msgOf(lastToast())}")`, msgOf(lastToast()).includes('Restore refused'));
      check('the error toast is an error', lastToast()?.getAttribute('variant') === 'error');
      await sleep(100);
      check('after a failed restore the row stays gone', !tableText(page).includes('Bravo'));
      clearToasts();

      // A restore that throws is reported the same way.
      page.fake.failRestore = false;
      page.fake.throwRestore = true;
      deleteRow(page, 'a');
      await waitFor(() => !tableText(page).includes('Alpha'));
      await sleep(30);
      actionOf(lastToast())!.click();
      await waitFor(() => msgOf(lastToast()).includes('network down'));
      check(`a throwing restore shows an error toast (got "${msgOf(lastToast())}")`, msgOf(lastToast()).includes('network down')
        && lastToast()?.getAttribute('variant') === 'error');
      check('after a throwing restore the row stays gone', !tableText(page).includes('Alpha'));
      page.remove();
      clearToasts();
    }

    // ── 5. Opting in without a restore fails loudly, at connect ──
    {
      const el = document.createElement('ud-undo-no-restore') as UdPage & { connectedCallback(): Promise<void> };
      let threw: unknown = null;
      try { await el.connectedCallback(); } catch (e) { threw = e; }
      check(`deleteMode 'undo' without restoreDeleted throws (got: ${(threw as Error)?.message ?? 'nothing'})`,
        threw instanceof Error && /restoreDeleted/.test(threw.message));
      check('nothing was rendered for it', !el.shadowRoot?.querySelector('#table'));
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();
  clearToasts();
  // toast-modal-smoke opens a modal, which takes the toast container out of reach of the #b-toast-system query above.
  (window as unknown as Record<string, boolean>).__undoDeleteSmokeDone = true;

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] undo-delete-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] undo-delete-smoke ${r}`);
})();
