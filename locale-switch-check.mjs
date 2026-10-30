// Headless check for TASK-790 and TASK-791: what a re-render does to components the user is looking at.
//
// TASK-790 — a locale switch soft-updated only components whose root is the document, so a component nested in
// another component's shadow root kept its old language (Symbio's blocks editor stayed English under a Slovak page).
// Fixtures here: <ln-outer> renders <ln-inner> in its shadow root, which renders a b-qty-stepper in its own; the
// three are at depth 0, 1 and 2. Both fixtures take their text from label() with a key the Playground's sk.json has.
// Also: the host re-renders after what it contains (it sets an attribute on the inner one's node in onUpdated, as
// b-ribbon sets the roving tabindex on its fields), a listener still fires once, and the real ribbon's tabindex
// pattern survives a round trip en → sk → en.
//
// TASK-791 — b-modal / b-drawer / b-confirm-dialog observe attributes such as `title`; their render() emits the
// <dialog> without `open`, and the morph removed it, so changing the title of an open modal closed it.
//
// It switches the global locale, which would disturb the smoke suites running in verify.mjs's page, hence its own page.
// Run: node build.js && node locale-switch-check.mjs      (exit 0 = all pass, 1 = a FAIL)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const buf = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));

// ── TASK-790 ─────────────────────────────────────────────────────────────────────────────────────────────────
await page.evaluate(async () => {
  // BaseComponent is not exported to the page; it is the class right below HTMLElement in any b-* chain.
  let Base = customElements.get('b-card');
  while (Object.getPrototypeOf(Base) !== HTMLElement) Base = Object.getPrototypeOf(Base);
  const w = window;
  w.__ln = { order: [], clicks: 0 };
  class Outer extends Base {
    render() { return `<p class="t">${this.label('x-none', 'bwc.common.close', 'Close')}</p><ln-inner></ln-inner>`; }
    onUpdated() {
      w.__ln.order.push('outer');
      this.shadowRoot.querySelector('ln-inner')?.shadowRoot?.querySelector('.t')?.setAttribute('data-owned', 'outer');
    }
  }
  class Inner extends Base {
    render() { return `<p class="t">${this.label('x-none', 'bwc.common.close', 'Close')}</p><button class="b">x</button><b-qty-stepper value="1"></b-qty-stepper>`; }
    onUpdated() {
      w.__ln.order.push('inner');
      const b = this.shadowRoot.querySelector('.b');
      if (b) this.listen(b, 'click', () => { w.__ln.clicks++; });
    }
  }
  customElements.define('ln-outer', Outer);
  customElements.define('ln-inner', Inner);
  document.body.appendChild(document.createElement('ln-outer'));
  await new Promise((r) => setTimeout(r, 50));
});

const fixture = () => page.evaluate(() => {
  const outer = document.querySelector('ln-outer');
  const inner = outer.shadowRoot.querySelector('ln-inner');
  const stepper = inner.shadowRoot.querySelector('b-qty-stepper');
  return {
    outer: outer.shadowRoot.querySelector('.t').textContent,
    inner: inner.shadowRoot.querySelector('.t').textContent,
    owned: inner.shadowRoot.querySelector('.t').getAttribute('data-owned'),
    stepper: stepper.shadowRoot.querySelector('.step.dec')?.getAttribute('aria-label'),
  };
});
// The ribbon's own fields: the roving tabindex b-ribbon sets on the input inside each field's shadow root.
const ribbonTabindex = () => page.evaluate(() => {
  const r = document.querySelector('#pg-ribbon');
  return [...r.shadowRoot.querySelectorAll('[data-field-control]')].map((f) => {
    const inner = f.shadowRoot?.querySelector('input, select, button');
    return inner ? inner.getAttribute('tabindex') : 'none';
  });
});
const switchTo = async (locale, word) => {
  await page.evaluate((locale) => document.querySelector('#pg-ribbon')
    .dispatchEvent(new CustomEvent('item-click', { detail: { itemId: `locale:${locale}` } })), locale);
  // setLocale() fetches the bundle; the switch is done once the document-level fixture shows the word.
  for (let i = 0; i < 40 && (await fixture()).outer !== word; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50));
};

const en = await fixture();
const tabEn = await ribbonTabindex();
check(`fixture starts in English (${JSON.stringify(en)})`, en.outer === 'Close' && en.inner === 'Close' && en.stepper === 'Decrease');

