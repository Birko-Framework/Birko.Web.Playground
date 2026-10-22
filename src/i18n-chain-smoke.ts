// TASK-750 (for Symbio TASK-953) — I18n fallback chains: with `fallbackChains: { cs: ['sk', 'en'] }` a Czech UI falls
// back to Slovak, then English, never straight to English and never to a raw key while a chain locale has it. A locale
// with no chain, and a consumer that passes no chains, behave exactly as before: asserted on the requests made.
// Private I18n instances only. The bundles are real files (fixtures/i18n-chain, copied by build.js) and the requests
// are read from Resource Timing, so this suite never replaces window.fetch.
//
// SERIALISATION: it still cannot run beside the others. setLocale() sets the page's `lang`, which backport-smoke's b-chart
// formats dates by, and fetches through the global fetch, which auth-session-smoke and backport-smoke stub while they
// run: measured, run concurrently, each broke a check of the other and this suite never reported. So it waits until
// every other suite started (window.__smokeSuites, set by app.ts) has logged its summary line.
import { I18n } from 'birko-web-core';

const reported = new Set<string>();
const log = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const line = typeof args[0] === 'string' ? args[0] : '';
  const m = /^\[playground\] ([a-z0-9-]+): \d+\/\d+ passed/.exec(line);
  if (m) reported.add(m[1]);
  // The grid benchmark prints timings, not a summary: its last line is the bare grid's.
  if (line.startsWith('[playground] grid-bench bare ')) reported.add('grid-bench-smoke');
  log(...args);
};
const othersDone = () => ((window as unknown as { __smokeSuites?: string[] }).__smokeSuites ?? [])
  .filter((n) => n !== 'i18n-chain-smoke').every((n) => reported.has(n));

const BASE = '/__i18n-chain-smoke';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) => check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

  // Requests since the last reset(). Module bundles load in parallel, so those lists are compared sorted. An entry is
  // added a moment after its response resolves, so both wait for them to land: read at once, a 404 was missing and
  // the previous switch's request counted towards the next.
  let mark = 0;
  const land = () => new Promise((r) => setTimeout(r, 150));
  const reset = async () => { await land(); mark = performance.getEntriesByType('resource').length; };
  const requested = async () => { await land(); return performance.getEntriesByType('resource').slice(mark)
    .map((e) => new URL(e.name).pathname).filter((u) => u.startsWith(BASE)).map((u) => u.slice(BASE.length)); };
  const sorted = (xs: string[]) => [...xs].sort();
  const lang = document.documentElement.getAttribute('lang');

  const deadline = Date.now() + 90_000;
  while (!othersDone() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  check('every other suite finished first (it changes the page language and fetches through the global fetch)', othersDone());

  try {
    // ── a chain ──
    const i18n = new I18n({ fallbackChains: { cs: ['sk', 'en'], sk: ['en'] } });
    i18n.setBasePath(BASE);
    await reset();
    await i18n.setLocale('cs');
    eq('setLocale(cs) loads cs, then its whole chain', await requested(), ['/cs.json', '/sk.json', '/en.json']);
    eq('cs has the key: cs wins', i18n.t('greet'), 'Ahoj');
    eq('cs misses, sk has it: sk, not en', i18n.t('only.sk'), 'len po slovensky');
    eq('cs and sk miss, en has it: en', i18n.t('only.en'), 'English only');
    eq('a key in no locale: the key, as before', i18n.t('only.none'), 'only.none');
    eq('plurals follow the chain, with the fallback locale\'s rules (sk "few")', i18n.t('items', { count: 3 }), '3 položky');

    await reset();
    await i18n.loadModule('orders');
    eq('loadModule loads the module for cs and its whole chain', await requested(), ['/modules/orders/cs.json', '/modules/orders/sk.json', '/modules/orders/en.json']);
    eq('a module key in cs', i18n.t('orders.title'), 'Objednávky');
    eq('a module key only in sk and en: sk', i18n.t('orders.empty'), 'Žiadne objednávky');
    eq('a module key only in en: en', i18n.t('orders.help'), 'Orders help');

    await reset();
    await i18n.setLocale('de');
    eq('a locale with no chain falls back to fallbackLocale: de and en, and the module for de only',
      sorted(await requested()), sorted(['/de.json', '/en.json', '/modules/orders/de.json']));
    eq('…and resolves de, then en', [i18n.t('greet'), i18n.t('only.sk'), i18n.t('orders.help')], ['Hallo', 'Slovak only (en)', 'Orders help']);

    // ── a chain naming the locale itself, and the same fallback twice ──
    const dup = new I18n({ fallbackChains: { cs: ['cs', 'sk', 'sk', 'en'] } });
    dup.setBasePath(BASE);
    await reset();
    await dup.setLocale('cs');
    eq('the locale itself and repeats are dropped from a chain', await requested(), ['/cs.json', '/sk.json', '/en.json']);
    eq('…and it resolves cs → sk → en', [dup.t('only.cs'), dup.t('only.sk'), dup.t('only.en')], ['jen česky', 'len po slovensky', 'English only']);

    // ── no chains: exactly today's behaviour ──
    const plain = new I18n();
    plain.setBasePath(BASE);
    await reset();
    await plain.setLocale('sk');
    eq('without fallbackChains, setLocale(sk) loads sk and fallbackLocale en', await requested(), ['/sk.json', '/en.json']);
    eq('…a key missing in sk is en', plain.t('greet'), 'Hello');
    await reset();
    await plain.loadModule('orders');
    eq('…loadModule loads sk and en', await requested(), ['/modules/orders/sk.json', '/modules/orders/en.json']);
    await reset();
    await plain.setLocale('cs');
    eq('…a switch to cs loads cs and en, and the module for cs only, as before',
      sorted(await requested()), sorted(['/cs.json', '/en.json', '/modules/orders/cs.json']));
    eq('…and cs never reaches sk without a chain', plain.t('only.sk'), 'Slovak only (en)');
    await reset();
    await plain.setLocale('en');
    eq('…a switch to the fallback itself loads just it, and its module', sorted(await requested()), sorted(['/en.json', '/modules/orders/en.json']));
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  } finally {
    if (lang === null) document.documentElement.removeAttribute('lang'); else document.documentElement.setAttribute('lang', lang);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] i18n-chain-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] i18n-chain-smoke ${r}`);
})();
