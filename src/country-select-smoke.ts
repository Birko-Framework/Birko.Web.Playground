// Birko TASK-817 — b-country-select, the country helpers and b-form's `type: 'country'` (asked for by Symbio, whose
// country fields were typed by hand as ISO codes). The value is upper-case alpha-2 codes; the list shows the
// localized name with its code and flag; search finds a name or a code; with `multiple` an "EU" shortcut adds the 27.
import 'birko-web-components/inputs';
import {
  COUNTRY_CODES, countryName, countryFlag, countryLabel, getCountryGroup, registerCountryGroup,
} from 'birko-web-components';

type Country = HTMLElement & {
  value: string; getSelected(): string[]; setSelected(v: string[]): void;
};
type Form = HTMLElement & {
  setSchema(s: unknown): void; setValues(v: Record<string, unknown>): void; getValues(): Record<string, unknown>;
};

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function offscreen(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:400px';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  try {
    // ── 1. The data and helpers ──
    check(`COUNTRY_CODES holds the 249 assigned codes, each once (${COUNTRY_CODES.length})`,
      COUNTRY_CODES.length === 249 && new Set(COUNTRY_CODES).size === 249 && COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c)));
    const eu = getCountryGroup('eu');
    check(`the EU group is the 27 member states, all assigned codes (${eu?.codes.length})`,
      eu?.codes.length === 27 && eu.codes.every((c) => COUNTRY_CODES.includes(c)) && eu.codes.includes('GR') && !eu.codes.includes('GB'));
    check(`countryName names a code in a locale (${countryName('sk', 'sk')} / ${countryName('SK', 'en')})`,
      countryName('sk', 'sk') === 'Slovensko' && countryName('SK', 'en') === 'Slovakia');
    check('countryName gives back a value that is not a code, and nothing for nothing',
      countryName('Slovakia', 'en') === 'Slovakia' && countryName('', 'en') === '' && countryName(null) === '');
    check(`countryFlag is the regional-indicator pair (${countryFlag('cz')})`, countryFlag('cz') === '🇨🇿' && countryFlag('Slovakia') === '');
    check(`countryLabel is "flag name (code)" (${countryLabel('SK', { locale: 'en' })})`,
      countryLabel('SK', { locale: 'en' }) === '🇸🇰 Slovakia (SK)' && countryLabel('SK', { locale: 'en', flag: false }) === 'Slovakia (SK)');

    // ── 2. One country ──
    {
      const wrap = offscreen('<b-country-select name="country" label="Country" value="sk"></b-country-select>');
      await settle();
      const el = wrap.querySelector('b-country-select') as Country;
      const inner = el.shadowRoot!.querySelector('b-select')!;
      const input = inner.shadowRoot!.querySelector<HTMLInputElement>('.combo-input')!;
      check(`a lower-case value attribute reads back upper case (${el.value})`, el.value === 'SK');
      check(`the box shows the country by name with its flag and code (${input.value})`, input.value === '🇸🇰 Slovakia (SK)');
      check(`the list offers every country (${inner.shadowRoot!.querySelectorAll('.option[data-value]').length})`,
        inner.shadowRoot!.querySelectorAll('.option[data-value]').length === 249);

      const found = async (q: string) => {
        input.value = q;
        input.dispatchEvent(new Event('input'));
        await settle();
        return [...inner.shadowRoot!.querySelectorAll<HTMLElement>('.option[data-value]')].map((o) => o.dataset.value);
      };
      const byName = await found('slova');
      check(`typing part of a name finds it (${byName.join(',')})`, byName.includes('SK') && !byName.includes('CZ'));
      const byCode = await found('cz');
      check(`typing a code finds it (${byCode.join(',')})`, byCode.includes('CZ'));
      const accentless = await found('reunion');
      check(`accents are ignored (${accentless.join(',')})`, accentless.includes('RE'));

      await found('czech');
      const events: unknown[] = [];
      el.addEventListener('change', (e) => events.push((e as CustomEvent).detail));
      inner.shadowRoot!.querySelector<HTMLElement>('.option[data-value="CZ"]')!.click();
      await settle();
      check(`picking one sets the code (${el.value})`, el.value === 'CZ' && el.getSelected().join() === 'CZ');
      check(`and emits ONE change, with the code (${JSON.stringify(events)})`,
        events.length === 1 && (events[0] as { value: string }).value === 'CZ' && (events[0] as { name: string }).name === 'country');
      el.setSelected(['at', 'de']);
      await settle();
      check(`without multiple, setSelected keeps the first (${el.value})`, el.value === 'AT');
      wrap.remove();
    }

    // ── 3. A restriction, a preferred order, and a value that is not a code ──
    {
      const wrap = offscreen('<b-country-select countries="de,at,cz,sk" preferred="SK,CZ" value="Slovakia"></b-country-select>');
      await settle();
      const el = wrap.querySelector('b-country-select') as Country;
      const inner = el.shadowRoot!.querySelector('b-select')!;
      const order = [...inner.shadowRoot!.querySelectorAll<HTMLElement>('.option[data-value]')].map((o) => o.dataset.value);
      check(`countries limits the list and preferred comes first, the rest by name (${order.join(',')})`,
        order.slice(0, 5).join(',') === 'SK,CZ,AT,DE,Slovakia');
      check(`a stored value that is not a code is kept as it is (${el.value})`, el.value === 'Slovakia');
      check('and shown as itself', inner.shadowRoot!.querySelector<HTMLInputElement>('.combo-input')!.value === 'Slovakia');
      wrap.remove();
    }

    // ── 4. Several, with the EU shortcut ──
    {
      registerCountryGroup({ id: 'pg-benelux', label: () => 'Benelux', codes: ['be', 'nl', 'lu'] });
      const wrap = offscreen('<b-country-select multiple name="zone" value="cz,sk,cz"></b-country-select>');
      await settle();
      const el = wrap.querySelector('b-country-select') as Country;
      const inner = el.shadowRoot!.querySelector('b-multi-select')!;
      check(`multiple: a comma value, upper-cased, each once (${el.value})`, el.value === 'CZ,SK');
      check(`and the inner list holds the same selection (${(inner as unknown as Country).getSelected().join()})`,
        (inner as unknown as Country).getSelected().join() === 'CZ,SK');
      const picks = () => [...inner.shadowRoot!.querySelectorAll<HTMLElement>('.quick-pick')];
      check(`the EU shortcut is shown by default (${picks().map((p) => p.textContent).join('|')})`,
        picks().length === 1 && picks()[0].textContent === 'EU (27)' && picks()[0].getAttribute('aria-pressed') === 'false');

      const events: { values: string[] }[] = [];
      el.addEventListener('change', (e) => events.push((e as CustomEvent).detail));
      picks()[0].click();
      await settle();
      check(`pressing EU adds the 27, keeping what was there (${el.getSelected().length})`,
        el.getSelected().length === 27 && el.getSelected().includes('CZ') && el.getSelected().includes('GR'));
      check(`and emits one change with the list (${events.length}, ${events[0]?.values.length})`, events.length === 1 && events[0].values.length === 27);
      check('the shortcut now reads pressed', picks()[0].getAttribute('aria-pressed') === 'true');
      picks()[0].click();
      await settle();
      check(`pressing it again removes them (${el.value || 'empty'})`, el.value === '');

      const search = inner.shadowRoot!.querySelector<HTMLInputElement>('.dd-search')!;
      search.value = 'reunion';
      search.dispatchEvent(new Event('input'));
      await settle();
      const shown = [...inner.shadowRoot!.querySelectorAll<HTMLInputElement>('.option input')].map((i) => i.value);
      check(`the multiple list's search ignores accents (${shown.join(',')})`, shown.includes('RE'));
      wrap.remove();

      const own = offscreen('<b-country-select multiple groups="pg-benelux,nope" countries="BE,NL,DE"></b-country-select>');
      await settle();
      const ownInner = own.querySelector('b-country-select')!.shadowRoot!.querySelector('b-multi-select')!;
      const ownPicks = [...ownInner.shadowRoot!.querySelectorAll<HTMLElement>('.quick-pick')].map((p) => p.textContent);
      check(`groups= picks registered groups, counting only the offered countries (${ownPicks.join('|')})`,
        ownPicks.join('|') === 'Benelux (2)');
      own.remove();
    }

    // ── 5. b-form ──
    {
      const wrap = offscreen('<b-form></b-form>');
      await settle();
      const form = wrap.querySelector('b-form') as Form;
      form.setSchema({ name: 'root', children: [
        { name: 'country', type: 'country', label: 'Country', preferredCountries: ['SK', 'CZ'] },
        { name: 'allowed', type: 'country', label: 'Allowed', multiple: true },
      ] });
      await settle();
      form.setValues({ country: 'sk', allowed: ['AT', 'de'] });
      await settle();
      const v = form.getValues();
      check(`b-form: one country reads as a code, several as a list (${JSON.stringify(v)})`,
        v.country === 'SK' && Array.isArray(v.allowed) && (v.allowed as string[]).join() === 'AT,DE');
      const sr = form.shadowRoot!;
      check('b-form renders b-country-select, with multiple on the list field',
        !!sr.querySelector('b-country-select[data-path="country"]:not([multiple])') && !!sr.querySelector('b-country-select[data-path="allowed"][multiple]'));
      wrap.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] country-select-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] country-select-smoke ${r}`);
})();
