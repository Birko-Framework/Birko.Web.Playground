// Birko TASK-925 — b-form `visibleWhen`: a field shows only while another field has given values. Covers Symbio
// TASK-1090's navigation item form (a Page / Custom URL switch with a required field behind each), the re-evaluation
// triggers (a user change, setSchema, setValues, reset), that a hidden field is not validated and is left out of
// validate().data, the `in` / non-empty / function forms, a chain, and a condition on a nested group's field.
import 'birko-web-components/inputs';
import type { FormSchema } from 'birko-web-components';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

type Form = HTMLElement & {
  setSchema(s: FormSchema | (() => FormSchema)): void;
  setValues(v: Record<string, unknown>): void;
  getValues(): Record<string, unknown>;
  reset(): void;
  validate(): { valid: boolean; data: Record<string, unknown>; errors: Record<string, string> };
};

const SCHEMA = (): FormSchema => ({
  name: 'root',
  children: [
    { name: 'label', type: 'text', label: 'Label', required: true },
    {
      name: 'linkKind', type: 'option-group', label: 'Link', default: 'page',
      options: [{ value: 'page', label: 'Page' }, { value: 'url', label: 'Custom URL' }],
    },
    {
      name: 'pageGuid', type: 'select', label: 'Page', required: true,
      options: [{ value: 'p1', label: 'Home' }, { value: 'p2', label: 'About' }],
      visibleWhen: { field: 'linkKind', equals: 'page' },
    },
    { name: 'url', type: 'text', label: 'URL', required: true, visibleWhen: { field: 'linkKind', equals: 'url' } },
    // A chain: shown while url has text, so hidden whenever url itself is hidden.
    { name: 'urlTitle', type: 'text', label: 'URL title', visibleWhen: { field: 'url' } },
    { name: 'target', type: 'text', label: 'Target', visibleWhen: { field: 'linkKind', in: ['url', 'other'] } },
    { name: 'note', type: 'text', label: 'Note', visibleWhen: (v) => v.label === 'show note' },
    {
      name: 'adv', label: 'Advanced', children: [
        { name: 'kind', type: 'text', label: 'Kind' },
        { name: 'extra', type: 'text', label: 'Extra', required: true, visibleWhen: { field: 'adv.kind', equals: 'x' } },
      ],
    },
  ],
});

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:600px';
  document.body.append(host);
  host.innerHTML = '<b-form></b-form>';
  const form = host.querySelector('b-form') as Form;
  for (let i = 0; i < 50 && !form.shadowRoot; i++) await sleep(20);

  const wrapper = (path: string) => form.shadowRoot!.querySelector<HTMLElement>(`[data-field="${path}"]`)!;
  const shown = (path: string) => getComputedStyle(wrapper(path)).display !== 'none';
  const which = (...paths: string[]) => paths.map((p) => `${p}:${shown(p) ? 'shown' : 'hidden'}`).join(' ');

  try {
    form.setSchema(SCHEMA);
    form.reset();
    await frames();
    check(`setSchema + reset: Page is shown, URL hidden (${which('pageGuid', 'url')})`, shown('pageGuid') && !shown('url'));
    check('a hidden field is display:none on its wrapper, with the b-form-field--hidden class',
      getComputedStyle(wrapper('url')).display === 'none' && wrapper('url').classList.contains('b-form-field--hidden'));

    // The main point: a required hidden field does not block.
    let r = form.validate();
    check(`validate: the shown required Page is reported, the hidden required URL is not (${Object.keys(r.errors).join(',')})`,
      'pageGuid' in r.errors && !('url' in r.errors));
    form.setValues({ label: 'Nav', pageGuid: 'p1' });
    r = form.validate();
    check(`validate: with Page filled the form is valid although URL is required and empty (${JSON.stringify(r.errors)})`, r.valid);
    check(`validate().data leaves the hidden fields out (${Object.keys(r.data).join(',')})`,
      !('url' in r.data) && !('target' in r.data) && r.data.pageGuid === 'p1');
    check('getValues() still returns a hidden field', 'url' in form.getValues());

    // A user change of the controlling field.
    form.validate();
    const og = form.shadowRoot!.querySelector('b-option-group')!;
    og.shadowRoot!.querySelector<HTMLElement>('.opt-btn[data-value="url"]')!.click();
    await frames();
    check(`a user pick of Custom URL: URL and Target shown, Page hidden (${which('pageGuid', 'url', 'target')})`,
      !shown('pageGuid') && shown('url') && shown('target'));
    r = form.validate();
    check(`validate after the switch: URL required, Page not checked (${Object.keys(r.errors).join(',')})`,
      'url' in r.errors && !('pageGuid' in r.errors) && !('pageGuid' in r.data));
    og.shadowRoot!.querySelector<HTMLElement>('.opt-btn[data-value="page"]')!.click();
    await frames();
    check('switching back hides URL and clears the error it showed',
      !shown('url') && !(wrapper('url').querySelector('b-input')?.getAttribute('error')));

    // Chain: url has text but is hidden, so its dependant is hidden too.
    form.setValues({ url: 'https://example.invalid' });
    await frames();
    check(`chain: URL has text but is hidden, so URL title is hidden (${which('url', 'urlTitle')})`, !shown('url') && !shown('urlTitle'));
    form.setValues({ linkKind: 'url' });
    await frames();
    check(`chain: with URL shown and filled, URL title shows (${which('url', 'urlTitle')})`, shown('url') && shown('urlTitle'));

    // An edit form: a new schema filled from an existing row shows the right field at once.
    form.setSchema(SCHEMA);
    form.setValues({ label: 'Docs', linkKind: 'url', url: 'https://example.invalid/docs' });
    await frames();
    check(`edit form: setSchema then setValues for a URL row shows URL, hides Page (${which('pageGuid', 'url')})`,
      shown('url') && !shown('pageGuid'));
    check('edit form: it validates without a Page', form.validate().valid);
    form.reset();
    await frames();
    check(`reset: back to the default Page (${which('pageGuid', 'url')})`, shown('pageGuid') && !shown('url'));

    // Function form.
    form.setValues({ label: 'show note' });
    await frames();
    const noteShown = shown('note');
    form.setValues({ label: 'other' });
    await frames();
    check(`function form: shown while it returns true (${noteShown}, then ${shown('note')})`, noteShown && !shown('note'));

    // A condition on a field in a nested group. (Through validate(): validateGroup() on a nested group reports its
    // errors under the root's name, `root.adv.extra` — Birko TASK-926, older than this.)
    form.setValues({ label: 'Nav', linkKind: 'page', pageGuid: 'p1' });
    let v = form.validate();
    check(`nested: adv.extra hidden while adv.kind is empty, and not validated (${Object.keys(v.errors).join(',')})`,
      !shown('adv.extra') && v.valid && !('extra' in ((v.data.adv as Record<string, unknown>) ?? {})));
    form.setValues({ adv: { kind: 'x' } });
    await frames();
    v = form.validate();
    check(`nested: adv.kind = x shows adv.extra and its required rule applies (${Object.keys(v.errors).join(',')})`,
      shown('adv.extra') && 'adv.extra' in v.errors);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((x) => x.startsWith('PASS')).length;
  console.log(`[playground] form-conditional-smoke: ${passed}/${results.length} passed`);
  for (const x of results) console.log(`[playground] form-conditional-smoke ${x}`);
})();
