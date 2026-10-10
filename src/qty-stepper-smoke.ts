// TASK-548 — b-qty-stepper. FlowerFurStudio sells fabric in 0.5 m steps and pieces by 1, so what has to hold:
// steps are exact (no float drift), typed text is snapped to the grid anchored at `min` and clamped, `change`
// fires once per committed value and never per keystroke, the ends become unavailable without leaving the Tab
// order, the field is a plain text field with the unit as its description (role=spinbutton lost the unit in Chrome
// and Narrator could not reach the buttons — owner's test 2026-10-10), and the form sees the canonical value. An app-assigned off-grid value is NOT snapped —
// it is reported through validity.
import 'birko-web-components/inputs';

const settle = () => new Promise((r) => setTimeout(r, 30));

type Stepper = HTMLElement & {
  value: string;
  stepBy(n: number): void;
  validity: ValidityState;
  checkValidity(): boolean;
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:24rem;padding:1rem;background:#fff;z-index:99997';
  document.body.prepend(host);

  const mount = async (html: string) => {
    host.innerHTML = html;
    await settle();
    const el = host.querySelector('b-qty-stepper') as Stepper;
    const sr = el.shadowRoot!;
    const changes: string[] = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent<{ value: string }>).detail.value));
    return {
      el, sr, changes,
      input: sr.querySelector('input')!,
      dec: sr.querySelector<HTMLButtonElement>('.dec')!,
      inc: sr.querySelector<HTMLButtonElement>('.inc')!,
    };
  };
  const type = (input: HTMLInputElement, text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  };
  const blur = (input: HTMLInputElement) => input.dispatchEvent(new FocusEvent('blur'));
  const limited = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') === 'true' && !b.disabled;
  const key = (input: HTMLInputElement, k: string) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, cancelable: true });
    input.dispatchEvent(e);
    return e.defaultPrevented;
  };

  try {
    // ── buttons, decimal step ──
    let p = await mount('<b-qty-stepper label="Fabric" name="qty" min="0.5" step="0.5" max="3" value="1" unit="m"></b-qty-stepper>');
    check(`renders the value ("${p.input.value}")`, p.input.value === '1');
    p.inc.click();
    check(`+ steps by 0.5 (value "${p.el.value}", shown "${p.input.value}")`, p.el.value === '1.5' && p.input.value === '1.5');
    check(`one change per press (${JSON.stringify(p.changes)})`, p.changes.length === 1 && p.changes[0] === '1.5');
    p.dec.click(); p.dec.click();
    check(`− twice reaches min (${p.el.value})`, p.el.value === '0.5');
    check('at min − is unavailable but still focusable (aria-disabled, not disabled); + is not', limited(p.dec) && !limited(p.inc) && !p.inc.disabled);
    check(`the press is announced with its unit ("${p.sr.querySelector('[role="status"]')?.textContent}")`,
      p.sr.querySelector('[role="status"]')?.textContent === '0.5 m');
    p.dec.click();
    check('an unavailable − does nothing', p.el.value === '0.5' && p.changes.length === 3);
    p.el.stepBy(100);
    check(`stepBy clamps to max (${p.el.value}), + unavailable there`, p.el.value === '3' && limited(p.inc) && !limited(p.dec));

    // ── no float drift ──
    p = await mount('<b-qty-stepper label="L" step="0.1" value="0"></b-qty-stepper>');
    p.inc.click(); p.inc.click(); p.inc.click();
    check(`0 + 0.1 × 3 is exactly 0.3 (value "${p.el.value}", shown "${p.input.value}")`, p.el.value === '0.3' && p.input.value === '0.3');
    for (let i = 0; i < 7; i++) p.inc.click();
    check(`ten steps of 0.1 are exactly 1 ("${p.el.value}")`, p.el.value === '1');

    // ── typed input: snap anchored at min, ties up, clamp, junk reverts ──
    p = await mount('<b-qty-stepper label="L" min="0.5" step="0.5" max="10" value="2"></b-qty-stepper>');
    type(p.input, '0.7');
    check('typing emits no change', p.changes.length === 0);
    blur(p.input);
    check(`0.7 snaps to 0.5 on blur, visibly (value "${p.el.value}", shown "${p.input.value}")`, p.el.value === '0.5' && p.input.value === '0.5');
    check('the commit emits one change', p.changes.length === 1);
    type(p.input, '0.75'); blur(p.input);
    check(`a tie (0.75) rounds up to 1 ("${p.el.value}")`, p.el.value === '1');
    type(p.input, '1,5'); blur(p.input);
    check(`a comma separator is accepted ("${p.el.value}")`, p.el.value === '1.5');
    type(p.input, '99'); blur(p.input);
    check(`over max clamps to max ("${p.el.value}")`, p.el.value === '10');
    type(p.input, '0'); blur(p.input);
    check(`under min clamps to min ("${p.el.value}")`, p.el.value === '0.5');
    const before = p.changes.length;
    type(p.input, 'abc'); blur(p.input);
    check(`junk reverts to the last value with no change (value "${p.el.value}", shown "${p.input.value}")`,
      p.el.value === '0.5' && p.input.value === '0.5' && p.changes.length === before);
    type(p.input, '3'); key(p.input, 'Enter');
    check(`Enter commits ("${p.el.value}")`, p.el.value === '3');
    p = await mount('<b-qty-stepper label="L" min="1" step="2" value="3"></b-qty-stepper>');
    type(p.input, '4'); blur(p.input);
    check(`the grid is anchored at min, not 0: 4 on 1,3,5… rounds up to 5 ("${p.el.value}")`, p.el.value === '5');

    // ── keyboard (spinbutton pattern) ──
    p = await mount('<b-qty-stepper label="L" min="0" step="1" max="50" value="5"></b-qty-stepper>');
    check('ArrowUp is handled', key(p.input, 'ArrowUp') && p.el.value === '6');
    check(`a keyboard step is announced ("${p.sr.querySelector('[role="status"]')?.textContent}")`, p.sr.querySelector('[role="status"]')?.textContent === '6');
    key(p.input, 'ArrowDown');
    check(`ArrowDown steps down ("${p.el.value}")`, p.el.value === '5');
    key(p.input, 'PageUp');
    check(`PageUp steps ×10 ("${p.el.value}")`, p.el.value === '15');
    key(p.input, 'PageDown');
    check(`PageDown steps ×10 ("${p.el.value}")`, p.el.value === '5');
    key(p.input, 'End');
    check(`End goes to max ("${p.el.value}")`, p.el.value === '50');
    key(p.input, 'Home');
    check(`Home goes to min ("${p.el.value}")`, p.el.value === '0');
    p = await mount('<b-qty-stepper label="L" value="5"></b-qty-stepper>');
    check('End without max is left to the text field', !key(p.input, 'End') && p.el.value === '5');
    check('other keys are not swallowed', !key(p.input, 'a'));

    // ── ARIA ──
    p = await mount('<b-qty-stepper label="Fabric" min="0.5" step="0.5" max="10" value="1.5" unit="m"></b-qty-stepper>');
    check('the field is a plain text field (no spinbutton role)', !p.input.hasAttribute('role') && p.input.type === 'text');
    check('no aria-value* (Chrome drops aria-valuetext on a text input)', !p.input.hasAttribute('aria-valuenow') && !p.input.hasAttribute('aria-valuetext'));
    const unitEl = p.sr.querySelector('.unit');
    check(`the unit is the field's description (describedby "${p.input.getAttribute('aria-describedby')}")`,
      !!unitEl && (p.input.getAttribute('aria-describedby') ?? '').split(' ').includes(unitEl.id) && unitEl.textContent === 'm' && !unitEl.hasAttribute('aria-hidden'));
    check('the field is named by its label', p.input.getAttribute('aria-labelledby') === `${p.sr.querySelector('label')?.id}`);
    check(`the buttons are named ("${p.dec.getAttribute('aria-label')}", "${p.inc.getAttribute('aria-label')}")`,
      p.dec.getAttribute('aria-label') === 'Decrease Fabric' && p.inc.getAttribute('aria-label') === 'Increase Fabric');
    check('the buttons are in the Tab order: −, field, +', p.dec.tabIndex === 0 && p.inc.tabIndex === 0
      && !!(p.dec.compareDocumentPosition(p.input) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(p.input.compareDocumentPosition(p.inc) & Node.DOCUMENT_POSITION_FOLLOWING));
    p = await mount('<b-qty-stepper bare></b-qty-stepper>');
    check(`unlabelled: the buttons fall back to "Decrease" / "Increase" ("${p.dec.getAttribute('aria-label')}")`,
      p.dec.getAttribute('aria-label') === 'Decrease' && p.inc.getAttribute('aria-label') === 'Increase');
    p = await mount('<b-qty-stepper label="L" label-increment="Pridať" label-decrement="Ubrať"></b-qty-stepper>');
    check('label-increment / label-decrement override', p.inc.getAttribute('aria-label') === 'Pridať' && p.dec.getAttribute('aria-label') === 'Ubrať');
    check('empty: the field is blank and neither button is unavailable', p.input.value === '' && !limited(p.dec) && !limited(p.inc));
    p.inc.click();
    check(`+ from empty lands on min ("${p.el.value}")`, p.el.value === '0');

    // ── app-assigned values are kept, and reported ──
    p = await mount('<b-qty-stepper label="L" min="0.5" step="0.5" max="10" value="0.7"></b-qty-stepper>');
    check(`an off-grid attribute value is kept verbatim ("${p.el.value}")`, p.el.value === '0.7');
    check('…and reported as stepMismatch', p.el.validity.stepMismatch && !p.el.checkValidity());
    p.inc.click();
    check(`+ from 0.7 lands on the next grid point, 1 ("${p.el.value}")`, p.el.value === '1' && p.el.checkValidity());
    p.el.value = '0.6';
    p.dec.click();
    check(`− from 0.6 lands on 0.5 ("${p.el.value}")`, p.el.value === '0.5');
    p.el.value = '12';
    check('an over-max property value is rangeOverflow', p.el.validity.rangeOverflow);
    check('a property assignment emits no change', p.changes.length === 2);
    p.el.value = '0.2';
    check('an under-min property value is rangeUnderflow', p.el.validity.rangeUnderflow);

    // ── form association ──
    host.innerHTML = '<form><b-qty-stepper label="L" name="qty" step="0.5" value="1.5"></b-qty-stepper><b-qty-stepper label="R" name="r" required></b-qty-stepper></form>';
    await settle();
    const form = host.querySelector('form')!;
    const [a, r] = Array.from(form.querySelectorAll('b-qty-stepper')) as Stepper[];
    check(`FormData carries the canonical value ("${new FormData(form).get('qty')}")`, new FormData(form).get('qty') === '1.5');
    check('an empty required stepper is valueMissing', r.validity.valueMissing);
    check('an empty stepper submits nothing', !new FormData(form).has('r'));
    a.shadowRoot!.querySelector<HTMLButtonElement>('.inc')!.click();
    check(`a press updates FormData ("${new FormData(form).get('qty')}")`, new FormData(form).get('qty') === '2');
    form.reset();
    await settle();
    check(`form.reset() returns to the markup value ("${a.value}", shown "${a.shadowRoot!.querySelector('input')!.value}")`,
      a.value === '1.5' && a.shadowRoot!.querySelector('input')!.value === '1.5');

    // ── disabled ──
    p = await mount('<b-qty-stepper label="L" value="2" disabled></b-qty-stepper>');
    check('disabled: field and both buttons truly disabled', p.input.disabled && p.dec.disabled && p.inc.disabled && !p.dec.hasAttribute('aria-disabled'));
    key(p.input, 'ArrowUp');
    check('disabled: keys do nothing', p.el.value === '2');
    p.el.removeAttribute('disabled');
    await settle();
    p = { ...p, input: p.sr.querySelector('input')!, dec: p.sr.querySelector('.dec')!, inc: p.sr.querySelector('.inc')! };
    check('re-enabled: the buttons work again', !p.inc.disabled && !p.dec.disabled);

    // ── bare ──
    p = await mount('<b-qty-stepper bare size="sm" label="Qty" value="1"></b-qty-stepper>');
    check('bare: no field chrome', !p.sr.querySelector('.field'));
    check('bare: the field keeps its name', p.input.getAttribute('aria-label') === 'Qty');

    // ── a re-render mid-typing keeps the draft ──
    p = await mount('<b-qty-stepper label="L" value="1"></b-qty-stepper>');
    type(p.input, '4');
    p.el.setAttribute('hint', 'x');
    await settle();
    check(`a re-render keeps what is being typed ("${p.sr.querySelector('input')!.value}")`, p.sr.querySelector('input')!.value === '4');
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] qty-stepper-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] qty-stepper-smoke ${r}`);
})();
