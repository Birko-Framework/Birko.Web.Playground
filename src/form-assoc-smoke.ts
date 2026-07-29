// STORY-023 / TASK-035 form-association smoke — asserts the `b-*` controls actually participate in a
// native <form>: value in FormData, validity visible to the form, reset restores, <fieldset disabled>
// propagates. Runs in a real browser via the playground's headless verify (see bare-smoke.ts for why).
import 'birko-web-components/inputs';

/** A real <form> in the document with the given controls inside. */
function form(...html: string[]): HTMLFormElement {
  const f = document.createElement('form');
  f.innerHTML = html.join('');
  f.style.position = 'absolute';
  f.style.left = '-9999px';
  document.body.appendChild(f);
  return f;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. The control is a form-associated element at all ──
    {
      const f = form('<b-input name="email" value="a@b.c"></b-input>');
      await settle();
      const el = f.querySelector('b-input') as HTMLElement & { form?: HTMLFormElement | null };
      check('b-input declares formAssociated', (customElements.get('b-input') as unknown as { formAssociated?: boolean })?.formAssociated === true);
      check('b-input resolves its owning form', el.form === f);
      f.remove();
    }

    // ── 2. The value reaches FormData under its name (the headline fix) ──
    {
      const f = form('<b-input name="email" value="a@b.c"></b-input>');
      await settle();
      check('FormData carries the seeded value', new FormData(f).get('email') === 'a@b.c');

      const el = f.querySelector('b-input') as HTMLElement & { value: string };
      el.value = 'typed@example.com';
      await settle();
      check('FormData follows a property set', new FormData(f).get('email') === 'typed@example.com');

      // A DOM-level edit (what a user typing actually does) must also propagate.
      const inner = el.shadowRoot?.querySelector('input') as HTMLInputElement;
      inner.value = 'user@typed.dev';
      inner.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
      check('FormData follows a user edit', new FormData(f).get('email') === 'user@typed.dev');
      f.remove();
    }

    // ── 3. Empty contributes NO entry (native shape — not an empty string) ──
    {
      const f = form('<b-input name="email"></b-input>');
      await settle();
      const fd = new FormData(f);
      check('empty control contributes no FormData entry', !fd.has('email'));
      f.remove();
    }

    // ── 4. `required` now blocks the form — the exact hole found in Presenter ──
    {
      const f = form('<b-input name="email" required></b-input>');
      await settle();
      const el = f.querySelector('b-input') as HTMLElement & { checkValidity(): boolean; validity: ValidityState; value: string };
      check('empty required control is invalid', el.checkValidity() === false);
      check('empty required reports valueMissing', el.validity.valueMissing === true);
      check('form.checkValidity() sees it', f.checkValidity() === false);
      el.value = 'someone@example.com';
      await settle();
      check('filled required control is valid', el.checkValidity() === true && f.checkValidity() === true);
      f.remove();
    }

    // ── 5. type/min/step are enforced through the form (previously invisible to it) ──
    {
      const f = form('<b-input name="url" type="url" value="not-a-url"></b-input>');
      await settle();
      const el = f.querySelector('b-input') as HTMLElement & { validity: ValidityState; value: string };
      check('type=url rejects a non-URL via typeMismatch', el.validity.typeMismatch === true && f.checkValidity() === false);
      el.value = 'https://example.com/deck.md';
      await settle();
      check('type=url accepts an absolute URL', f.checkValidity() === true);
      f.remove();
    }
    {
      const f = form('<b-input name="w" type="number" min="0" step="0.1" value="-5"></b-input>');
      await settle();
      const el = f.querySelector('b-input') as HTMLElement & { validity: ValidityState; value: string };
      check('min=0 rejects a negative via rangeUnderflow', el.validity.rangeUnderflow === true);
      el.value = '81.4';
      await settle();
      check('step=0.1 accepts 81.4', f.checkValidity() === true);
      el.value = '81.43';
      await settle();
      check('step=0.1 rejects 81.43 via stepMismatch', el.validity.stepMismatch === true);
      f.remove();
    }

    // ── 6. The `error` attribute wins over native validity (b-form's verdict must win) ──
    {
      const f = form('<b-input name="x" value="fine" error="Server said no"></b-input>');
      await settle();
      const el = f.querySelector('b-input') as HTMLElement & { validity: ValidityState; validationMessage: string };
      check('error attribute produces customError', el.validity.customError === true);
      check('error attribute becomes the validationMessage', el.validationMessage === 'Server said no');
      el.removeAttribute('error');
      await settle();
      check('clearing error restores validity', el.validity.customError === false && f.checkValidity() === true);
      f.remove();
    }

    // ── 7. form.reset() restores the initial value ──
    {
      const f = form('<b-input name="email" value="initial@x.dev"></b-input>');
      await settle();
      const el = f.querySelector('b-input') as HTMLElement & { value: string };
      el.value = 'changed@x.dev';
      await settle();
      f.reset();
      await settle();
      check('form.reset() restores the initial value', el.value === 'initial@x.dev');
      check('form.reset() restores FormData too', new FormData(f).get('email') === 'initial@x.dev');
      f.remove();
    }

    // ── 7b. form.reset() across every state shape, not just the string one ──
    // The generic "restore the `value` attribute" default is wrong for controls whose state lives
    // elsewhere: it would feed `value` through a setter that means something different. Each shape is
    // pinned here because the failure is silent (reset appears to work, restores the wrong thing).
    {
      // Checkedness, not value. `value="yes"` through the value setter would read as unchecked.
      for (const tag of ['b-checkbox', 'b-switch'] as const) {
        const f = form(`<${tag} name="flag" value="yes" checked></${tag}>`);
        await settle();
        const el = f.querySelector(tag) as HTMLElement & { checked: boolean };
        el.removeAttribute('checked');
        await settle();
        check(`${tag} is unchecked before reset`, el.checked === false);
        f.reset();
        await settle();
        check(`${tag} reset restores checkedness (not the value attribute)`, el.checked === true);
        check(`${tag} reset restores its FormData entry`, new FormData(f).get('flag') === 'yes');
        f.remove();
      }
    }
    {
      // A checkbox that started unchecked must come back unchecked, not checked.
      const f = form('<b-checkbox name="flag"></b-checkbox>');
      await settle();
      const el = f.querySelector('b-checkbox') as HTMLElement & { checked: boolean };
      el.setAttribute('checked', '');
      await settle();
      f.reset();
      await settle();
      check('b-checkbox reset restores the initially-unchecked state', el.checked === false);
      check('b-checkbox reset removes its FormData entry', !new FormData(f).has('flag'));
      f.remove();
    }
    {
      // Radio group: each member restores its own markup checkedness.
      const f = form(
        '<div><b-radio name="size" value="s"></b-radio>',
        '<b-radio name="size" value="m" checked></b-radio></div>',
      );
      await settle();
      const first = f.querySelectorAll('b-radio')[0];
      (first.shadowRoot?.querySelector('input') as HTMLInputElement).click();
      await settle();
      check('b-radio group moved to the first member', new FormData(f).get('size') === 's');
      f.reset();
      await settle();
      const after = new FormData(f).getAll('size');
      check('b-radio group reset restores the original member', after.length === 1 && after[0] === 'm');
      f.remove();
    }
    {
      // Multi-value list, populated imperatively — with an explicit baseline.
      const f = form('<b-multi-select name="tags"></b-multi-select>');
      await settle();
      const el = f.querySelector('b-multi-select') as HTMLElement & {
        setOptions(o: unknown[]): void; setSelected(v: string[]): void; getSelected(): string[];
        resetFormBaseline(): void;
      };
      el.setOptions([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]);
      el.setSelected(['a']);
      el.resetFormBaseline();          // page finished populating — this is the reset baseline
      await settle();
      el.setSelected(['a', 'b']);
      await settle();
      check('b-multi-select changed away from its baseline', new FormData(f).getAll('tags').length === 2);
      f.reset();
      await settle();
      const back = new FormData(f).getAll('tags');
      check('b-multi-select reset restores the baseline selection', back.length === 1 && back[0] === 'a');
      f.remove();
    }
    {
      const f = form('<b-tag-input name="labels" value="design,web"></b-tag-input>');
      await settle();
      const el = f.querySelector('b-tag-input') as HTMLElement & { setTags(t: string[]): void; getTags(): string[] };
      el.setTags(['other']);
      await settle();
      f.reset();
      await settle();
      check('b-tag-input reset restores its initial tags', el.getTags().join(',') === 'design,web');
      f.remove();
    }
    {
      // Two-value control: the JSON/interval `value` attribute goes back through the value setter.
      const f = form('<b-range name="score" mode="range" min="0" max="100" value=\'{"from":20,"to":80}\'></b-range>');
      await settle();
      const el = f.querySelector('b-range') as HTMLElement & { value: string };
      el.value = '{"from":5,"to":10}';
      await settle();
      f.reset();
      await settle();
      const fd = new FormData(f);
      check('b-range range mode reset restores both endpoints',
        fd.get('score-from') === '20' && fd.get('score-to') === '80');
      f.remove();
    }
    {
      const f = form('<b-date-range-picker name="period" value="2026-07-01/2026-07-31"></b-date-range-picker>');
      await settle();
      const el = f.querySelector('b-date-range-picker') as HTMLElement & { value: string };
      el.value = '2026-01-01/2026-01-31';
      await settle();
      f.reset();
      await settle();
      const fd = new FormData(f);
      check('b-date-range-picker reset restores both endpoints',
        fd.get('period-start') === '2026-07-01' && fd.get('period-end') === '2026-07-31');
      f.remove();
    }

    // ── 8. <fieldset disabled> propagates in (and a disabled control submits nothing) ──
    {
      const f = form('<fieldset><b-input name="email" value="a@b.c"></b-input></fieldset>');
      await settle();
      const fs = f.querySelector('fieldset')!;
      const el = f.querySelector('b-input') as HTMLElement & { disabled: boolean };
      const innerDisabled = () => !!el.shadowRoot?.querySelector('input')?.disabled;
      check('control starts enabled', el.disabled === false && !innerDisabled());
      fs.disabled = true;
      await settle();
      // The form-imposed state must NOT be written to the host's own attribute (that would make the
      // element self-disabled and unrecoverable) — it surfaces via `disabled` and the inner control.
      check('fieldset disabled propagates to the control', el.disabled === true && innerDisabled());
      check('fieldset disabled does not write the host attribute', !el.hasAttribute('disabled'));
      check('disabled control submits nothing', !new FormData(f).has('email'));
      fs.disabled = false;
      await settle();
      check('re-enabling propagates back', el.disabled === false && !innerDisabled());
      check('re-enabled control submits again', new FormData(f).get('email') === 'a@b.c');
      f.remove();
    }

    // ── 8b. b-textarea / b-select (native) participate the same way ──
    {
      const f = form('<b-textarea name="notes" value="hello"></b-textarea>');
      await settle();
      check('b-textarea value reaches FormData', new FormData(f).get('notes') === 'hello');
      f.remove();
    }
    {
      const f = form('<b-select name="status"></b-select>');
      await settle();
      const el = f.querySelector('b-select') as HTMLElement & { setOptions(o: unknown[]): void; value: string };
      el.setOptions([{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }]);
      await settle();
      el.value = 'done';
      await settle();
      check('b-select value reaches FormData', new FormData(f).get('status') === 'done');
      f.remove();
    }
    {
      // Searchable mode has no usable native validity (its inner input holds the option LABEL), so the
      // base's generic required check has to carry it.
      const f = form('<b-select name="pick" searchable required></b-select>');
      await settle();
      const el = f.querySelector('b-select') as HTMLElement & { setOptions(o: unknown[]): void; value: string; validity: ValidityState };
      el.setOptions([{ value: 'a', label: 'Alpha' }]);
      await settle();
      check('b-select searchable required is invalid when empty', el.validity.valueMissing === true);
      el.value = 'a';
      await settle();
      check('b-select searchable required is valid once picked', f.checkValidity() === true);
      check('b-select searchable submits the VALUE not the label', new FormData(f).get('pick') === 'a');
      f.remove();
    }

    // ── 8c. Multi-value controls: N entries under one name, native `<select multiple>` shape ──
    {
      const f = form('<b-multi-select name="tags"></b-multi-select>');
      await settle();
      const el = f.querySelector('b-multi-select') as HTMLElement & {
        setOptions(o: unknown[]): void; setSelected(v: string[]): void; value: string;
      };
      el.setOptions([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]);
      await settle();
      check('b-multi-select empty submits nothing', !new FormData(f).has('tags'));
      el.setSelected(['a', 'c']);
      await settle();
      const all = new FormData(f).getAll('tags');
      check('b-multi-select submits one entry per value', all.length === 2 && all[0] === 'a' && all[1] === 'c');
      check('b-multi-select .value stays the joined string (back-compat)', el.value === 'a,c');
      f.remove();
    }
    {
      const f = form('<b-tag-input name="labels"></b-tag-input>');
      await settle();
      const el = f.querySelector('b-tag-input') as HTMLElement & { setTags(t: string[]): void; value: string };
      el.setTags(['design', 'web']);
      await settle();
      const all = new FormData(f).getAll('labels');
      check('b-tag-input submits one entry per tag', all.length === 2 && all[0] === 'design' && all[1] === 'web');
      // The joined form is lossy for a value containing the delimiter; the multi-entry form is not.
      el.setTags(['a,b']);
      await settle();
      const comma = new FormData(f).getAll('labels');
      check('b-tag-input multi-entry survives a comma inside a value', comma.length === 1 && comma[0] === 'a,b');
      f.remove();
    }
    {
      const f = form('<b-multi-select name="m" required></b-multi-select>');
      await settle();
      const el = f.querySelector('b-multi-select') as HTMLElement & {
        setOptions(o: unknown[]): void; setSelected(v: string[]): void; validity: ValidityState;
      };
      el.setOptions([{ value: 'a', label: 'A' }]);
      await settle();
      check('b-multi-select required is invalid when empty', el.validity.valueMissing === true);
      el.setSelected(['a']);
      await settle();
      check('b-multi-select required is valid once selected', f.checkValidity() === true);
      f.remove();
    }

    // ── 8d. The pickers submit their ISO value, not the formatted display string ──
    for (const [tag, iso] of [['b-date-picker', '2026-07-29'], ['b-datetime-picker', '2026-07-29T08:30'], ['b-time', '08:30']] as const) {
      const f = form(`<${tag} name="when" value="${iso}"></${tag}>`);
      await settle();
      const submitted = new FormData(f).get('when');
      check(`${tag} submits its ISO value, not the display text`, submitted === iso);
      f.remove();
    }
    {
      const f = form('<b-date-picker name="d" required></b-date-picker>');
      await settle();
      const el = f.querySelector('b-date-picker') as HTMLElement & { validity: ValidityState; value: string };
      check('b-date-picker required is invalid when empty', el.validity.valueMissing === true);
      el.value = '2026-07-29';
      await settle();
      check('b-date-picker required is valid once set', f.checkValidity() === true);
      f.remove();
    }
    {
      // native mode has a real <input type="date">, so its own min/max validity should be mirrored.
      const f = form('<b-date-picker name="d" native min="2026-01-01" value="2025-06-01"></b-date-picker>');
      await settle();
      const el = f.querySelector('b-date-picker') as HTMLElement & { validity: ValidityState };
      check('b-date-picker native mirrors min via rangeUnderflow', el.validity.rangeUnderflow === true);
      f.remove();
    }

    // ── 8e. Two-value controls: suffixed names, so a server binds two ordinary fields ──
    {
      const f = form('<b-range name="score" mode="range" min="0" max="100" value=\'{"from":20,"to":80}\'></b-range>');
      await settle();
      const fd = new FormData(f);
      check('b-range range mode submits name-from / name-to',
        fd.get('score-from') === '20' && fd.get('score-to') === '80');
      check('b-range range mode submits no bare `name` entry', !fd.has('score'));
      f.remove();
    }
    {
      const f = form('<b-range name="score" min="0" max="100" value="42"></b-range>');
      await settle();
      const fd = new FormData(f);
      check('b-range single mode submits one plain value', fd.get('score') === '42');
      check('b-range single mode uses no suffixes', !fd.has('score-from'));
      f.remove();
    }
    {
      const f = form('<b-date-range-picker name="period" value="2026-07-01/2026-07-31"></b-date-range-picker>');
      await settle();
      const fd = new FormData(f);
      check('b-date-range-picker submits name-start / name-end',
        fd.get('period-start') === '2026-07-01' && fd.get('period-end') === '2026-07-31');
      f.remove();
    }
    {
      const f = form('<b-date-range-picker name="period"></b-date-range-picker>');
      await settle();
      const fd = new FormData(f);
      check('b-date-range-picker empty submits nothing', !fd.has('period-start') && !fd.has('period-end'));
      f.remove();
    }

    // ── 8f. b-color-picker submits the BASE hex — alpha byte dropped, `value` keeps it ──
    {
      const f = form('<b-color-picker name="brand" alpha value="#25ba7acc"></b-color-picker>');
      await settle();
      const el = f.querySelector('b-color-picker') as HTMLElement & { value: string };
      check('b-color-picker submits the base hex', new FormData(f).get('brand') === '#25ba7a');
      check('b-color-picker .value keeps the alpha byte', el.value.toLowerCase() === '#25ba7acc');
      f.remove();
    }

    // ── 8g. b-markdown-editor submits the SOURCE, not the rendered preview ──
    {
      const f = form('<b-markdown-editor name="body"></b-markdown-editor>');
      await settle();
      const el = f.querySelector('b-markdown-editor') as HTMLElement & { value: string };
      el.value = '# Title\n\nSome **bold** text.';
      await settle();
      const submitted = String(new FormData(f).get('body') ?? '');
      check('b-markdown-editor submits the markdown source', submitted === '# Title\n\nSome **bold** text.');
      check('b-markdown-editor does not submit rendered HTML', !submitted.includes('<strong>') && !submitted.includes('<h1>'));
      f.remove();
    }

    // ── 8h. Every input in the catalogue that should participate, does ──
    {
      const EXPECTED = [
        'b-input', 'b-textarea', 'b-select', 'b-multi-select', 'b-tag-input',
        'b-date-picker', 'b-datetime-picker', 'b-time', 'b-range', 'b-color-picker',
        'b-date-range-picker', 'b-markdown-editor',
      ];
      const missing = EXPECTED.filter(
        (t) => (customElements.get(t) as unknown as { formAssociated?: boolean })?.formAssociated !== true,
      );
      check(`all 12 converted controls are formAssociated${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`,
        missing.length === 0);
      // The toggle controls are converted too, with native checkbox semantics (see 8j/8k).
      const toggles = ['b-checkbox', 'b-switch', 'b-radio'].filter(
        (t) => (customElements.get(t) as unknown as { formAssociated?: boolean })?.formAssociated !== true,
      );
      check(`toggle controls are formAssociated${toggles.length ? ` (missing: ${toggles.join(', ')})` : ''}`,
        toggles.length === 0);
    }

    // ── 8j. Toggle controls: native checkbox submit semantics ──
    for (const tag of ['b-checkbox', 'b-switch'] as const) {
      // Unchecked must submit NOTHING. Submitting `name=false` would silently mis-bind server-side —
      // `bool` model binding reads absence as false, so `false` as a *string* is a truthy present value.
      const f = form(`<${tag} name="flag"></${tag}>`);
      await settle();
      check(`${tag} unchecked submits no entry`, !new FormData(f).has('flag'));
      const el = f.querySelector(tag) as HTMLElement & { checked: boolean; value: string };
      el.setAttribute('checked', '');
      await settle();
      check(`${tag} checked submits 'on' by default`, new FormData(f).get('flag') === 'on');
      check(`${tag} .value still returns 'true'/'false' (unchanged API)`, el.value === 'true');
      f.remove();
    }
    {
      const f = form('<b-checkbox name="flag" value="yes" checked></b-checkbox>');
      await settle();
      check('b-checkbox submits its explicit value attribute', new FormData(f).get('flag') === 'yes');
      f.remove();
    }
    {
      // A real user click (not an attribute set) must propagate to the form.
      const f = form('<b-checkbox name="flag"></b-checkbox>');
      await settle();
      const el = f.querySelector('b-checkbox')!;
      const inner = el.shadowRoot?.querySelector('input') as HTMLInputElement;
      inner.click();
      await settle();
      check('b-checkbox user click reaches FormData', new FormData(f).get('flag') === 'on');
      inner.click();
      await settle();
      check('b-checkbox un-clicking removes the entry', !new FormData(f).has('flag'));
      f.remove();
    }
    {
      const f = form('<b-checkbox name="terms" required></b-checkbox>');
      await settle();
      const el = f.querySelector('b-checkbox') as HTMLElement & { validity: ValidityState };
      check('b-checkbox required is invalid while unchecked', el.validity.valueMissing === true);
      el.setAttribute('checked', '');
      await settle();
      check('b-checkbox required is valid once checked', f.checkValidity() === true);
      f.remove();
    }

    // ── 8k. b-radio: one entry per group from the checked member, no coordinator ──
    {
      const f = form(
        '<div><b-radio name="size" value="s" label="S"></b-radio>',
        '<b-radio name="size" value="m" label="M" checked></b-radio>',
        '<b-radio name="size" value="l" label="L"></b-radio></div>',
      );
      await settle();
      const all = new FormData(f).getAll('size');
      check('b-radio group submits exactly one entry', all.length === 1);
      check('b-radio group submits the checked value', all[0] === 'm');

      // Click a different member: the group listener unchecks the old one WITHOUT re-rendering it, so
      // this is the case that silently produced two entries before the explicit sync.
      const third = f.querySelectorAll('b-radio')[2];
      (third.shadowRoot?.querySelector('input') as HTMLInputElement).click();
      await settle();
      const after = new FormData(f).getAll('size');
      check('b-radio still submits exactly one entry after switching', after.length === 1);
      check('b-radio submits the newly checked value', after[0] === 'l');
      f.remove();
    }
    {
      // `required` is a group property and is deliberately unsupported — it must NOT mark every
      // unchecked member invalid (that would be one bubble per radio for a single logical field).
      const f = form(
        '<div><b-radio name="size" value="s" required></b-radio>',
        '<b-radio name="size" value="m" required></b-radio></div>',
      );
      await settle();
      check('b-radio required does not invalidate unchecked members', f.checkValidity() === true);
      f.remove();
    }

    // ── 8l. Regression: b-form reads toggles via .checked, which must be untouched ──
    {
      const host = document.createElement('b-form') as HTMLElement & {
        setSchema(s: unknown): void; getValues(): Record<string, unknown>;
      };
      host.style.position = 'absolute';
      host.style.left = '-9999px';
      document.body.appendChild(host);
      host.setSchema({
        name: 'root',
        children: [
          { name: 'active', type: 'switch', label: 'Active' },
          { name: 'agreed', type: 'checkbox', label: 'Agreed' },
        ],
      });
      await new Promise((r) => setTimeout(r, 30));
      // Values go in via setValues() — the documented path, which routes through `_setFieldValue` and
      // sets the `checked` attribute. (Schema-level `value: true` does NOT check a toggle: b-form's
      // attribute builder emits `value="true"` and has no checkbox/switch case. Pre-existing, unrelated
      // to form association — reported separately, deliberately not changed here.)
      (host as unknown as { setValues(v: Record<string, unknown>): void }).setValues({ active: true, agreed: false });
      await new Promise((r) => setTimeout(r, 20));
      const v = host.getValues();
      check('b-form still reads a switched-on toggle as boolean true', v.active === true);
      check('b-form still reads an unchecked checkbox as false', v.agreed === false);
      host.remove();
    }

    // ── 8i. CONSUMER IMPACT: an invalid control now suppresses the submit event entirely ──
    // This is the behaviour change that reaches existing consumers. A page that wrapped b-* in a
    // <form> with a real `type="submit"` button and did its own validation in the submit handler used to
    // get that handler called unconditionally (the browser could not see shadow-DOM controls). Now the
    // browser refuses first and the handler never runs — so a page-level localised error message would
    // never appear. Verified here, and so is the escape hatch.
    {
      const f = form('<b-input name="steps" type="number" min="0" value="-500"></b-input><button type="submit">Save</button>');
      await settle();
      const seen = { submitted: false };
      f.addEventListener('submit', (e) => { e.preventDefault(); seen.submitted = true; });
      f.querySelector('button')!.click();
      await settle();
      check('an invalid b-input suppresses the form submit event', seen.submitted === false);
    }
    {
      // `novalidate` is the standard opt-out: constraint validation no longer blocks, so a page keeps
      // full control of its own messages, while FormData / reset / fieldset participation all still work.
      const f = form('<b-input name="steps" type="number" min="0" value="-500"></b-input><button type="submit">Save</button>');
      f.noValidate = true;
      await settle();
      const seen = { submitted: false };
      f.addEventListener('submit', (e) => { e.preventDefault(); seen.submitted = true; });
      f.querySelector('button')!.click();
      await settle();
      check('novalidate restores the submit event for a page doing its own validation', seen.submitted === true);
      check('novalidate still submits the value', new FormData(f).get('steps') === '-500');
      f.remove();
    }

    // ── 9. Regression: b-form's programmatic path is untouched by any of the above ──
    {
      const host = document.createElement('b-form') as HTMLElement & {
        setSchema(s: unknown): void; getValues(): Record<string, unknown>; validate(): { valid: boolean; errors: Record<string, string> };
      };
      host.style.position = 'absolute';
      host.style.left = '-9999px';
      document.body.appendChild(host);
      host.setSchema({
        name: 'root',
        children: [
          { name: 'title', type: 'text', label: 'Title', required: true },
          { name: 'qty', type: 'number', label: 'Qty' },
        ],
      });
      await new Promise((r) => setTimeout(r, 30));
      const empty = host.validate();
      check('b-form still flags a missing required field', empty.valid === false && !!empty.errors.title);
      const field = host.shadowRoot?.querySelector('[data-field="title"] b-input') as (HTMLElement & { value: string }) | null;
      if (field) {
        field.value = 'Something';
        await settle();
      }
      check('b-form still reads values from its controls', host.getValues().title === 'Something');
      check('b-form validates clean once filled', host.validate().valid === true);
      host.remove();
    }

    // ── 10. Not-in-a-form is still fine (the overwhelmingly common case) ──
    {
      const el = document.createElement('b-input') as HTMLElement & { value: string; form?: HTMLFormElement | null };
      el.setAttribute('name', 'loose');
      document.body.appendChild(el);
      await settle();
      el.value = 'standalone';
      check('control outside a form has form === null', el.form === null);
      check('control outside a form still round-trips its value', el.value === 'standalone');
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] form-assoc-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] form-assoc-smoke ${r}`);
})();
