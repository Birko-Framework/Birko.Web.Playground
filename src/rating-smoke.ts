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

/**
 * A slotted icon carrying everything an icon export (or a hostile page) can: its own size, paint, opacity, inline style,
 * classes that match the component's, a handler, a script, a javascript: link around the shape, animation that sets
 * an href, a <style> that would restyle the component, a remote image and a <use>. Only the heart's geometry may survive.
 */
const HOSTILE_HEART = '<svg slot="icon" viewBox="0 0 24 24" width="40" height="40" style="fill:red" onload="void 0" opacity="0.2">'
  + '<script>void 0</script>'
  + '<style>.star.filled svg { fill: blue !important } .stars { display: none }</style>'
  + '<image href="https://example.invalid/x.png" width="1" height="1"/>'
  + '<use href="#h"/>'
  + '<set attributeName="href" to="javascript:void 0"/><animate attributeName="opacity" to="0"/>'
  + '<a href="javascript:void 0"><path id="h" class="filled sr-only" fill="#e11d48" fill-opacity="0.1" stroke="#000" stroke-width="0" '
  + 'style="fill:blue" onclick="void 0" d="M12 21s-7-4.4-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.6-9.5 9-9.5 9z"/></a></svg>';

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

    // ── 6. Contrast (WCAG 1.4.11, 3:1) in every shipped theme, on --b-bg and --b-bg-secondary, measured on the painted
    //       shape (the path), for the built-in star and for a slotted icon that declares its own colours (TASK-592) ──
    for (const [iconName, iconHtml] of [['star', ''], ['slotted heart', HOSTILE_HEART]]) {
      for (const theme of ['', 'dark', 'finstat', 'neon', 'inverse']) {
        for (const surface of ['--b-bg', '--b-bg-secondary']) {
          host.innerHTML = `<div ${theme ? `data-theme="${theme}"` : ''} style="background:var(${surface});padding:8px"><b-rating value="2">${iconHtml}</b-rating></div>`;
          const wrap = host.firstElementChild as HTMLElement;
          const el = host.querySelector<Rating>('b-rating')!;
          await waitFor(() => !!el.shadowRoot?.querySelector('.star.filled svg path'));
          const shapes = [...el.shadowRoot!.querySelectorAll('.star svg path')];
          const bg = getComputedStyle(wrap).backgroundColor;
          const fill = getComputedStyle(shapes[0]).fill;
          const outline = getComputedStyle(shapes[4]).stroke;
          const name = `${iconName}, ${theme || 'light'} on ${surface}`;
          check(`${name}: filled ${contrast(fill, bg).toFixed(2)}:1 (${fill} on ${bg})`, contrast(fill, bg) >= 3);
          check(`${name}: empty outline ${contrast(outline, bg).toFixed(2)}:1 (${outline} on ${bg})`, contrast(outline, bg) >= 3);
          check(`${name}: an empty shape is unfilled (${getComputedStyle(shapes[4]).fill})`, getComputedStyle(shapes[4]).fill === 'none');
        }
      }
    }

    // ── 7. The icon slot (TASK-592) ──
    {
      const el = await mount(`<b-rating value="2">${HOSTILE_HEART}</b-rating>`);
      const svgs = [...el.shadowRoot!.querySelectorAll<SVGSVGElement>('.star svg')];
      check(`the slotted icon is in every star (${svgs.length} stars, ${svgs.filter((s) => s.querySelector('path')?.getAttribute('d')?.startsWith('M12 21')).length} hearts)`,
        svgs.length === 5 && svgs.every((s) => s.querySelector('path')?.getAttribute('d')?.startsWith('M12 21')));
      check('each copy is decorative: aria-hidden, not focusable', svgs.every((s) => s.getAttribute('aria-hidden') === 'true' && s.getAttribute('focusable') === 'false'));
      const attrs = svgs.flatMap((s) => [s, ...s.querySelectorAll('*')]).flatMap((n) => [...n.attributes].map((a) => a.name));
      check(`no inline style or on* handler survives the copy (${attrs.filter((a) => a === 'style' || a.startsWith('on')).join(',') || 'none'})`,
        !attrs.some((a) => a === 'style' || a.startsWith('on')));
      check('no <script> survives the copy', svgs.every((s) => !s.querySelector('script')));
      const tags = new Set(svgs.flatMap((s) => [...s.querySelectorAll('*')].map((n) => n.localName)));
      check(`the copy holds only the heart's shape (elements: ${[...tags].join(', ')})`, tags.size === 1 && tags.has('path'));
      const kept = new Set(attrs);
      check(`the copy keeps only geometry and its own a11y attributes (${[...kept].sort().join(', ')})`,
        [...kept].every((a) => ['viewBox', 'aria-hidden', 'focusable', 'd'].includes(a)));
      check('nothing in the copy can take focus (the javascript: link was unwrapped)',
        !el.shadowRoot!.querySelector('.star a, .star [tabindex], .star [href]'));
      check(`the icon's <style> did not reach the component (stars displayed: ${getComputedStyle(el.shadowRoot!.querySelector('.stars')!).display})`,
        getComputedStyle(el.shadowRoot!.querySelector('.stars')!).display !== 'none');
      check(`the icon's own width/height go, so --b-rating-star sizes it (${svgs[0].getBoundingClientRect().width.toFixed(1)}px)`,
        !svgs[0].hasAttribute('width') && Math.abs(svgs[0].getBoundingClientRect().width - svgs[0].getBoundingClientRect().height) < 0.5);
      // The icon's own #e11d48 would also clear 3:1 on white, so the contrast loop alone cannot tell whose paint it is.
      host.insertAdjacentHTML('beforeend', '<b-rating id="ref-star" value="2"></b-rating>');
      const ref = host.querySelector<Rating>('#ref-star')!;
      await waitFor(() => !!ref.shadowRoot?.querySelector('.star.filled svg path'));
      const paint = (r: Rating, i: number) => { const cs = getComputedStyle(r.shadowRoot!.querySelectorAll('.star svg path')[i]); return `${cs.fill} / ${cs.stroke}`; };
      check(`a filled heart is painted exactly like a filled star (${paint(el, 0)} vs ${paint(ref, 0)})`, paint(el, 0) === paint(ref, 0));
      check(`an empty heart is painted exactly like an empty star (${paint(el, 4)} vs ${paint(ref, 4)})`, paint(el, 4) === paint(ref, 4));
      ref.remove();
      const original = el.querySelector<SVGSVGElement>(':scope > svg[slot="icon"]')!;
      check(`the slotted original is not rendered (${original.getBoundingClientRect().width}x${original.getBoundingClientRect().height})`,
        original.getBoundingClientRect().width === 0 && original.getBoundingClientRect().height === 0);

      // A runtime swap and a removal re-render the stars, without duplicates, and keep the value.
      stars(el)[3].click();
      await sleep(20);
      original.remove();
      await waitFor(() => !el.shadowRoot!.querySelector('.star svg path')?.getAttribute('d')?.startsWith('M12 21'));
      const afterRemove = [...el.shadowRoot!.querySelectorAll('.star svg')];
      check(`removing the icon brings the star back in all five, value kept (${afterRemove.length} icons, value "${el.value}")`,
        afterRemove.length === 5 && afterRemove.every((s) => s.querySelector('path')?.getAttribute('d')?.startsWith('M12 2.6')) && el.value === '4');
      el.insertAdjacentHTML('beforeend', '<svg slot="icon" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>');
      await waitFor(() => !!el.shadowRoot!.querySelector('.star svg circle'));
      const circles = [...el.shadowRoot!.querySelectorAll('.star svg')];
      check(`adding an icon at runtime puts it in all five (${circles.filter((s) => s.querySelector('circle')).length}), value kept ("${el.value}")`,
        circles.length === 5 && circles.every((s) => s.querySelector('circle')) && el.value === '4');
      check(`an icon with only width/height keeps its coordinate system (viewBox "${circles[0].getAttribute('viewBox')}")`,
        circles[0].getAttribute('viewBox') === '0 0 10 10');

      const ro = await mount(`<b-rating value="3" readonly>${HOSTILE_HEART}</b-rating>`);
      check('read-only uses the slotted icon too', [...ro.shadowRoot!.querySelectorAll('.star svg path')].every((p) => p.getAttribute('d')?.startsWith('M12 21')));
      const nonSvg = await mount('<b-rating value="1"><span slot="icon">♥</span></b-rating>');
      check('a non-SVG slot is ignored: the star renders, the text does not',
        nonSvg.shadowRoot!.querySelector('.star svg path')?.getAttribute('d')?.startsWith('M12 2.6') === true
        && nonSvg.querySelector('span')!.getBoundingClientRect().width === 0);
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] rating-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] rating-smoke ${r}`);
})();
