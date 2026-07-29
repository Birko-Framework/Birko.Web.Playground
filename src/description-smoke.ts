// EPIC-001 `description` attribute smoke — the persistent help-text row under a form control, wired into
// `aria-describedby` so a screen reader announces it as that field's description (which a consumer's own
// sibling element cannot be, since the real control is in shadow DOM).
//
// Runs in a real browser via the playground's headless verify (see bare-smoke.ts for why).
import 'birko-web-components/inputs';

async function mount(tag: string, attrs: Record<string, string>): Promise<HTMLElement> {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

/** Where each control's ARIA lands — the wrapper wins document order, so spell it out (see bare-smoke). */
const CONTROLS: { tag: string; aria: string; ownName?: boolean; errorHost?: string }[] = [
  { tag: 'b-input', aria: 'input' },
  { tag: 'b-select', aria: 'select' },
  { tag: 'b-textarea', aria: 'textarea' },
  { tag: 'b-multi-select', aria: '.container' },
  { tag: 'b-tag-input', aria: '.container input' },
  { tag: 'b-date-picker', aria: '.dp-input' },
  { tag: 'b-datetime-picker', aria: '.dp-input' },
  // Migrated onto renderField in the same pass that fixed the b-search-input size bug — they rendered
  // the stacked chrome by hand and so had neither `bare` nor `description`.
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
    // ── 1. All seven render the row and reference it — no silent no-ops ──
    for (const { tag, aria } of CONTROLS) {
      const el = await mount(tag, { label: 'Steps', description: 'Goal 8000 steps' });
      const r = el.shadowRoot!;
      const help = r.querySelector('.help');
      check(`${tag} renders the description row`, !!help && help.textContent === 'Goal 8000 steps');
      const id = help?.getAttribute('id') ?? '';
      check(`${tag} description span has a uid-scoped id`, /-help$/.test(id));
      const describedBy = r.querySelector(aria)?.getAttribute('aria-describedby') ?? '';
      check(`${tag} aria-describedby references the description`, !!id && describedBy.split(' ').includes(id));
      el.remove();
    }

    // ── 2. No description → no row, no reference ──
    for (const { tag, aria } of CONTROLS) {
      const el = await mount(tag, { label: 'Steps' });
      const r = el.shadowRoot!;
      check(`${tag} renders no row without a description`, !r.querySelector('.help'));
      const describedBy = r.querySelector(aria)?.getAttribute('aria-describedby') ?? '';
      check(`${tag} has no dangling -help reference`, !describedBy.includes('-help'));
      el.remove();
    }

    // ── 3. Error AND description: both described, error first ──
    {
      const el = await mount('b-input', { label: 'Steps', description: 'Goal 8000 steps', error: 'Too low' });
      const r = el.shadowRoot!;
      check('both rows render together', !!r.querySelector('.help') && !!r.querySelector('.error'));
      const ids = (r.querySelector('input')?.getAttribute('aria-describedby') ?? '').split(' ');
      check('aria-describedby lists both ids', ids.length === 2);
      check('the error id comes first (urgency beats reading order)',
        ids[0].endsWith('-error') && ids[1].endsWith('-help'));
      // Neither replaces the other, and both ids resolve to a real element.
      check('both referenced ids resolve', ids.every((i) => !!r.getElementById(i)));
      el.remove();
    }

    // ── 4. Visual order is control → description → error (the inverse of the ARIA priority) ──
    {
      const el = await mount('b-input', { label: 'Steps', description: 'Goal 8000', error: 'Too low' });
      const field = el.shadowRoot!.querySelector('.field')!;
      const kids = [...field.children].map((c) => c.className || c.tagName.toLowerCase());
      const help = kids.findIndex((c) => c === 'help');
      const err = kids.findIndex((c) => c === 'error');
      const input = kids.findIndex((c) => c === 'input');
      check(`rows are ordered control → help → error (${kids.join(' | ')})`, input < help && help < err);
      el.remove();
    }

    // ── 5. `hint` and `description` are independent — a field can carry both presentations ──
    {
      const el = await mount('b-input', { label: 'Sets', hint: 'Back-to-back = superset', description: 'Max 10' });
      const r = el.shadowRoot!;
      check('hint still renders as the ? tooltip', !!r.querySelector('b-tooltip .hint-icon'));
      check('description renders as the text row alongside it', r.querySelector('.help')?.textContent === 'Max 10');
      el.remove();
    }

    // ── 6. It is escaped (renderHelp escapes; renderError requires pre-escaped input) ──
    {
      const el = await mount('b-input', { label: 'X', description: '<img src=x onerror=alert(1)> & "quoted"' });
      const help = el.shadowRoot!.querySelector('.help')!;
      check('description does not inject markup', !help.querySelector('img'));
      check('description text survives verbatim',
        help.textContent === '<img src=x onerror=alert(1)> & "quoted"');
      el.remove();
    }

    // ── 7. bare drops the row, exactly as it drops the error row ──
    {
      const el = await mount('b-input', { label: 'Steps', description: 'Goal 8000 steps', bare: '' });
      const r = el.shadowRoot!;
      const input = r.querySelector('input')!;
      check('bare renders no description row', !r.querySelector('.help'));
      check('bare has no dangling aria-describedby', !(input.getAttribute('aria-describedby') ?? '').includes('-help'));
      check('bare surfaces the description as title instead', input.getAttribute('title') === 'Goal 8000 steps');
      el.remove();
    }
    {
      // With both, the error claims `title` — a single string must not mix an urgent failure with
      // standing help text, and the error is the one that matters.
      const el = await mount('b-input', { label: 'Steps', description: 'Goal 8000', error: 'Too low', bare: '' });
      const input = el.shadowRoot!.querySelector('input')!;
      check('bare + both: title carries the error, not the description', input.getAttribute('title') === 'Too low');
      check('bare + both: aria-invalid still set', input.getAttribute('aria-invalid') === 'true');
      el.remove();
    }

    // ── 8. Reactive: the row appears/disappears on attribute change ──
    {
      const el = await mount('b-input', { label: 'Steps' });
      check('starts with no description row', !el.shadowRoot?.querySelector('.help'));
      el.setAttribute('description', 'Goal 8000 steps');
      await new Promise((r) => setTimeout(r, 0));
      check('description appears on attribute set', !!el.shadowRoot?.querySelector('.help'));
      el.removeAttribute('description');
      await new Promise((r) => setTimeout(r, 0));
      check('description disappears on attribute removal', !el.shadowRoot?.querySelector('.help'));
      el.remove();
    }

    // ── 9. b-form schema key drives it ──
    {
      const host = document.createElement('b-form') as HTMLElement & { setSchema(s: unknown): void };
      host.style.position = 'absolute';
      host.style.left = '-9999px';
      document.body.appendChild(host);
      host.setSchema({
        name: 'root',
        children: [{ name: 'steps', type: 'number', label: 'Steps', description: 'Goal 8000 steps' }],
      });
      await new Promise((r) => setTimeout(r, 30));
      const field = host.shadowRoot?.querySelector('[data-field="steps"] b-input') as HTMLElement | null;
      check('b-form forwards the schema description to the control',
        field?.getAttribute('description') === 'Goal 8000 steps');
      check('b-form-rendered control shows the row',
        field?.shadowRoot?.querySelector('.help')?.textContent === 'Goal 8000 steps');
      host.remove();
    }

    // ── 10. The row is muted, not the error colour (it is context, not a failure) ──
    {
      const el = await mount('b-input', { label: 'Steps', description: 'Goal 8000', error: 'Too low' });
      const r = el.shadowRoot!;
      const helpColor = getComputedStyle(r.querySelector('.help')!).color;
      const errColor = getComputedStyle(r.querySelector('.error')!).color;
      check(`description colour differs from the error colour (${helpColor} vs ${errColor})`, helpColor !== errColor);
      el.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] description-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] description-smoke ${r}`);
})();
