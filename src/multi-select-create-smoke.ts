// TASK-490 — a `creatable` b-multi-select commits the typed value itself unless a `create` listener vetoes
// it with preventDefault(). Before, the create row only emitted `create`, so in a b-form with no page code
// it was a visible, clickable no-op. `create`'s detail is now `{ name: <field>, value: <typed> }`, like every
// other b-* event (it used to carry the typed text in `name`).
import 'birko-web-components/inputs';

type Multi = HTMLElement & {
  setOptions(o: { value: string; label: string }[]): void;
  getSelected(): string[];
  addOption(o: { value: string; label: string }, select?: boolean): void;
};
type Form = HTMLElement & { setSchema(s: unknown): void; getValues(): Record<string, unknown> };

const OPTIONS = [{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }];
const settle = () => new Promise((r) => setTimeout(r, 30));

function offscreen<T extends HTMLElement>(el: T): T {
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  return el;
}

async function mount(): Promise<Multi> {
  const wrap = offscreen(document.createElement('div'));
  wrap.innerHTML = '<b-multi-select name="tags" label="Tags" searchable creatable></b-multi-select>';
  await settle();
  const el = wrap.querySelector('b-multi-select') as Multi;
  el.setOptions(OPTIONS);
  await settle();
  return el;
}

/** Open the list, type into its search box, return the create row (or null). */
async function typeNew(el: HTMLElement, text: string): Promise<HTMLElement | null> {
  (el.shadowRoot!.querySelector('.container') as HTMLElement).click();
  const search = el.shadowRoot!.querySelector('.dd-search') as HTMLInputElement;
  search.value = text;
  search.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle();
  return el.shadowRoot!.querySelector<HTMLElement>('.option-create');
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. No listener: the typed value is committed ──
    {
      const el = await mount();
      const seen: CustomEvent[] = [];
      el.addEventListener('create', (e) => seen.push(e as CustomEvent));
      const changes: string[][] = [];
      el.addEventListener('change', (e) => changes.push((e as CustomEvent).detail.values));
      const row = await typeNew(el, 'Green');
      check('a new query offers the create row', !!row);
      row?.click();
      await settle();
      const ev = seen[0];
      check('create fires once', seen.length === 1);
      check('...with detail.name = the FIELD name', ev?.detail?.name === 'tags');
      check('...and detail.value = the typed text', ev?.detail?.value === 'Green');
      check('...and it is cancelable', ev?.cancelable === true);
      check('with no veto, the value is selected', el.getSelected().includes('Green'));
      check('...reported through change', changes.some((v) => v.includes('Green')));
      check('...and shown as a chip', (el.shadowRoot!.querySelector('.container')?.textContent ?? '').includes('Green'));
      // setOptions keeps the caller's array; in a b-form that is the schema's. A push into it leaked the
      // created value into every other instance built from the same options.
      check('creating does not mutate the array passed to setOptions', OPTIONS.length === 2);
      el.parentElement!.remove();
    }

    // ── 2. A listener vetoes and supplies its own option (Symbio's server-minted tag) ──
    {
      const el = await mount();
      el.addEventListener('create', (e) => {
        const ce = e as CustomEvent;
        ce.preventDefault();
        el.addOption({ value: 'tag-17', label: ce.detail.value }, true);
      });
      (await typeNew(el, 'Green'))?.click();
      await settle();
      check('a vetoed create does not commit the typed text', !el.getSelected().includes('Green'));
      check(`...the listener's own option is selected instead, once (${el.getSelected().join()})`,
        el.getSelected().join() === 'tag-17');
      el.parentElement!.remove();
    }

    // ── 3. Through b-form with NO page code — the no-op this task fixes ──
    {
      const form = offscreen(document.createElement('b-form')) as Form;
      await settle();
      form.setSchema({
        name: 'root',
        children: [{ name: 'tags', type: 'multi-select', label: 'Tags', options: OPTIONS, searchable: true, creatable: true }],
      });
      await settle();
      const field = form.shadowRoot!.querySelector('[data-path="tags"]') as Multi;
      (await typeNew(field, 'Green'))?.click();
      await settle();
      check(`in a b-form with no listener, the created value is the form value (${JSON.stringify(form.getValues())})`,
        JSON.stringify(form.getValues().tags ?? '').includes('Green'));
      form.remove();
    }

    // ── 4. The popup is not announced as a menu ──
    {
      const el = await mount();
      const container = el.shadowRoot!.querySelector('.container')!;
      const dropdown = el.shadowRoot!.querySelector('.dropdown')!;
      check('aria-haspopup names a dialog, not a menu', container.getAttribute('aria-haspopup') === 'dialog');
      check('...and the popup is that dialog', dropdown.getAttribute('role') === 'dialog');
      el.parentElement!.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] multi-select-create-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] multi-select-create-smoke ${r}`);
})();
