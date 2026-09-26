// Reads the ACCESSIBLE NAME Chromium computes for every labelled `b-*` control (TASK-494).
//
//   npm run build && node a11y-name-check.mjs
//
// A sighted user sees the `label` text above each control, so a control that names NOTHING looks
// perfect. Before TASK-494 that was all of them: the `<label>` renderField emits is a sibling with no
// `for`, so `<b-input label="Weight">` was computed as name "" and a searchable `b-select` was
// announced by its placeholder, which holds the current value (a screen reader said "header" for a
// field labelled "Menu group"). An attribute check cannot see that; the accessibility tree can.
//
// Chromium only, for the reason a11y-description-check.mjs records: Firefox speaks WebDriver BiDi, which
// exposes no accessibility tree to puppeteer.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// Every control that passes `label` to fieldAria. The label text is unique per case so a match in the
// tree can only have come from that control.
const CASES = [
  ['b-input', 'Weight input'],
  ['b-textarea', 'Notes textarea'],
  ['b-select', 'Status native select'],
  ['b-select searchable', 'Group searchable select'],
  ['b-select searchable creatable', 'Menu group creatable'],
  ['b-multi-select', 'Tags multi select'],
  ['b-tag-input', 'Keywords tag input'],
  ['b-date-picker', 'Start date picker'],
  ['b-datetime-picker', 'Due datetime picker'],
  ['b-time', 'Opens time'],
  ['b-range', 'Volume range'],
  ['b-color-picker', 'Accent color'],
  ['b-markdown-editor', 'Body markdown'],
];

// Roles that are the label's own text, or containers — a match on these is the label being read as
// text, not the control being named.
const NOT_A_CONTROL = new Set(['StaticText', 'LabelText', 'InlineTextBox', 'generic', 'none', 'paragraph', 'RootWebArea', 'group']);

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'networkidle0', timeout: 90_000 });

/** Mount one control ON-SCREEN (a hidden host drops out of the tree), return every named control node. */
async function namedControls(html) {
  await page.evaluate(async (markup) => {
    document.getElementById('a11y-name-host')?.remove();
    const host = document.createElement('div');
    host.id = 'a11y-name-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:32rem;background:#fff;z-index:99999;padding:8px';
    host.innerHTML = markup;
    document.body.prepend(host);
    await new Promise((r) => setTimeout(r, 60));
  }, html);
  const root = await page.$('#a11y-name-host');
  const snap = await page.accessibility.snapshot({ root, interestingOnly: false });
  const found = [];
  (function walk(n) {
    if (n && !NOT_A_CONTROL.has(n.role)) found.push({ role: n.role, name: n.name ?? '', haspopup: n.haspopup });
    for (const c of n?.children ?? []) walk(c);
  })(snap);
  return found;
}

for (const [spec, label] of CASES) {
  const [tag, ...flags] = spec.split(' ');
  const nodes = await namedControls(`<${tag} label="${label}" ${flags.join(' ')}></${tag}>`);
  const hit = nodes.some((n) => n.name === label);
  const seen = nodes.filter((n) => n.role !== 'generic').map((n) => `${n.role}:"${n.name}"`).slice(0, 4).join(', ');
  check(`${spec}: the control is named "${label}"`, hit, hit ? '' : `computed: ${seen || '(no control nodes)'}`);
}

// Multi-part controls (TASK-495): each part is named "<field label> <part>". Naming every part by the
// field label alone makes them indistinguishable; that was TASK-494's regression on the native date range
// and on b-range's range mode, which the single-part cases above could not see.
const PART_CASES = [
  ['<b-date-range-picker label="Stay dates"></b-date-range-picker>', ['Stay dates Start date', 'Stay dates End date']],
  ['<b-date-range-picker label="Stay dates" native></b-date-range-picker>', ['Stay dates Start date', 'Stay dates End date']],
  ['<b-file-upload label="Invoice file"></b-file-upload>', ['Invoice file Choose files']],
  ['<b-range label="Volume" mode="range" display="slider"></b-range>', ['Volume From', 'Volume To']],
  ['<b-range label="Volume" mode="range" display="input"></b-range>', ['Volume From', 'Volume To']],
];
for (const [html, expected] of PART_CASES) {
  const names = (await namedControls(html)).map((n) => n.name);
  const missing = expected.filter((e) => !names.includes(e));
  check(`${html.match(/<([a-z-]+)/)[1]} ${html.match(/(native|display="\w+")/)?.[0] ?? ''}: parts named ${expected.map((e) => `"${e}"`).join(' / ')}`,
    missing.length === 0, missing.length ? `computed: ${names.filter(Boolean).join(' | ')}` : '');
}

