// TASK-579 — b-rating: a form-associated whole-star input. The stars are labels for visually hidden native radios, so
// the radios' own behaviour (one tab stop, arrow keys) needs real key presses and is checked by keyboard-check.mjs.
// This suite covers the rest: names, form association, required, reset, read-only, disabled, Home/End, and the
// WCAG 1.4.11 contrast of a filled star's fill and an empty star's outline in every shipped theme.
import 'birko-web-components/inputs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};
type Rating = HTMLElement & { value: string; checkValidity(): boolean };

/** Relative luminance contrast of two computed `rgb()`/`rgba()` colours (alpha ignored: themes use opaque colours). */
const contrast = (a: string, b: string): number => {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px';
  document.body.appendChild(host);
  const mount = async (html: string): Promise<Rating> => {
    host.innerHTML = html;
    const el = host.querySelector<Rating>('b-rating')!;
    await waitFor(() => !!el.shadowRoot?.querySelector('.stars'));
    await sleep(20);
    return el;
  };
  const radios = (el: Rating) => [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const stars = (el: Rating) => [...el.shadowRoot!.querySelectorAll<HTMLElement>('.star')];

  try {
    // ── 1. Structure and names ──
    {
      const el = await mount('<b-rating name="stars" label="Your rating"></b-rating>');
      const group = el.shadowRoot!.querySelector('[role="radiogroup"]');
      check('precondition: a radiogroup renders', !!group);
      const names = radios(el).map((r) => r.getAttribute('aria-label'));
      check(`five radios named "n of 5" (got ${JSON.stringify(names)})`,
        JSON.stringify(names) === JSON.stringify(['1 of 5', '2 of 5', '3 of 5', '4 of 5', '5 of 5']));
      check('one radio group: every radio shares one name', new Set(radios(el).map((r) => r.name)).size === 1);
      check('the group is labelled by the field label', group?.getAttribute('aria-labelledby') === `${el.shadowRoot!.querySelector('.field label, .field [id$="-label"]')?.id}`);
      check('the star graphics are hidden from assistive tech', stars(el).every((s) => s.getAttribute('aria-hidden') === 'true'));
      check('unrated: value is empty and no star is filled', el.value === '' && stars(el).every((s) => !s.classList.contains('filled')));

      const max7 = await mount('<b-rating max="7" value="3"></b-rating>');
      check(`max="7" renders seven radios, value 3 fills three (${radios(max7).length}, ${stars(max7).filter((s) => s.classList.contains('filled')).length})`,
        radios(max7).length === 7 && stars(max7).filter((s) => s.classList.contains('filled')).length === 3);
      const bad = await mount('<b-rating max="99" value="2.5"></b-rating>');
      check(`an out-of-range max falls back to 5, a fractional value reads as unrated (${radios(bad).length}, "${bad.value}")`,
        radios(bad).length === 5 && bad.value === '');
    }

    // ── 2. A pick: change event, value, FormData; a programmatic set fires nothing ──
    {
      host.innerHTML = '<form><b-rating name="stars" value="2"></b-rating></form>';
      const el = host.querySelector<Rating>('b-rating')!;
      await waitFor(() => !!el.shadowRoot?.querySelector('.stars'));
      const form = host.querySelector('form')!;
      const events: string[] = [];
      el.addEventListener('change', (e) => events.push(JSON.stringify((e as CustomEvent).detail)));
      check(`the markup value submits (${new FormData(form).get('stars')})`, new FormData(form).get('stars') === '2');

      stars(el)[3].click(); // the 4th star's label
      await sleep(20);
      check(`clicking the 4th star picks 4 (value "${el.value}", FormData ${new FormData(form).get('stars')})`,
        el.value === '4' && new FormData(form).get('stars') === '4');
      check(`the pick fires one change {name, value} (${events.join(' ')})`, events.length === 1 && events[0] === '{"name":"stars","value":"4"}');
      check('four stars are filled after the pick', stars(el).filter((s) => s.classList.contains('filled')).length === 4);
      check('the user pick leaves the value attribute (the reset default) alone', el.getAttribute('value') === '2');

      el.value = '5';
      await sleep(20);
      check(`a programmatic set changes the value without a change event (value "${el.value}", events ${events.length})`,
        el.value === '5' && events.length === 1);

      // Home / End are the component's own (radios lack them), so a dispatched key reaches the handler.
      const r = radios(el);
      r[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
      await sleep(20);
      // Focus moving with them is asserted with real keys in keyboard-check.mjs: this page runs off-screen beside
      // suites that move focus, so activeElement here is not this suite's to assert.
      check(`Home picks the first star ("${el.value}", checked ${r.findIndex((x) => x.checked) + 1})`, el.value === '1' && r[0].checked);
      r[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      await sleep(20);
      check(`End picks the last star ("${el.value}", checked ${r.findIndex((x) => x.checked) + 1})`, el.value === '5' && r[4].checked);

      form.reset();
      await sleep(30);
      check(`form.reset() restores the value attribute ("${el.value}")`, el.value === '2' && stars(el).filter((s) => s.classList.contains('filled')).length === 2);
      el.setAttribute('value', '4');
      await sleep(30);
      check(`after a reset the attribute drives the value again, as natively ("${el.value}")`, el.value === '4');
      stars(el)[0].click();
      await sleep(20);
      el.setAttribute('value', '3');
      await sleep(30);
      check(`after a user pick an attribute change is ignored, as natively ("${el.value}")`, el.value === '1');
    }

    // ── 2b. value set before a larger max arrives is kept ──
    {
      const el = await mount('<b-rating></b-rating>');
      el.value = '7';
      el.setAttribute('max', '10');
      await sleep(30);
      check(`value 7 set before max="10" survives ("${el.value}", ${radios(el).filter((r) => r.checked).map((r) => r.value)})`,
        el.value === '7' && radios(el)[6]?.checked === true);
    }

    // ── 3. required, unrated submits nothing ──
    {
      host.innerHTML = '<form><b-rating name="stars" required></b-rating></form>';
      const el = host.querySelector<Rating>('b-rating')!;
      await waitFor(() => !!el.shadowRoot?.querySelector('.stars'));
      const form = host.querySelector('form')!;
      check('unrated: nothing is submitted', !new FormData(form).has('stars'));
      check('required and unrated: the form is invalid', !form.checkValidity());
      stars(el)[0].click();
      await sleep(20);
      check('rated: the form is valid', form.checkValidity());
    }

    // ── 4. readonly: an image, no inputs, no tab stop ──
    {
      const el = await mount('<b-rating value="4" readonly></b-rating>');
      const img = el.shadowRoot!.querySelector('[role="img"]');
      check(`readonly is an image named "${img?.getAttribute('aria-label')}"`, img?.getAttribute('aria-label') === 'Rated 4 of 5');
      el.value = '2';
      await sleep(20);
      const renamed = el.shadowRoot!.querySelector('[role="img"]')?.getAttribute('aria-label');
      check(`a value set by script reaches the read-only name ("${renamed}"), not only the stars`,
        renamed === 'Rated 2 of 5' && stars(el).filter((s) => s.classList.contains('filled')).length === 2);
      check('readonly renders no radios and nothing focusable', radios(el).length === 0 && !el.shadowRoot!.querySelector('[tabindex], input, button'));
      const none = await mount('<b-rating readonly></b-rating>');
      check(`unrated readonly reads "${none.shadowRoot!.querySelector('[role="img"]')?.getAttribute('aria-label')}"`,
        none.shadowRoot!.querySelector('[role="img"]')?.getAttribute('aria-label') === 'Not rated');
      host.innerHTML = '<form><b-rating name="stars" value="3" readonly required></b-rating></form>';
      await sleep(40);
      const form = host.querySelector('form')!;
      check('a readonly rating still submits its value and is not validated', new FormData(form).get('stars') === '3' && form.checkValidity());
    }

    // ── 5. disabled, directly and through a fieldset ──
    {
      const el = await mount('<b-rating value="2" disabled></b-rating>');
      check('disabled disables every radio', radios(el).every((r) => r.disabled));
      host.innerHTML = '<form><fieldset disabled><b-rating name="stars" value="2"></b-rating></fieldset></form>';
      const inner = host.querySelector<Rating>('b-rating')!;
      await waitFor(() => !!inner.shadowRoot?.querySelector('.stars'));
      await sleep(30);
      check('a disabled fieldset disables every radio', radios(inner).every((r) => r.disabled));
    }

    // ── 6. Contrast (WCAG 1.4.11, 3:1) in every shipped theme, on --b-bg and --b-bg-secondary ──
    for (const theme of ['', 'dark', 'finstat', 'neon', 'inverse']) {
      for (const surface of ['--b-bg', '--b-bg-secondary']) {
        host.innerHTML = `<div ${theme ? `data-theme="${theme}"` : ''} style="background:var(${surface});padding:8px"><b-rating value="2"></b-rating></div>`;
        const wrap = host.firstElementChild as HTMLElement;
        const el = host.querySelector<Rating>('b-rating')!;
        await waitFor(() => !!el.shadowRoot?.querySelector('.star.filled svg'));
        const bg = getComputedStyle(wrap).backgroundColor;
        const fill = getComputedStyle(el.shadowRoot!.querySelector('.star.filled svg')!).fill;
        const outline = getComputedStyle(el.shadowRoot!.querySelectorAll('.star svg')[4]).stroke;
        const name = `${theme || 'light'} on ${surface}`;
        check(`${name}: filled star ${contrast(fill, bg).toFixed(2)}:1 (${fill} on ${bg})`, contrast(fill, bg) >= 3);
        check(`${name}: empty star outline ${contrast(outline, bg).toFixed(2)}:1 (${outline} on ${bg})`, contrast(outline, bg) >= 3);
      }
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] rating-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] rating-smoke ${r}`);
})();
