// TASK-582 — a page's guided-tour `?` had no home in the Shell, so consumers appended it to renderHeaderActions(),
// and on a page with no other action it sat alone where buttons belong. BasePage now renders it beside the title
// from a `tourSteps()` hook and wires the click once. This asserts where it lands (with and without other header
// actions), that it is absent without steps, that it is named, and that a click still launches after re-renders.
// tour.start is spied on rather than run: a real tour overlay would make the page inert for the other suites.
import 'birko-web-components/inputs';
import { tour, type TourStep } from 'birko-web-components/layout';
import { BasePage } from 'birko-web-shell';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};

const STEPS: TourStep[] = [{ title: 'Smoke', body: 'A step.' }];

class PtReadOnly extends BasePage {
  protected get pageTitle() { return 'Read-only'; }
  protected tourSteps() { return STEPS; }
}
class PtWithAction extends BasePage {
  protected get pageTitle() { return 'With action'; }
  protected tourSteps() { return STEPS; }
  protected renderHeaderActions() { return '<b-button variant="primary" id="pt-create">Create</b-button>'; }
}
class PtNull extends BasePage {
  protected get pageTitle() { return 'No tour'; }
}
class PtEmpty extends BasePage {
  protected get pageTitle() { return 'Empty tour'; }
  protected tourSteps() { return []; }
}
class PtCustomHeader extends BasePage {
  protected tourSteps() { return STEPS; }
  protected renderPageHeader() { return `<div class="custom-header"><span>Custom</span>${this.renderTourButton()}</div>`; }
}
customElements.define('pt-read-only', PtReadOnly);
customElements.define('pt-with-action', PtWithAction);
customElements.define('pt-null', PtNull);
customElements.define('pt-empty', PtEmpty);
customElements.define('pt-custom-header', PtCustomHeader);

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const calls: { steps: number; id: string; once: boolean | undefined }[] = [];
  const realStart = tour.start.bind(tour);
  tour.start = (steps, options) => { calls.push({ steps: steps.length, id: options.id, once: options.once }); return true; };

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px';
  document.body.appendChild(host);

  const mount = async (tag: string): Promise<HTMLElement> => {
    const el = document.createElement(tag);
    host.appendChild(el);
    await waitFor(() => !!el.shadowRoot?.querySelector('.page-header, .custom-header'));
    return el;
  };
  const tourBtn = (page: HTMLElement) => page.shadowRoot!.querySelector<HTMLElement>('[data-b-page-tour]');
  /** A real click on the b-button's inner <button>, which reaches the page retargeted to the host. */
  const press = async (page: HTMLElement) => {
    const btn = tourBtn(page)!;
    await waitFor(() => !!btn.shadowRoot?.querySelector('button'));
    btn.shadowRoot!.querySelector<HTMLButtonElement>('button')!.click();
  };

  try {
    // ── 1. Read-only page (the reported symptom): the ? sits beside the title, and there is no action group ──
    {
      const page = await mount('pt-read-only');
      const btn = tourBtn(page);
      check('precondition: the read-only page rendered its header', !!page.shadowRoot!.querySelector('.page-header'));
      check(`the ? renders inside .page-title-group (parent: ${btn?.parentElement?.className ?? 'none'})`,
        btn?.parentElement?.classList.contains('page-title-group') === true);
      check('the ? follows the h1 directly', btn?.previousElementSibling?.tagName === 'H1');
      check('no .header-actions is rendered on a page with no actions', !page.shadowRoot!.querySelector('.header-actions'));

      await waitFor(() => !!btn?.shadowRoot?.querySelector('button'));
      const inner = btn?.shadowRoot?.querySelector('button');
      check(`the inner button is named (aria-label: ${inner?.getAttribute('aria-label') ?? 'none'})`,
        inner?.getAttribute('aria-label') === 'Take a tour');
      check('the inner button is focusable', !!inner && inner.tabIndex >= 0 && !inner.disabled);

      await press(page);
      check(`a click launches the tour (calls: ${calls.length})`, calls.length === 1);
      check(`it replays: once is false (got ${String(calls[0]?.once)})`, calls[0]?.once === false);
      check(`the tour id defaults to the tag name (got ${calls[0]?.id})`, calls[0]?.id === 'pt-read-only');

      (page as unknown as { update(): void }).update();
      (page as unknown as { update(): void }).update();
      await sleep(30);
      await press(page);
      check(`after two update() calls a click still launches (calls: ${calls.length})`, calls.length === 2);
      await press(page);
      check(`a second click replays it (calls: ${calls.length})`, calls.length === 3);
    }

    // ── 2. A page with a Create action: same placement, and the action group holds only the action ──
    {
      calls.length = 0;
      const page = await mount('pt-with-action');
      const btn = tourBtn(page);
      const actions = page.shadowRoot!.querySelector('.header-actions');
      check('the ? is beside the title on a page with a Create action',
        btn?.parentElement?.classList.contains('page-title-group') === true);
      check(`the action group holds only Create (children: ${actions?.children.length ?? 0})`,
        actions?.children.length === 1 && actions.firstElementChild?.id === 'pt-create');
      await press(page);
      check(`a click on that page launches the tour (calls: ${calls.length})`, calls.length === 1);
    }

    // ── 3. No steps: no button at all ──
    for (const tag of ['pt-null', 'pt-empty']) {
      const page = await mount(tag);
      check(`${tag}: no ? without steps`, !tourBtn(page));
    }

    // ── 4. An overridden renderPageHeader() keeps the button through renderTourButton(), and it still launches ──
    {
      calls.length = 0;
      const page = await mount('pt-custom-header');
      check('a custom header renders the ? through renderTourButton()', !!tourBtn(page));
      await press(page);
      check(`a click in a custom header launches the tour (calls: ${calls.length})`, calls.length === 1);
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  tour.start = realStart;
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] page-tour-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] page-tour-smoke ${r}`);
})();
