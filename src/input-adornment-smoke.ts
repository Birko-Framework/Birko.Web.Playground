// TASK-484 — b-input `prefix` / `suffix` slots and `clearable`. Presenter's landing page needs a × inside its
// URL field; the button-beside-the-field workaround shifted the row as it came and went. What is easy to get
// wrong, and so what this asserts in a real layout: the text must clear the adornment at EVERY size (the
// size variants set the padding shorthand, which resets a per-side padding — the b-search-input trap), the
// padding must only grow when a slot is actually filled, and the × appearing must not move anything.
import 'birko-web-components/inputs';
import { focusable } from './smoke-focus';

const settle = () => new Promise((r) => setTimeout(r, 60));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // On-screen: the checks are about measured boxes, so layout has to run.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:24rem;padding:1rem;background:#fff;z-index:99998';
  document.body.prepend(host);

  const parts = () => {
    const el = host.querySelector('b-input') as HTMLElement & { value: string };
    const sr = el.shadowRoot!;
    return {
      el, sr,
      input: sr.querySelector('input')!,
      clear: sr.querySelector<HTMLButtonElement>('.clear'),
    };
  };
  /** The input's text area — its box minus padding and border. */
  const textBox = (input: HTMLInputElement) => {
    const b = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    return {
      left: b.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
      right: b.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth),
    };
  };

  try {
    for (const size of ['sm', '', 'lg']) {
      const name = size || 'md';
      const sizeAttr = size ? `size="${size}"` : '';

      // Baseline: the same size with nothing slotted keeps the size variant's own padding.
      host.innerHTML = `<b-input label="U" ${sizeAttr}></b-input>`;
      await settle();
      const plain = getComputedStyle(parts().input);
      const basePad = [plain.paddingLeft, plain.paddingRight];

      host.innerHTML = `<b-input label="U" ${sizeAttr}><span slot="prefix">https://</span></b-input>`;
      await settle();
      let p = parts();
      check(`${name}: an empty suffix leaves the size variant's end padding (${getComputedStyle(p.input).paddingRight} vs ${basePad[1]})`,
        getComputedStyle(p.input).paddingRight === basePad[1]);
      const prefix = host.querySelector('[slot="prefix"]')!.getBoundingClientRect();
      const tb = textBox(p.input);
      check(`${name}: the prefix renders inside the field box (prefix ${prefix.left.toFixed(0)}-${prefix.right.toFixed(0)}, input ${p.input.getBoundingClientRect().left.toFixed(0)}-${p.input.getBoundingClientRect().right.toFixed(0)})`,
        prefix.width > 0 && prefix.left >= p.input.getBoundingClientRect().left && prefix.right <= p.input.getBoundingClientRect().right);
      check(`${name}: text starts after the prefix (text from ${tb.left.toFixed(1)}, prefix ends ${prefix.right.toFixed(1)})`, tb.left >= prefix.right);
      const ib = p.input.getBoundingClientRect();
      const midOff = Math.abs((prefix.top + prefix.height / 2) - (ib.top + ib.height / 2));
      check(`${name}: the prefix is vertically centred (off by ${midOff.toFixed(1)}px)`, midOff <= 1);

      // clearable + slotted suffix: the × sits after the suffix, both clear of the text, and appearing changes nothing.
      host.innerHTML = `<b-input label="U" clearable ${sizeAttr}><span slot="suffix">.cz</span></b-input>`;
      await settle();
      p = parts();
      const emptyBox = p.el.getBoundingClientRect();
      const emptyPad = getComputedStyle(p.input).paddingRight;
      check(`${name}: the × is hidden while the value is empty`, !!p.clear && getComputedStyle(p.clear).visibility === 'hidden');
      p.el.value = 'https://example.com/a/very/long/path/that/would/run/under/the/clear/button';
      await settle();
      check(`${name}: the × shows once there is a value`, !!p.clear && getComputedStyle(p.clear).visibility === 'visible');
      const filledBox = p.el.getBoundingClientRect();
      check(`${name}: no layout shift as the × appears (${emptyBox.width}x${emptyBox.height} → ${filledBox.width}x${filledBox.height}, end padding ${emptyPad} → ${getComputedStyle(p.input).paddingRight})`,
        emptyBox.width === filledBox.width && emptyBox.height === filledBox.height && emptyPad === getComputedStyle(p.input).paddingRight);
      const suffix = host.querySelector('[slot="suffix"]')!.getBoundingClientRect();
      const cb = p.clear!.getBoundingClientRect();
      check(`${name}: the × sits after the slotted suffix (suffix ends ${suffix.right.toFixed(1)}, × starts ${cb.left.toFixed(1)})`, cb.left >= suffix.right);
      check(`${name}: text ends before the suffix (text to ${textBox(p.input).right.toFixed(1)}, suffix from ${suffix.left.toFixed(1)})`,
        textBox(p.input).right <= suffix.left);
      check(`${name}: the × does not grow the field (input ${p.input.getBoundingClientRect().height.toFixed(1)}px, × ${cb.height.toFixed(1)}px)`,
        cb.top >= p.input.getBoundingClientRect().top && cb.bottom <= p.input.getBoundingClientRect().bottom);
    }

    // slotchange: the padding follows the slot, not the first render.
    host.innerHTML = '<b-input label="U"></b-input>';
    await settle();
    let p = parts();
    const before = getComputedStyle(p.input).paddingLeft;
    const icon = document.createElement('span');
    icon.slot = 'prefix';
    icon.textContent = '@@@@';
    p.el.appendChild(icon);
    await settle();
    const grown = getComputedStyle(p.input).paddingLeft;
    icon.remove();
    await settle();
    const after = getComputedStyle(p.input).paddingLeft;
    check(`slotchange: the start padding grows with a prefix and returns without one (${before} → ${grown} → ${after})`,
      parseFloat(grown) > parseFloat(before) && after === before);

    // Clearing: value, events, focus, form value.
    host.innerHTML = '<form><b-input label="U" name="url" clearable value="https://x.cz"></b-input></form>';
    await settle();
    p = parts();
    const form = host.querySelector('form')!;
    check(`clear: precondition — the form carries the value (${new FormData(form).get('url')})`, new FormData(form).get('url') === 'https://x.cz');
    check(`clear: the × has its accessible name ("${p.clear?.getAttribute('aria-label')}")`, p.clear?.getAttribute('aria-label') === 'Clear');
    check('clear: the × is a type="button", so it never submits the form', p.clear?.type === 'button');
    const changes: string[] = [];
    let nativeInputs = 0;
    p.el.addEventListener('change', (e) => changes.push(String((e as CustomEvent).detail?.value)));
    p.el.addEventListener('input', () => nativeInputs++);
    check('clear: precondition — the × can take focus (Tab reaches it; no modal holding the page)', await focusable(p.sr, p.clear!));
    p.clear!.click();
    check(`clear: the value is emptied ("${p.input.value}" / "${p.el.value}")`, p.input.value === '' && p.el.value === '');
    check(`clear: emits change with the empty value, as a keystroke does (${JSON.stringify(changes)})`, changes.length === 1 && changes[0] === '');
    check(`clear: the native input event leaves the shadow root, as a keystroke's does (${nativeInputs})`, nativeInputs === 1);
    check('clear: focus returns to the input', p.sr.activeElement === p.input);
    // An empty b-input contributes no entry at all (form-assoc-smoke pins that); a clear must match a keystroke.
    check(`clear: the form drops the entry, as for an emptied field (${JSON.stringify(new FormData(form).get('url'))})`, !new FormData(form).has('url'));
    await settle();
    check('clear: the × hides again once the value is gone', getComputedStyle(p.clear!).visibility === 'hidden');
    p.el.setAttribute('error', 'x');
    await settle();
    p.el.removeAttribute('error');
    await settle();
    check(`clear: a re-render does not spring the old value back ("${parts().input.value}")`, parts().input.value === '');

    // Typing shows the ×, the way a user gets there.
    p = parts();
    p.input.value = 'a';
    p.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    check('typing: the × shows on the first keystroke', getComputedStyle(parts().clear!).visibility === 'visible');

    // label-clear wins over i18n.
    host.innerHTML = '<b-input label="U" clearable label-clear="Vymazat adresu" value="a"></b-input>';
    await settle();
    check(`label-clear overrides the label ("${parts().clear?.getAttribute('aria-label')}")`, parts().clear?.getAttribute('aria-label') === 'Vymazat adresu');

    // disabled hides the ×.
    host.innerHTML = '<b-input label="U" clearable disabled value="a"></b-input>';
    await settle();
    check('disabled: no × is rendered', parts().clear === null);
    parts().el.removeAttribute('disabled');
    await settle();
    check('disabled: re-enabling brings the × back', parts().clear !== null);

    // bare keeps working, with the × inside the box.
    host.innerHTML = '<b-input bare size="sm" label="U" clearable value="abc"></b-input>';
    await settle();
    p = parts();
    check('bare: no field chrome, the × still rendered', !p.sr.querySelector('.field') && !!p.clear);
    check('bare: the input keeps its accessible name', p.input.getAttribute('aria-label') === 'U');
    p.clear!.click();
    check('bare: clearing works', p.el.value === '');

    // Without clearable or slots, nothing changes.
    host.innerHTML = '<b-input label="U" value="a"></b-input>';
    await settle();
    check('default: no × without clearable', parts().clear === null && parts().input.style.paddingInlineEnd === '' && parts().input.style.paddingInlineStart === '');
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();
  // gallery-smoke opens a modal dialog and moves focus; it waits for this so the geometry above is measured undisturbed.
  (window as unknown as { __inputAdornmentSmokeDone?: boolean }).__inputAdornmentSmokeDone = true;

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] input-adornment-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] input-adornment-smoke ${r}`);
})();
