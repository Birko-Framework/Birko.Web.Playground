// `b-select` `creatable` — `b-form` emitted the attribute for single selects, which ignored it, so a
// schema declaring `creatable: true` rendered a pick-only list (Symbio's navigation "Menu group").
// Pins the control alone, the b-form -> b-select wiring that was broken, and that a select WITHOUT
// `creatable` still offers no create row and commits no free text.
import 'birko-web-components/inputs';

type Select = HTMLElement & {
  value: string;
  setOptions(o: { value: string; label: string }[]): void;
};
type Form = HTMLElement & {
  setSchema(s: unknown): void;
  setValues(v: Record<string, unknown>): void;
  getValues(): Record<string, unknown>;
  validate(): { valid: boolean; data: Record<string, unknown> };
};

const OPTIONS = [
  { value: 'header', label: 'Header' },
  { value: 'footer', label: 'Footer' },
];

const settle = () => new Promise((r) => setTimeout(r, 30));

function offscreen(el: HTMLElement): HTMLElement {
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  return el;
}

async function mountSelect(attrs: string): Promise<Select> {
  const wrap = offscreen(document.createElement('div'));
  wrap.innerHTML = `<b-select name="menuGroup" label="Menu group" ${attrs}></b-select>`;
  await settle();
  const el = wrap.querySelector('b-select') as Select;
  el.setOptions(OPTIONS);
  await settle();
  return el;
}

const inputOf = (el: HTMLElement) => el.shadowRoot!.querySelector('.combo-input') as HTMLInputElement;
const createRow = (el: HTMLElement) => el.shadowRoot!.querySelector('.option-create') as HTMLElement | null;

function type(el: HTMLElement, text: string) {
  const input = inputOf(el);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function key(el: HTMLElement, k: string): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
  inputOf(el).dispatchEvent(ev);
  return ev;
}

function record(el: HTMLElement): string[] {
  const log: string[] = [];
  el.addEventListener('create', (e: Event) => log.push(`create:${(e as CustomEvent).detail.value}`));
  el.addEventListener('change', (e: Event) => log.push(`change:${(e as CustomEvent).detail.value}`));
  return log;
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. Standalone: type a new value, Enter commits it ──
    {
      const el = await mountSelect('searchable creatable');
      const log = record(el);
      type(el, 'footer-2');
      const row = createRow(el);
      check('a query naming no option shows a create row', !!row);
      check('...labelled with the typed value', (row?.textContent ?? '').includes('Create') && (row?.textContent ?? '').includes('footer-2'));
      check('...instead of "No matches"', !el.shadowRoot!.querySelector('.no-results'));
      check('...and announces it', (el.shadowRoot!.querySelector('[role="status"]')?.textContent ?? '').includes('footer-2'));

      const ev = key(el, 'Enter');
      check('Enter commits the typed value', el.value === 'footer-2');
      check('...and swallows the Enter (no form submit)', ev.defaultPrevented);
      check(`...reported by change alone, no bubbling create (${log.join(', ')})`, log.join(',') === 'change:footer-2');
      check('...and the field shows it', inputOf(el).value === 'footer-2');

      // What b-form does on re-render: the schema's options arrive again, without the created value.
      el.setOptions(OPTIONS);
      await settle();
      check('a created value still displays after the options are reset', inputOf(el).value === 'footer-2');
      el.parentElement!.remove();
    }

    // ── 2. Standalone: clicking the create row commits it ──
    {
      const el = await mountSelect('searchable creatable');
      type(el, 'sidebar');
      // `?.`, not `!`: a missing row must fail this check, not abort the suite before the b-form checks.
      createRow(el)?.click();
      check('clicking the create row commits the value', el.value === 'sidebar');
      el.parentElement!.remove();
    }

    // ── 3. A query that names an existing option selects it — no near-duplicate ──
    {
      const el = await mountSelect('searchable creatable');
      const log = record(el);
      type(el, 'FOOTER');
      check('an exact (case-folded) match shows no create row', !createRow(el));
      key(el, 'Enter');
      check('...and Enter selects the existing option', el.value === 'footer');
      check('...reported as a change to it', log.join(',') === 'change:footer');
      el.parentElement!.remove();
    }

    // ── 4. Escape cancels ──
    {
      const el = await mountSelect('searchable creatable value="header"');
      const log = record(el);
      type(el, 'nope');
      key(el, 'Escape');
      check('Escape keeps the previous value', el.value === 'header');
      check('...creates nothing', log.length === 0);
      check('...and restores its label', inputOf(el).value === 'Header');
      el.parentElement!.remove();
    }

    // ── 5. `creatable` implies the combo — a native <select> has nowhere to type ──
    {
      const el = await mountSelect('creatable');
      check('creatable without searchable renders the typed combo', !!inputOf(el) && !el.shadowRoot!.querySelector('select'));
      el.parentElement!.remove();
    }

    // ── 6. Without `creatable`: unchanged — no create row, no free text ──
    {
      const el = await mountSelect('searchable');
      const log = record(el);
      type(el, 'footer-2');
      check('a plain searchable select shows no create row', !createRow(el));
      check('...but still says "No matches"', !!el.shadowRoot!.querySelector('.no-results'));
      const ev = key(el, 'Enter');
      check('...Enter commits nothing', el.value === '' && log.length === 0);
      check('...and is left to the form', !ev.defaultPrevented);
      el.parentElement!.remove();

      const native = await mountSelect('');
      check('a plain select is still a native <select>', !!native.shadowRoot!.querySelector('select'));
      native.parentElement!.remove();
    }

    // ── 7. b-form -> b-select: the wiring that was broken ──
    {
      const schema = {
        name: 'root',
        children: [{ name: 'menuGroup', type: 'select', label: 'Menu group', options: OPTIONS, searchable: true, creatable: true }],
      };
      const form = offscreen(document.createElement('b-form')) as Form;
      await settle();
      form.setSchema(schema);
      await settle();
      const field = () => form.shadowRoot!.querySelector('[data-path="menuGroup"]') as Select;
      let submits = 0;
      form.addEventListener('submit', () => submits++);

      check('b-form renders the field with creatable', field()?.hasAttribute('creatable') === true);
      type(field(), 'footer-2');
      check('...which offers the create row', !!createRow(field()));
      key(field(), 'Enter');
      check('the created value is the form value', form.getValues().menuGroup === 'footer-2');
      check('...and is what validate() submits', form.validate().data.menuGroup === 'footer-2');
      check('...and that Enter did not submit the form', submits === 0);
      form.remove();

      // Reopen: a fresh form loaded with the saved value.
      const again = offscreen(document.createElement('b-form')) as Form;
      await settle();
      again.setSchema(schema);
      await settle();
      again.setValues({ menuGroup: 'footer-2' });
      await settle();
      const reopened = again.shadowRoot!.querySelector('[data-path="menuGroup"]') as Select;
      check('a reopened form shows the created value', inputOf(reopened).value === 'footer-2');
      check('...and returns it', again.getValues().menuGroup === 'footer-2');
      again.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] select-creatable-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] select-creatable-smoke ${r}`);
})();