await page.evaluate(() => { window.__ln.order = []; });
await switchTo('sk', 'Zavrieť');
const sk = await fixture();
const order = await page.evaluate(() => window.__ln.order);
check(`depth 0 switches to Slovak ("${sk.outer}")`, sk.outer === 'Zavrieť');
check(`depth 1, in a component's shadow root, switches to Slovak ("${sk.inner}")`, sk.inner === 'Zavrieť');
check(`depth 2, a framework component two shadow roots down, switches to Slovak ("${sk.stepper}")`, sk.stepper === 'Znížiť');
check(`the host re-renders after what it contains (onUpdated order ${order.join(' → ')})`,
  order.lastIndexOf('outer') > order.lastIndexOf('inner') && order.includes('inner'));
check(`state the host sets on a nested component survives the switch (data-owned=${sk.owned})`, sk.owned === 'outer');
check(`b-ribbon's roving tabindex on its fields survives (en ${tabEn.join(',')} / sk ${(await ribbonTabindex()).join(',')})`,
  JSON.stringify(await ribbonTabindex()) === JSON.stringify(tabEn));

await switchTo('en', 'Close');
const back = await fixture();
check(`back to English at every depth (${JSON.stringify(back)})`, back.outer === 'Close' && back.inner === 'Close' && back.stepper === 'Decrease');
check(`b-ribbon's roving tabindex after the round trip (${(await ribbonTabindex()).join(',')})`,
  JSON.stringify(await ribbonTabindex()) === JSON.stringify(tabEn));
const clicks = await page.evaluate(() => {
  const inner = document.querySelector('ln-outer').shadowRoot.querySelector('ln-inner');
  inner.shadowRoot.querySelector('.b').click();
  return window.__ln.clicks;
});
check(`a nested listener fires once after two switches (${clicks})`, clicks === 1);

// ── TASK-797 ─────────────────────────────────────────────────────────────────────────────────────────────────
// b-form's schema text. `fac` is built by a factory with t() (through a component's label(), as the page has no
// t of its own); `keys` is a plain object whose text is i18n keys, beside one literal string; `grow` is a
// factory whose field set changes with the locale, which takes the clean re-render path.
await page.evaluate(async () => {
  const outer = document.querySelector('ln-outer');
  const tt = (key, fallback) => outer.label('x-none', key, fallback);
  const w = window;
  w.__fm = { changes: 0 };
  const mk = (id) => {
    const f = document.createElement('b-form');
    f.id = id;
    f.addEventListener('change', () => { w.__fm.changes++; });
    document.body.appendChild(f);
    return f;
  };
  const fac = mk('fm-fac');
  const keys = mk('fm-keys');
  const grow = mk('fm-grow');
  await new Promise((r) => setTimeout(r, 50));
  fac.setSchema(() => ({
    name: 'root', children: [{
      name: 'person', label: tt('pg.form.group', 'Personal'), children: [
        { name: 'name', type: 'text', required: true, label: tt('pg.form.name', 'Name'), placeholder: tt('pg.form.namePh', 'Enter a name'), description: tt('pg.form.nameHelp', 'Full name') },
        { name: 'nick', type: 'text', label: 'Nick', rules: [{ type: 'minLength', value: 5, message: tt('pg.form.short', 'Too short') }] },
        { name: 'colour', type: 'select', label: tt('pg.form.colour', 'Colour'), options: [{ value: 'r', label: tt('pg.form.red', 'Red') }] },
      ],
    }],
  }));
  keys.setSchema({
    name: 'root', children: [
      { name: 'name', type: 'text', label: { key: 'pg.form.name', fallback: 'Name' } },
      { name: 'colour', type: 'select', label: 'Plain', options: [{ value: 'r', label: { key: 'pg.form.red', fallback: 'Red' } }] },
    ],
  });
  grow.setSchema(() => ({
    name: 'root', children: [
      { name: 'name', type: 'text', label: tt('pg.form.name', 'Name') },
      ...(tt('pg.form.name', 'Name') === 'Meno' ? [{ name: 'extra', type: 'text', label: tt('pg.form.extra', 'Extra') }] : []),
    ],
  }));
  await new Promise((r) => setTimeout(r, 50));
  const field = (f, path) => f.shadowRoot.querySelector(`[data-path="${path}"]`);
  field(fac, 'person.nick').inputValue = 'ab';
  field(grow, 'name').inputValue = 'kept';
  fac.validate();
  fac.setFieldError('person.colour', 'Server says no');
  await new Promise((r) => setTimeout(r, 50));
  const nick = field(fac, 'person.nick');
  (nick.shadowRoot?.querySelector('input') ?? nick).focus();
  w.__fm.changes = 0;
});

