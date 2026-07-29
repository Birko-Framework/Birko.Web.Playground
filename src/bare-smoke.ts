// STORY-001 / TASK-001 `bare` attribute smoke — asserts that the eight form controls strip their
// `.field` chrome when `bare` is set, keep it by default, and (the part that is easy to get wrong)
// still expose their error + accessible-name state through ARIA when the chrome is gone.
//
// This is how framework component changes are verified: `Birko.Web.Components` ships no unit runner,
// so the regression gate is a real browser via the playground's headless verify (verify.mjs surfaces
// `[playground]` console logs + page errors).
import 'birko-web-components/inputs';

/** Mount a control off-screen, let it render, and hand back its shadow root. */
async function mount(tag: string, attrs: Record<string, string>): Promise<HTMLElement> {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  // Off-screen rather than display:none — a hidden subtree skips layout, and the pickers position
  // their popovers from measured rects.
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

/**
 * Where each control keeps its state. These differ per component and a generic
 * `querySelector('input, .container, …')` picks the wrong one (it returns the first match in
 * document order, so a wrapper beats the inner input it contains) — so spell it out:
 *
 * - `aria` — the element {@link fieldAria}'s output lands on. For the native-primitive controls that
 *   is the `input` / `select` / `textarea`; for the div-based combos it is the focusable wrapper.
 * - `errorHost` — the element carrying the `has-error` border class, which is NOT always the same
 *   element (b-tag-input / b-multi-select style the wrapper, not the inner input).
 */
const CHROMED: { tag: string; aria: string; errorHost?: string; ownName?: boolean }[] = [
  { tag: 'b-input', aria: 'input' },
  { tag: 'b-select', aria: 'select' },
  { tag: 'b-multi-select', aria: '.container' },
  { tag: 'b-textarea', aria: 'textarea' },
  { tag: 'b-tag-input', aria: '.container input', errorHost: '.container' },
  { tag: 'b-date-picker', aria: '.dp-input' },
  { tag: 'b-datetime-picker', aria: '.dp-input' },
  { tag: 'b-time', aria: '.tp-input' },
  { tag: 'b-date-range-picker', aria: '.drp-input-start', ownName: true },
  { tag: 'b-range', aria: 'input' },
  { tag: 'b-color-picker', aria: '.hex' },   // .swatch carries its own aria-label; the field's ARIA is on .hex
  { tag: 'b-markdown-editor', aria: 'textarea' },
  // Gained the whole family last: they rendered a label but no error row, so migrating them meant adding
  // error support (a feature). Both are div-based widgets, so the ARIA sits on the focusable wrapper.
  { tag: 'b-option-group', aria: '.options', errorHost: '.options', ownName: true },
  { tag: 'b-file-upload', aria: '.dropzone', errorHost: '.dropzone', ownName: true },
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. Default (no `bare`) renders the full chrome — the regression guard ──
    for (const { tag } of CHROMED) {
      const el = await mount(tag, { label: 'Weight', error: 'Too low' });
      const r = el.shadowRoot!;
      const ok = !!r.querySelector('.field') && !!r.querySelector('label') && !!r.querySelector('.error');
      check(`${tag} default renders .field + label + .error`, ok);
      el.remove();
    }

    // ── 2. `bare` strips wrapper, label and error row ──
    for (const { tag, aria } of CHROMED) {
      const el = await mount(tag, { label: 'Weight', error: 'Too low', bare: 'true' });
      const r = el.shadowRoot!;
      const ok = !r.querySelector('.field') && !r.querySelector('label') && !r.querySelector('.error');
      check(`${tag} bare strips .field + label + .error`, ok);
      // The control itself must survive — stripping chrome must not strip the input.
      check(`${tag} bare still renders its control`, !!r.querySelector(aria));
      el.remove();
    }

    // ── 3. Error state is still SURFACED without the message row (AC: "still surfaced via attributes") ──
    for (const { tag, aria, errorHost } of CHROMED) {
      const el = await mount(tag, { label: 'Weight', error: 'Too low', bare: '' });
      const r = el.shadowRoot!;
      const c = r.querySelector(aria);
      const eh = r.querySelector(errorHost ?? aria);
      const invalid = c?.getAttribute('aria-invalid') === 'true' || !!eh?.classList.contains('has-error');
      check(`${tag} bare keeps the error state on the control`, invalid);
      // No dangling reference: the error span is gone, so aria-describedby must not point at it.
      const describedBy = c?.getAttribute('aria-describedby') ?? '';
      check(`${tag} bare has no dangling aria-describedby`, !describedBy.includes('-error'));
      // The message is not lost — it moves to `title` (hover text + accessible description).
      check(`${tag} bare surfaces the message as title`, c?.getAttribute('title') === 'Too low');
      el.remove();
    }

    // ── 4. Accessible name survives losing the visible <label> ──
    for (const { tag, aria, ownName } of CHROMED) {
      const el = await mount(tag, { label: 'Weight', bare: '' });
      const name = el.shadowRoot?.querySelector(aria)?.getAttribute('aria-label') ?? '';
      // `ownName` controls carry a per-part name of their own (b-date-range-picker's endpoints are
      // "Start date" / "End date"). fieldAria deliberately does NOT add the field label there — a second
      // aria-label on one element is a duplicate attribute, and the endpoint's own name is more useful.
      // So the guarantee is "still has an accessible name", not "has the field's label".
      check(`${tag} bare keeps an accessible name${ownName ? ' (its own)' : ' via aria-label'}`,
        ownName ? name.length > 0 : name === 'Weight');
      el.remove();
    }

    // ── 5. Chromed mode must NOT gain aria-label / title (the visible label already names it) ──
    {
      const el = await mount('b-input', { label: 'Weight', error: 'Too low' });
      const c = el.shadowRoot!.querySelector('input')!;
      check('b-input chromed has no aria-label (visible label names it)', !c.hasAttribute('aria-label'));
      check('b-input chromed has no title', !c.hasAttribute('title'));
      check('b-input chromed links the error span',
        (c.getAttribute('aria-describedby') ?? '').includes('-error'));
      el.remove();
    }

    // ── 6. `bare` is reactive (observedAttributes), not read once at first render ──
    {
      const el = await mount('b-input', { label: 'Weight' });
      check('b-input starts chromed', !!el.shadowRoot?.querySelector('.field'));
      el.setAttribute('bare', '');
      await new Promise((r) => setTimeout(r, 0));
      check('b-input toggles to bare on attribute set', !el.shadowRoot?.querySelector('.field'));
      el.removeAttribute('bare');
      await new Promise((r) => setTimeout(r, 0));
      check('b-input toggles back to chromed', !!el.shadowRoot?.querySelector('.field'));
      el.remove();
    }

    // ── 7. Bare must not cost the control its behaviour: value round-trip + typed input ──
    {
      const el = await mount('b-input', { bare: '', value: 'seed' }) as HTMLElement & { value: string };
      check('b-input bare reads its seeded value', el.value === 'seed');
      el.value = 'typed';
      check('b-input bare round-trips a set value', el.value === 'typed');
      const inner = el.shadowRoot?.querySelector('input') as HTMLInputElement;
      inner.value = 'from-dom';
      inner.dispatchEvent(new Event('input', { bubbles: true }));
      check('b-input bare reflects a DOM edit', el.value === 'from-dom');
      el.remove();
    }

    // ── 8. The datalist stays with the input in bare mode (`list=` must not dangle) ──
    {
      const el = await mount('b-input', { bare: '' }) as HTMLElement & { setSuggestions(v: string[]): void };
      el.setSuggestions(['alpha', 'beta']);
      await new Promise((r) => setTimeout(r, 0));
      const inner = el.shadowRoot?.querySelector('input') as HTMLInputElement;
      const listId = inner?.getAttribute('list') ?? '';
      const dl = el.shadowRoot?.querySelector(`datalist#${listId}`);
      check('b-input bare keeps the datalist reachable from list=',
        !!listId && !!dl && dl.querySelectorAll('option').length === 2);
      el.remove();
    }

    // ── 9. The pickers' popovers survive bare mode (they were siblings of the stripped wrapper) ──
    {
      const el = await mount('b-date-picker', { bare: '' });
      check('b-date-picker bare keeps .dp-wrap + .dp-panel',
        !!el.shadowRoot?.querySelector('.dp-wrap') && !!el.shadowRoot?.querySelector('.dp-panel'));
      el.remove();
    }
    {
      const el = await mount('b-select', { bare: '', searchable: '' });
      check('b-select bare searchable keeps .combo + .dropdown',
        !!el.shadowRoot?.querySelector('.combo') && !!el.shadowRoot?.querySelector('.dropdown'));
      el.remove();
    }
    {
      const el = await mount('b-multi-select', { bare: '' });
      check('b-multi-select bare keeps .container + .dropdown',
        !!el.shadowRoot?.querySelector('.container') && !!el.shadowRoot?.querySelector('.dropdown'));
      el.remove();
    }

    // ── 10. b-search-input is the eighth control in TASK-001's list, but it has no `.field` / label /
    // error to strip — it renders `.search-wrap` (icon + clear-button positioning) and nothing else.
    // Asserted as already-bare rather than given a no-op `bare` attribute.
    {
      const el = await mount('b-search-input', {});
      const r = el.shadowRoot!;
      check('b-search-input has no .field chrome to strip',
        !r.querySelector('.field') && !r.querySelector('label') && !!r.querySelector('.search-wrap'));
      el.remove();
    }

    // ── 11. Bare removes the .field flex gap (the point of the attribute: no extra vertical space) ──
    {
      const chromed = await mount('b-input', { label: 'Weight' });
      const bare = await mount('b-input', { label: 'Weight', bare: '' });
      // Put both in the flow so heights are real.
      for (const el of [chromed, bare]) { el.style.position = 'static'; el.style.left = '0'; }
      await new Promise((r) => setTimeout(r, 0));
      const hChromed = chromed.getBoundingClientRect().height;
      const hBare = bare.getBoundingClientRect().height;
      check(`bare is shorter than chromed (${Math.round(hBare)}px < ${Math.round(hChromed)}px)`, hBare < hChromed);
      chromed.remove();
      bare.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] bare-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] bare-smoke ${r}`);
})();
