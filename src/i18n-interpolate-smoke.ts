// TASK-551 — placeholders are filled in ONE pass, by one function, on every path. The old I18n.t() replaced
// placeholder after placeholder, so a value holding "{other}" was rewritten by the next replacement
// (FlowerFurStudio TASK-106: "{label}: {value}" with the label "Barva {value}" → "Barva hnědá: hnědá"); it also
// expanded "$&" in a value and built a RegExp from each key. Uses a private I18n instance and keys that do not
// exist globally, so nothing here touches the singleton other suites read.
import 'birko-web-components/inputs';
import { I18n, interpolate, t } from 'birko-web-core';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: string, want: string) => check(`${name} ("${got}")`, got === want);

  try {
    const i18n = new I18n();
    i18n.addMessages('en', {
      cart: {
        attribute: '{label}: {value}',
        price: 'Price {amount}',
        lines: { one: '{count} line in {name}', other: '{count} lines in {name}' },
      },
    });

    // ── I18n.t — the path that was broken ──
    eq('a value holding another placeholder is not rewritten',
      i18n.t('cart.attribute', { label: 'Barva {value}', value: 'hnědá' }), 'Barva {value}: hnědá');
    eq('…in either order of the params',
      i18n.t('cart.attribute', { value: 'hnědá {label}', label: 'Barva' }), 'Barva: hnědá {label}');
    eq('"$&" in a value is inserted literally', i18n.t('cart.price', { amount: '$& 5' }), 'Price $& 5');
    eq('"$1" and "$$" too', i18n.t('cart.price', { amount: '$1$$' }), 'Price $1$$');
    let threw = false;
    try { i18n.t('cart.price', { 'a(': 1, amount: '3' }); } catch { threw = true; }
    check('a param key that is not a valid regex does not throw', !threw);
    eq('the plural path fills once as well',
      i18n.t('cart.lines', { count: 2, name: 'cart {count}' }), '2 lines in cart {count}');
    eq('a placeholder with no param stays visible', i18n.t('cart.attribute', { label: 'Barva' }), 'Barva: {value}');

    // ── interpolate — the one producer ──
    eq('interpolate: one pass', interpolate('{a}{b}', { a: '{b}', b: 'x' }), '{b}x');
    eq('interpolate: no params → template', interpolate('{a}'), '{a}');
    eq('interpolate: an inherited key is not a param', interpolate('{constructor}', {}), '{constructor}');
    eq('interpolate: a null param stays a placeholder',
      interpolate('{a}', { a: null as unknown as string }), '{a}');
    eq('interpolate: dotted and dashed keys', interpolate('{item.count}-{x-y}', { 'item.count': 1, 'x-y': 2 }), '1-2');

    // ── the global fallback path (a key that does not exist) ──
    eq('t(): an English fallback fills once',
      t('task551.missing.key', { label: 'Barva {value}', value: 'hnědá' }, '{label}: {value}'), 'Barva {value}: hnědá');

    // ── the per-instance label-* attribute path ──
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px';
    document.body.append(host);
    host.innerHTML = '<b-qty-stepper label="Látka {label}" label-increment="Pridať {label}"></b-qty-stepper>';
    await new Promise((r) => setTimeout(r, 30));
    const inc = host.querySelector('b-qty-stepper')!.shadowRoot!.querySelector('.inc')!;
    eq('a label-* attribute fills once', inc.getAttribute('aria-label') ?? '', 'Pridať Látka {label}');
    host.remove();
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] i18n-interpolate-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] i18n-interpolate-smoke ${r}`);
})();
