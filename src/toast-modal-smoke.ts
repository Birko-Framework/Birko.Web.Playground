// Birko TASK-786 — a toast raised while a b-modal was open rendered BEHIND the modal and its backdrop. b-modal opens
// its <dialog> with showModal(), which puts it in the top layer and makes everything outside it inert; the toast
// container was a z-index'd div on <body>, which can never be drawn above the top layer, and was inert besides. A
// popover on <body> is drawn above the dialog but is STILL inert (measured in Chromium and Firefox: elementFromPoint
// passes through it, a real click does nothing, focus() is refused), so the container now moves into the newest open
// modal dialog and is shown as a popover there, and moves back to <body> when that dialog closes.
//
// toBeVisible() / a text check cannot see this defect: the covered toast is in the DOM, has a box and has its text.
// So every "on top" check below hit-tests the toast's centre, descending through shadow roots, and requires the hit
// to land in the toast. Hit testing skips inert nodes, so the same check also says the toast can take a click.
import 'birko-web-components/layout';
import { toast, type BToastItem } from 'birko-web-components/feedback';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};
type Modal = HTMLElement & { open(): void; close(): void };
type Confirm = HTMLElement & { show(): Promise<boolean> };

/** The element under (x, y), followed down through open shadow roots. */
const deepHit = (x: number, y: number): Element | null => {
  let el = document.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
};
/** What the hit test at the item's centre lands on, as a short name for the check's label. */
const hitAt = (item: BToastItem): { onTop: boolean; got: string } => {
  const r = item.getBoundingClientRect();
  const hit = deepHit(r.x + r.width / 2, r.y + r.height / 2);
  const onTop = !!hit && (hit === item || item.shadowRoot!.contains(hit));
  const got = hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}${hit.className ? '.' + String(hit.className).split(' ')[0] : ''}` : 'nothing';
  return { onTop, got };
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // SERIALISATION: an open modal makes the rest of the page inert, so wait for the suites modal-focus-smoke waits
  // for, and for modal-focus-smoke itself (whose modals would otherwise be the top one here). And for
  // undo-delete-smoke: while this suite's modal is open the shared toast container is inside it, out of reach of
  // that suite's document-level #b-toast-system query (measured: it failed "the toast offers Undo" on overlap).
  {
    const flags = ['__inputAdornmentSmokeDone', '__backportSmokeDone', '__ribbonScalingSmokeDone', '__bareSmokeDone',
      '__pickerPopupSmokeDone', '__gallerySmokeDone', '__modalFocusSmokeDone', '__undoDeleteSmokeDone'];
    const w = window as unknown as Record<string, boolean | undefined>;
    const pending = () => flags.filter((f) => w[f] !== true);
    const deadline = Date.now() + 120_000;
    while (pending().length && Date.now() < deadline) await sleep(50);
    check(`the suites a modal would disturb finished first (still running: ${pending().join(', ') || 'none'})`, pending().length === 0);
  }

  const host = document.createElement('div');
  document.body.append(host);
  host.innerHTML = `
    <b-modal id="tm-modal" title="Toast over modal"><p>Body text.</p><button id="tm-save">Save</button></b-modal>
    <b-confirm-dialog id="tm-confirm" title="Sure?" message="Nested"></b-confirm-dialog>`;
  const modal = host.querySelector<Modal>('#tm-modal')!;
  const confirmDlg = host.querySelector<Confirm>('#tm-confirm')!;
  const shown: BToastItem[] = [];
  const raise = (msg: string, withAction = false) => {
    const item = toast.show(msg, 'error', 60_000, withAction ? { action: { label: 'Retry', onClick: () => {} } } : {});
    shown.push(item);
    return item;
  };
  const container = () => document.getElementById('b-toast-system');

  try {
    await waitFor(() => !!modal.shadowRoot?.querySelector('dialog') && !!confirmDlg.shadowRoot?.querySelector('dialog'));

    // ── 1. No modal open: unchanged — on <body>, not a popover, on top ──
    {
      const item = raise('No modal');
      await frames();
      const c = container()!;
      check(`with no modal open the container is on <body> (parent ${c.parentElement?.tagName.toLowerCase()})`, c.parentElement === document.body);
      check('with no modal open the container is not a popover', !c.hasAttribute('popover'));
      const { onTop, got } = hitAt(item);
      check(`with no modal open the toast is on top (hit ${got})`, onTop);
      item.remove();
    }

    // ── 2. The defect: a toast raised while a b-modal is open is above the dialog and its backdrop ──
    modal.open();
    await frames();
    check('precondition: the b-modal is open as a modal', !!modal.shadowRoot!.querySelector('dialog')?.matches(':modal'));
    {
      const item = raise('Refused: choose a type', true);
      await frames();
      const { onTop, got } = hitAt(item);
      check(`a toast raised in an open modal is on top of it (hit ${got})`, onTop);
      const btn = item.shadowRoot!.querySelector<HTMLButtonElement>('.action')!;
      btn.focus();
      check('its action button can take focus (it is not inert)', item.shadowRoot!.activeElement === btn);
      const r = btn.getBoundingClientRect();
      const hit = deepHit(r.x + r.width / 2, r.y + r.height / 2);
      check(`a click on its action button lands on the button (hit ${hit?.tagName.toLowerCase()}.${hit?.className})`, hit === btn);
      check('the modal is still open after focusing the toast', !!modal.shadowRoot!.querySelector('dialog')?.open);
    }

    // ── 3. A modal stacked on the modal: the toast goes above the newest one ──
    {
      void confirmDlg.show();
      await frames();
      check('precondition: the confirm dialog is open as a modal', !!confirmDlg.shadowRoot!.querySelector('dialog')?.matches(':modal'));
      const item = raise('Over the confirm');
      await frames();
      const { onTop, got } = hitAt(item);
      check(`with two modals open the toast is above the newest (hit ${got})`, onTop);
      confirmDlg.shadowRoot!.querySelector<HTMLDialogElement>('dialog')!.close();
      await waitFor(() => !confirmDlg.shadowRoot!.querySelector('dialog')!.open);
      await sleep(30); // the dialog's close event is queued as a task
      await frames();
      const after = hitAt(item);
      check(`when the newest modal closes, its toast stays on top of the one below (hit ${after.got})`, after.onTop);
    }

    // ── 4. The modal closes: the toast raised inside it is still shown, on <body> again ──
    {
      const item = shown[shown.length - 1];
      modal.close();
      await sleep(30);
      await frames();
      const c = container()!;
      check(`after the modal closes the container is back on <body> (parent ${c.parentElement?.tagName.toLowerCase()})`, c.parentElement === document.body);
      check('after the modal closes the container is no longer a popover', !c.hasAttribute('popover'));
      const { onTop, got } = hitAt(item);
      check(`a toast raised in the modal is still shown after it closes (hit ${got})`, item.isConnected && onTop);
    }

    // ── 5. A toast already showing when a modal opens is not left behind it ──
    {
      const item = raise('Shown before the modal');
      modal.open();
      await frames();
      const { onTop, got } = hitAt(item);
      check(`a toast shown before the modal opened is on top of it (hit ${got})`, onTop);
      modal.close();
      await sleep(30);
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  shown.forEach((t) => t.remove());
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] toast-modal-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] toast-modal-smoke ${r}`);
})();