const forms = () => page.evaluate(() => {
  const field = (id, path) => document.getElementById(id).shadowRoot.querySelector(`[data-path="${path}"]`);
  const fac = document.getElementById('fm-fac');
  return {
    legend: fac.shadowRoot.querySelector('.b-form-legend')?.textContent?.trim(),
    label: field('fm-fac', 'person.name').getAttribute('label'),
    placeholder: field('fm-fac', 'person.name').getAttribute('placeholder'),
    description: field('fm-fac', 'person.name').getAttribute('description'),
    option: field('fm-fac', 'person.colour')._options?.[0]?.label,
    required: field('fm-fac', 'person.name').getAttribute('error'),
    rule: field('fm-fac', 'person.nick').getAttribute('error'),
    custom: field('fm-fac', 'person.colour').getAttribute('error'),
    nick: field('fm-fac', 'person.nick').inputValue,
    focus: fac.shadowRoot.activeElement?.getAttribute('data-path') ?? null,
    keyLabel: field('fm-keys', 'name').getAttribute('label'),
    plainLabel: field('fm-keys', 'colour').getAttribute('label'),
    keyOption: field('fm-keys', 'colour')._options?.[0]?.label,
    growName: field('fm-grow', 'name')?.inputValue,
    growExtra: field('fm-grow', 'extra')?.getAttribute('label') ?? null,
    changes: window.__fm.changes,
  };
});

const f0 = await forms();
check(`b-form starts in English (${JSON.stringify(f0)})`, f0.label === 'Name' && f0.required === 'Name is required' && f0.rule === 'Too short' && f0.focus === 'person.nick');
await switchTo('sk', 'Zavrieť');
const f1 = await forms();
check(`b-form factory: group, label, placeholder, help and option text switch to Slovak (${JSON.stringify([f1.legend, f1.label, f1.placeholder, f1.description, f1.option])})`,
  f1.legend === 'Osobné' && f1.label === 'Meno' && f1.placeholder === 'Zadajte meno' && f1.description === 'Celé meno' && f1.option === 'Červená');
check(`b-form: shown errors are worded again ("${f1.required}" / "${f1.rule}")`, f1.required === 'Meno je povinné' && f1.rule === 'Príliš krátke');
check(`b-form: an error set with setFieldError stays as given ("${f1.custom}")`, f1.custom === 'Server says no');
check(`b-form: the typed value and focus are kept (${f1.nick}, ${f1.focus})`, f1.nick === 'ab' && f1.focus === 'person.nick');
check(`b-form: i18n keys in a plain schema follow the locale, a literal string does not (${f1.keyLabel}, ${f1.keyOption}, ${f1.plainLabel})`,
  f1.keyLabel === 'Meno' && f1.keyOption === 'Červená' && f1.plainLabel === 'Plain');
check(`b-form: a factory whose field set changes renders the new field and keeps the value (${f1.growExtra}, ${f1.growName})`, f1.growExtra === 'Navyše' && f1.growName === 'kept');
check(`b-form: the switch fires no change event (${f1.changes})`, f1.changes === 0);
await switchTo('en', 'Close');
const f2 = await forms();
check(`b-form back in English (${JSON.stringify([f2.label, f2.required, f2.keyLabel, f2.growExtra, f2.growName])})`,
  f2.label === 'Name' && f2.required === 'Name is required' && f2.keyLabel === 'Name' && f2.growExtra === null && f2.growName === 'kept' && f2.changes === 0);
await page.evaluate(() => { for (const id of ['fm-fac', 'fm-keys', 'fm-grow']) document.getElementById(id).remove(); });

