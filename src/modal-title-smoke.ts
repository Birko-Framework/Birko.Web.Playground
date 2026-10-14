// TASK-580 — b-modal rendered its title as a <span>, so a heading a consumer put inside the dialog followed no heading
// (axe `heading-order`, Presenter TASK-025), and it interpolated the title as HTML. The title is now an <h2> (or
// `heading-level`), still names the dialog, looks as it did, is absent when there is no title, and is text.
// Nothing here opens a modal: the title is rendered into the closed <dialog>, so no other suite is made inert.
import 'birko-web-components/layout';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAYLOADS = [
  '<img src=x onerror="window.__modalTitlePwned=1">',
  '<b>bold</b> & "quoted"',
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const w = window as unknown as { __modalTitlePwned?: number };
  w.__modalTitlePwned = 0;

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px';
  document.body.appendChild(host);

  const mount = async (attrs: string) => {
    host.innerHTML = `<b-modal ${attrs}><p>Body</p></b-modal>`;
    const modal = host.querySelector('b-modal')!;
    await sleep(0);
    return modal;
  };
  const heading = (modal: Element) => modal.shadowRoot!.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6');
  const dialog = (modal: Element) => modal.shadowRoot!.querySelector<HTMLDialogElement>('dialog')!;

  try {
    // 1 — an <h2> by default, labelling the dialog.
    {
      const modal = await mount('title="Edit gallery"');
      const h = heading(modal);
      check(`the title is a heading (${h?.tagName ?? 'none'})`, h?.tagName === 'H2');
      check(`it reads as the title (${JSON.stringify(h?.textContent)})`, h?.textContent === 'Edit gallery');
      const by = dialog(modal).getAttribute('aria-labelledby');
      check(`the dialog is labelled by it (aria-labelledby=${by}, heading id=${h?.id})`, !!h?.id && by === h.id);
      check('the close button is still there', !!modal.shadowRoot!.querySelector('.close-btn'));

      // 2 — no visual change: the heading takes the header's type and adds no margin.
      if (h) {
        const hs = getComputedStyle(h);
        const header = getComputedStyle(modal.shadowRoot!.querySelector('.overlay-header')!);
        for (const p of ['font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing'] as const) {
          check(`the heading's ${p} is the header's (${hs.getPropertyValue(p)} vs ${header.getPropertyValue(p)})`,
            hs.getPropertyValue(p) === header.getPropertyValue(p));
        }
        check(`the heading has no margin (${hs.margin})`, ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']
          .every((p) => hs.getPropertyValue(p) === '0px'));
      } else {
        check('the heading looks like the header (no heading to measure)', false);
      }

      // 3 — a changed title is shown.
      modal.setAttribute('title', 'Renamed');
      await sleep(0);
      check(`a changed title is shown (${JSON.stringify(heading(modal)?.textContent)})`, heading(modal)?.textContent === 'Renamed');
    }

    // 4 — heading-level picks the level; anything outside 1–6 falls back to 2.
    for (const [value, tag] of [['1', 'H1'], ['3', 'H3'], ['6', 'H6'], ['0', 'H2'], ['7', 'H2'], ['x', 'H2']]) {
      const modal = await mount(`title="T" heading-level="${value}"`);
      check(`heading-level="${value}" renders ${tag} (${heading(modal)?.tagName ?? 'none'})`, heading(modal)?.tagName === tag);
    }

    // 5 — no title, no empty heading, and nothing points at one.
    {
      const modal = await mount('');
      check(`no title renders no heading (${heading(modal)?.outerHTML ?? 'none'})`, heading(modal) === null);
      const by = dialog(modal).getAttribute('aria-labelledby');
      check(`…and aria-labelledby points at nothing missing (${by})`, by === null || !!modal.shadowRoot!.getElementById(by));
    }

    // 6 — the title is text.
    for (const payload of PAYLOADS) {
      const modal = await mount('');
      modal.setAttribute('title', payload);
      await sleep(0);
      const h = heading(modal);
      check(`the title is shown as written (${JSON.stringify(payload)})`, h?.textContent === payload);
      check(`nothing in the title is parsed (${JSON.stringify(payload)})`, h?.children.length === 0
        && !modal.shadowRoot!.querySelector('.overlay-header img, .overlay-header b'));
    }
    await sleep(200); // an onerror would have fired by now
    check(`no title payload ran (__modalTitlePwned = ${w.__modalTitlePwned})`, w.__modalTitlePwned === 0);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] modal-title-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] modal-title-smoke ${r}`);
})();
