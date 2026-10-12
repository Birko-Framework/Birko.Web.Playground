// TASK-568 — b-modal kept keyboard focus pinned on its Close button. Its own Tab trap searched only the shadow
// tree, where the slotted content isn't, so the trap's list was [Close] and every Tab was cancelled back onto it;
// open()'s auto-focus searched the same tree and found nothing. The trap is gone (showModal() already keeps
// focus out of the page behind), and open() starts on the first slotted control. Real Tab presses can't be
// synthesised in-page, so this asserts the two things the old code got wrong: where open() puts focus, and
// whether a Tab keydown is cancelled.
import 'birko-web-components/layout';
import 'birko-web-components/inputs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};
/** The focused element, followed through open shadow roots. */
const deepActive = (): Element | null => {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};
type Modal = HTMLElement & { open(): void; close(): void };

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // SERIALISATION: an open modal makes the rest of the page inert, so it waits for the suites gallery-smoke
  // waits for, and for gallery-smoke itself (whose zoom is a modal too).
  {
    const flags = ['__inputAdornmentSmokeDone', '__backportSmokeDone', '__ribbonScalingSmokeDone', '__bareSmokeDone',
      '__pickerPopupSmokeDone', '__gallerySmokeDone'];
    const w = window as unknown as Record<string, boolean | undefined>;
    const pending = () => flags.filter((f) => w[f] !== true);
    const deadline = Date.now() + 120_000;
    while (pending().length && Date.now() < deadline) await sleep(50);
    check(`the suites a modal would disturb finished first (still running: ${pending().join(', ') || 'none'})`, pending().length === 0);
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:99995';
  document.body.prepend(host);

  const mount = async (body: string): Promise<{ modal: Modal; opener: HTMLButtonElement }> => {
    host.innerHTML = `<button id="mf-opener">Open</button><b-modal id="mf-modal" title="Focus test">${body}</b-modal>`;
    const modal = host.querySelector<Modal>('#mf-modal')!;
    const opener = host.querySelector<HTMLButtonElement>('#mf-opener')!;
    await waitFor(() => !!modal.shadowRoot?.querySelector('dialog'));
    opener.focus();
    return { modal, opener };
  };
  const openAndSettle = async (modal: Modal) => {
    modal.open();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(30);
  };

  try {
    // ── 1. Slotted link, b-input and b-button: open() starts on the link, and Tab is never cancelled ──
    {
      const { modal, opener } = await mount(`
        <div><a id="mf-link" href="#mf">A link</a></div>
        <b-input id="mf-input" label="Name"></b-input>
        <b-button id="mf-btn">Save</b-button>`);
      check('precondition: the opener holds focus before open()', document.activeElement === opener);
      await openAndSettle(modal);
      const active = deepActive();
      check(`open() focuses the first slotted control, not Close (got ${active?.tagName.toLowerCase()}${active?.id ? '#' + active.id : ''}${active?.className ? '.' + active.className : ''})`,
        active?.id === 'mf-link');

      const close = modal.shadowRoot!.querySelector<HTMLElement>('.close-btn')!;
      const lastBtn = host.querySelector('#mf-btn')!.shadowRoot!.querySelector<HTMLElement>('button')!;
      const tabCancelled = (target: HTMLElement, shift = false) => {
        target.focus();
        const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, composed: true, cancelable: true });
        target.dispatchEvent(e);
        return e.defaultPrevented;
      };
      check('a Tab on Close is not cancelled (the old trap cancelled it and refocused Close)', !tabCancelled(close));
      check('a Shift+Tab on Close is not cancelled', !tabCancelled(close, true));
      check('a Tab on the last slotted control is not cancelled', !tabCancelled(lastBtn));

      modal.close();
      await sleep(30);
      check('close() returns focus to the opener', document.activeElement === opener);
    }

    // ── 2. Disabled and hidden controls are skipped ──
    {
      const { modal } = await mount(`
        <button id="mf-disabled" disabled>Disabled</button>
        <button id="mf-hidden" hidden>Hidden</button>
        <div style="display:none"><button id="mf-none">Not displayed</button></div>
        <button id="mf-neg" tabindex="-1">Not in the tab order</button>
        <button id="mf-ok">Reachable</button>`);
      await openAndSettle(modal);
      check(`open() skips disabled, hidden and tabindex=-1 controls (got #${deepActive()?.id})`, deepActive()?.id === 'mf-ok');
      modal.close();
    }

    // ── 3. A footer-slot control is found when the body has none ──
    {
      const { modal } = await mount(`<p>Just text.</p><button slot="footer" id="mf-footer">OK</button>`);
      await openAndSettle(modal);
      check(`open() falls through to the footer slot (got #${deepActive()?.id})`, deepActive()?.id === 'mf-footer');
      modal.close();
    }

    // ── 4. A display: contents wrapper has no boxes, but its children render and are reachable ──
    {
      const { modal } = await mount(`<div style="display:contents"><button id="mf-contents">Inside</button></div>`);
      await openAndSettle(modal);
      check(`open() looks inside a display: contents wrapper (got #${deepActive()?.id})`, deepActive()?.id === 'mf-contents');
      modal.close();
    }

    // ── 5. Nothing focusable in the content: focus stays inside the dialog (native, on Close) ──
    {
      const { modal } = await mount(`<p>Only text here.</p>`);
      await openAndSettle(modal);
      const active = deepActive();
      check(`with no content control, focus is on Close (got ${active?.className || active?.tagName})`,
        !!active && active === modal.shadowRoot!.querySelector('.close-btn'));
      modal.close();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] modal-focus-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] modal-focus-smoke ${r}`);
})();
