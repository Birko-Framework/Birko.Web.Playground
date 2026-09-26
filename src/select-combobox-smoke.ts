// TASK-489 — `b-select`'s searchable mode is an ARIA 1.2 combobox: roles and IDREFs that resolve, arrow keys
// that move a highlight tracked by aria-activedescendant, Enter on the highlight, and focus that stays in
// the field (the Enter/Escape paths used to blur it onto <body>).
import 'birko-web-components/inputs';

type Select = HTMLElement & { value: string; setOptions(o: { value: string; label: string; group?: string }[]): void };

const OPTIONS = [
  { value: 'header', label: 'Header' },
  { value: 'footer', label: 'Footer' },
  { value: 'sidebar', label: 'Sidebar' },
];

const settle = () => new Promise((r) => setTimeout(r, 30));

async function mount(attrs: string, options: { value: string; label: string; group?: string }[] = OPTIONS): Promise<Select> {
  const wrap = document.createElement('div');
  wrap.style.position = 'absolute';
  wrap.style.left = '-9999px';
  document.body.appendChild(wrap);
  wrap.innerHTML = `<b-select name="g" label="Group" ${attrs}></b-select>`;
  await settle();
  const el = wrap.querySelector('b-select') as Select;
  el.setOptions(options);
  await settle();
  return el;
}

const inputOf = (el: Select) => el.shadowRoot!.querySelector('.combo-input') as HTMLInputElement;
const listbox = (el: Select) => el.shadowRoot!.querySelector('[role="listbox"]') as HTMLElement | null;
const active = (el: Select) => {
  const id = inputOf(el).getAttribute('aria-activedescendant');
  return id ? el.shadowRoot!.getElementById(id) : null;
};

function key(el: Select, k: string): KeyboardEvent {
  const input = inputOf(el);
  input.focus();
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
  input.dispatchEvent(ev);
  return ev;
}

function type(el: Select, text: string) {
  const input = inputOf(el);
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. Roles and IDREFs ──
    {
      const el = await mount('searchable value="footer"');
      const input = inputOf(el);
      check('the input is a combobox', input.getAttribute('role') === 'combobox');
      check('...with aria-autocomplete="list"', input.getAttribute('aria-autocomplete') === 'list');
      check('...collapsed while closed', input.getAttribute('aria-expanded') === 'false');
      const lb = listbox(el);
      check('aria-controls resolves to the listbox', !!lb && input.getAttribute('aria-controls') === lb.id);
      const opts = [...el.shadowRoot!.querySelectorAll('[role="option"]')];
      check(`every row is an option with an id (${opts.length})`, opts.length === 3 && opts.every((o) => !!o.id));
      check('...and only the selected one is aria-selected',
        opts.filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent?.trim()).join() === 'Footer');
      el.parentElement!.remove();
    }

    // ── 2. Arrow keys ──
    {
      const el = await mount('searchable value="footer"');
      const down = key(el, 'ArrowDown');
      check('ArrowDown opens the list', inputOf(el).getAttribute('aria-expanded') === 'true');
      check('...and is consumed (no caret move / page scroll)', down.defaultPrevented);
      check('...highlighting the selected option first', active(el)?.textContent?.trim() === 'Footer');
      check('...marked .active', !!active(el)?.classList.contains('active'));
      key(el, 'ArrowDown');
      check('ArrowDown moves to the next option', active(el)?.textContent?.trim() === 'Sidebar');
      key(el, 'ArrowDown');
      check('...and stops at the last', active(el)?.textContent?.trim() === 'Sidebar');
      key(el, 'ArrowUp');
      key(el, 'ArrowUp');
      key(el, 'ArrowUp');
      check('ArrowUp moves back and stops at the first', active(el)?.textContent?.trim() === 'Header');
      check('only one row is .active', el.shadowRoot!.querySelectorAll('.option.active').length === 1);

      const enter = key(el, 'Enter');
      check('Enter selects the highlighted option', el.value === 'header');
      check('...consuming the Enter (no form submit)', enter.defaultPrevented);
      check('...collapses the list', inputOf(el).getAttribute('aria-expanded') === 'false');
      check('...and clears aria-activedescendant', !inputOf(el).hasAttribute('aria-activedescendant'));
      check('focus stays in the field', el.shadowRoot!.activeElement === inputOf(el));
      el.parentElement!.remove();
    }

    // ── 3. Typing resets the highlight; the create row is reachable ──
    {
      const el = await mount('searchable creatable');
      key(el, 'ArrowDown');
      type(el, 'qux'); // matches no option, so the create row is the only row
      check('typing clears the highlight', active(el) === null);
      key(el, 'ArrowDown');
      check('ArrowDown reaches the create row', !!active(el)?.classList.contains('option-create'));
      key(el, 'Enter');
      check('...and Enter on it creates the value', el.value === 'qux');
      el.parentElement!.remove();
    }

    // ── 4. No matches is not navigable ──
    {
      const el = await mount('searchable');
      type(el, 'zzz');
      const none = el.shadowRoot!.querySelector('.no-results');
      check('"No matches" is a disabled option', none?.getAttribute('aria-disabled') === 'true');
      key(el, 'ArrowDown');
      check('...that ArrowDown cannot highlight', active(el) === null);
      el.parentElement!.remove();
    }

    // ── 5. Escape keeps focus ──
    {
      const el = await mount('searchable value="header"');
      key(el, 'ArrowDown');
      key(el, 'Escape');
      check('Escape collapses the list', inputOf(el).getAttribute('aria-expanded') === 'false');
      check('...keeps focus in the field', el.shadowRoot!.activeElement === inputOf(el));
      check('...and keeps the value', el.value === 'header');
      el.parentElement!.remove();
    }

    // ── 6. Groups are groups, never options ──
    {
      const el = await mount('searchable', [
        { value: 'a', label: 'Apple', group: 'Fruit' },
        { value: 'b', label: 'Beet', group: 'Veg' },
      ]);
      const groups = [...el.shadowRoot!.querySelectorAll('[role="group"]')];
      check(`options are wrapped in labelled groups (${groups.length})`, groups.length === 2 &&
        groups.every((g) => el.shadowRoot!.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent?.trim()));
      const optionTexts = [...el.shadowRoot!.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
      check('group headers are not options', optionTexts.join() === 'Apple,Beet');
      key(el, 'ArrowDown');
      key(el, 'ArrowDown');
      check('arrows skip group headers', active(el)?.textContent?.trim() === 'Beet');
      el.parentElement!.remove();
    }

    // ── 7. Native mode untouched ──
    {
      const el = await mount('');
      check('a non-searchable select is still a native <select>', !!el.shadowRoot!.querySelector('select') && !listbox(el));
      el.parentElement!.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] select-combobox-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] select-combobox-smoke ${r}`);
})();