// TASK-489: the searchable b-select is computed as a combobox (the in-page smoke asserts the attributes;
// this asserts Chromium honours them), and its open list as a listbox of options.
{
  const nodes = await namedControls('<b-select label="Picker combobox" searchable></b-select>');
  check('a searchable b-select is computed as a combobox named by its label',
    nodes.some((n) => n.role === 'combobox' && n.name === 'Picker combobox'),
    `computed: ${nodes.map((n) => `${n.role}:"${n.name}"`).slice(0, 4).join(', ')}`);
}

// TASK-496: a picker's trigger is computed as a combobox that has a popup (it used to be a read-only
// textbox with no hint that Enter opens a calendar), and every × clear button is named.
for (const tag of ['b-date-picker', 'b-datetime-picker', 'b-time']) {
  const nodes = await namedControls(`<${tag} label="When ${tag}"></${tag}>`);
  const cb = nodes.find((n) => n.name === `When ${tag}`);
  check(`${tag}: the trigger is a combobox with a popup`, cb?.role === 'combobox' && !!cb?.haspopup,
    `computed: ${cb ? `${cb.role} haspopup=${cb.haspopup ?? '-'}` : '(not found)'}`);
}
{
  const nodes = await namedControls('<b-date-range-picker label="Trip"></b-date-range-picker>');
  check('b-date-range-picker: both triggers are comboboxes with a popup',
    ['Trip Start date', 'Trip End date'].every((nm) => nodes.some((n) => n.name === nm && n.role === 'combobox' && n.haspopup)),
    `computed: ${nodes.filter((n) => n.name.startsWith('Trip')).map((n) => `${n.role}:"${n.name}"`).join(', ')}`);
}
for (const [html, what] of [
  ['<b-select label="C1" searchable value="a"></b-select>', 'b-select'],
  ['<b-date-picker label="C2" value="2026-01-02"></b-date-picker>', 'b-date-picker'],
  ['<b-datetime-picker label="C3" value="2026-01-02T10:00:00Z"></b-datetime-picker>', 'b-datetime-picker'],
  ['<b-time label="C4" value="10:30"></b-time>', 'b-time'],
  ['<b-date-range-picker label="C5" value="2026-01-02/2026-01-05"></b-date-range-picker>', 'b-date-range-picker'],
]) {
  const nodes = await namedControls(html);
  const buttons = nodes.filter((n) => n.role === 'button');
  const clear = buttons.find((n) => n.name === 'Clear');
  check(`${what}: the × clear button is named "Clear"`, !!clear && !buttons.some((n) => n.name === '×'),
    `buttons: ${buttons.map((n) => `"${n.name}"`).join(', ') || '(none)'}`);
}

// Unlabelled multi-part controls keep their bare part names.
{
  const names = (await namedControls('<b-date-range-picker native></b-date-range-picker>')).map((n) => n.name);
  check('an unlabelled date range keeps "Start date" / "End date"', names.includes('Start date') && names.includes('End date'),
    `computed: ${names.filter(Boolean).join(' | ')}`);
}

// Required: the visible "*" must not leak into the name.
{
  const nodes = await namedControls('<b-input label="Reps" required></b-input>');
  const names = nodes.map((n) => n.name);
  check('a required control is named "Reps", not "Reps*"', names.includes('Reps') && !names.some((n) => n.includes('*')),
    `computed: ${names.filter(Boolean).join(' | ')}`);
}

// Bare keeps its aria-label name.
{
  const nodes = await namedControls('<b-input label="Bare weight" bare></b-input>');
  check('a bare control keeps its aria-label name', nodes.some((n) => n.name === 'Bare weight'));
}

// No label → no aria-labelledby pointing at a node that was never rendered.
{
  const dangling = await page.evaluate(async () => {
    const out = [];
    for (const tag of ['b-input', 'b-textarea', 'b-select', 'b-tag-input', 'b-time', 'b-date-range-picker', 'b-file-upload', 'b-range']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      await new Promise((r) => setTimeout(r, 20));
      for (const n of el.shadowRoot?.querySelectorAll('[aria-labelledby]') ?? []) {
        for (const id of n.getAttribute('aria-labelledby').split(/\s+/)) {
          if (!el.shadowRoot.getElementById(id)) out.push(`${tag} → #${id}`);
        }
      }
      el.remove();
    }
    return out;
  });
  check('an unlabelled control carries no dangling aria-labelledby', dangling.length === 0, dangling.join(', '));
}

await browser.close();
server.close();

for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\nFAIL — ${failed} of ${checks.length} check(s)` : `\nOK — ${checks.length} checks`);
process.exit(failed ? 1 : 0);