// ── TASK-791 ─────────────────────────────────────────────────────────────────────────────────────────────────
const overlay = (tag, attr, modal) => page.evaluate(async (tag, attr, modal) => {
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const el = document.createElement(tag);
  el.setAttribute('title', 'Before');
  if (modal) el.setAttribute('modal', '');
  if (tag !== 'b-confirm-dialog') el.innerHTML = '<input id="ov-field" value="typed">';
  document.body.appendChild(el);
  await settle();
  if (tag === 'b-confirm-dialog') void el.show(); else el.open();
  await settle();
  const field = el.querySelector('#ov-field');
  field?.focus();
  const dlg = el.shadowRoot.querySelector('dialog');
  el.setAttribute(attr, attr === 'title' ? 'After' : attr === 'size' ? 'lg' : 'After');
  await settle();
  const sameDlg = el.shadowRoot.querySelector('dialog') === dlg;
  const out = {
    open: dlg.open, modal: dlg.matches(':modal'), sameDlg,
    focus: field ? document.activeElement === field : null,
    title: el.shadowRoot.querySelector('.overlay-title, [id$="-title"]')?.textContent?.trim() ?? null,
  };
  if (tag === 'b-confirm-dialog') el.shadowRoot.querySelector('.btn-cancel, [data-action="cancel"]')?.click();
  else el.close();
  await settle();
  out.closed = !dlg.open;
  el.remove();
  return out;
}, tag, attr, modal);

// b-drawer is non-modal unless it has `modal`; the others are always modal.
for (const [tag, attr, modal] of [['b-modal', 'title', true], ['b-modal', 'size', true], ['b-drawer', 'title', true], ['b-drawer', 'title', false], ['b-confirm-dialog', 'title', true], ['b-confirm-dialog', 'message', true]]) {
  const r = await overlay(tag, attr, modal && tag === 'b-drawer');
  check(`${tag}${tag === 'b-drawer' ? (modal ? ' modal' : ' non-modal') : ''}: changing ${attr} while open keeps it open${modal ? ' and modal' : ''} (${JSON.stringify(r)})`, r.open && r.modal === modal && r.sameDlg);
  if (r.focus !== null) check(`${tag}: focus stays in the field after the ${attr} change`, r.focus);
  if (attr === 'title') check(`${tag}: the new title shows ("${r.title}")`, r.title === 'After');
  check(`${tag}: it still closes afterwards`, r.closed);
}

// ── TASK-801 ─────────────────────────────────────────────────────────────────────────────────────────────────
// A Shell list page whose entityLabel is a getter over t() (src/crud-locale-fixture.ts, on /?crud=1). The heading is
// pageTitle → entityLabel; the create modal's title is 'bws.common.new' with {entity}, set when it opens and rendered
// from state, so a locale switch relabels both and the morph does not blank the title of the open modal.
await page.goto(`http://localhost:${port}/?crud=1`, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  for (let i = 0; i < 40 && !customElements.get('crud-locale-page'); i++) await new Promise((r) => setTimeout(r, 50));
  document.body.appendChild(document.createElement('crud-locale-page'));
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('crud-locale-page').openCreate();
  await new Promise((r) => setTimeout(r, 200));
});
const crud = () => page.evaluate(() => {
  const p = document.querySelector('crud-locale-page');
  const modal = p.shadowRoot.querySelector('#modal');
  return {
    h1: p.shadowRoot.querySelector('.page-title')?.textContent?.trim(),
    title: modal?.getAttribute('title'),
    open: !!modal?.shadowRoot?.querySelector('dialog')?.open,
  };
});
const crudSwitch = async (locale, h1) => {
  await page.evaluate((locale) => document.querySelector('#pg-ribbon')
    .dispatchEvent(new CustomEvent('item-click', { detail: { itemId: `locale:${locale}` } })), locale);
  for (let i = 0; i < 40 && (await crud()).h1 !== h1; i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 50));
};
const c0 = await crud();
check(`Shell page starts in English (${JSON.stringify(c0)})`, c0.h1 === 'Device' && c0.title === 'New Device' && c0.open);
await crudSwitch('sk', 'Zariadenie');
const c1 = await crud();
check(`Shell page: a getter entityLabel relabels the heading (${c1.h1})`, c1.h1 === 'Zariadenie');
check(`Shell page: the open create modal's title relabels and the modal stays open (${JSON.stringify(c1)})`, c1.title === 'Nový Zariadenie' && c1.open);
await crudSwitch('en', 'Device');
const c2 = await crud();
check(`Shell page back in English (${JSON.stringify(c2)})`, c2.h1 === 'Device' && c2.title === 'New Device' && c2.open);

await browser.close();
server.close();
if (pageErrors.length) { console.log(`page errors:\n  ${pageErrors.join('\n  ')}`); }
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed || pageErrors.length ? 1 : 0);
