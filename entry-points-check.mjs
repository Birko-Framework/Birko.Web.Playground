// Can a consumer import ONE Birko.Web component and get everything it renders?
//
//   node entry-points-check.mjs        (exit 1 on any FAIL; no build needed — it bundles its own entries)
//
// TASK-564. `birko-web-components/<category>/<b-name>` is the per-component entry point: the source file itself,
// reached through one `./<category>/*` pattern per category in the package's `exports`, and in a consumer through
// one esbuild alias (`birko-web-components` → `<Web>/Birko.Web.Components/src`). A lean import is only safe if
// the file registers every `b-*` it renders; otherwise a tag inside its shadow root stays an unknown element,
// which the full barrel had always hidden. The rule is Birko.Web.Components/CLAUDE.md § "A component imports every
// component it renders"; this enforces it with coverage (exports + the README path table), a static closure scan,
// and a real mount of each file alone. The scan sees what a condition hides from the mount; the mount proves the
// scan's reading in a real browser, through the alias a consumer uses.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer';
import { resolveBirkoWeb } from './birko-src.mjs';

const WEB = resolveBirkoWeb();
const PKG = `${WEB}/Birko.Web.Components`;
const SRC = `${PKG}/src`;
// The documented consumer config, verbatim. If a consumer needs more than this, the README is wrong.
const ALIAS = { 'birko-web-components': SRC, 'birko-web-core': `${WEB}/Birko.Web.Core/src` };

const results = [];
const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); return ok; };

// ── Inventory ──────────────────────────────────────────────────────────────────────────────────────────────
const read = (f) => readFileSync(f, 'utf8');
// A block comment opens at a line start or after whitespace/punctuation, so a '/*' inside a string ('image/*') is
// left alone. Whole-line `//` comments are dropped; a trailing one is kept, which can only over-report.
const stripComments = (s) => s.replace(/(^|[\s;{}(),=])\/\*[\s\S]*?\*\//g, '$1').replace(/^\s*\/\/.*$/gm, '');
const categories = readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const components = []; // { tag, cat, file, path }
for (const cat of categories) {
  for (const f of readdirSync(`${SRC}/${cat}`).filter((n) => n.endsWith('.ts'))) {
    for (const m of read(`${SRC}/${cat}/${f}`).matchAll(/define\(\s*['"`](b-[a-z0-9-]+)['"`]/g)) {
      components.push({ tag: m[1], cat, file: `${cat}/${f}`, path: `birko-web-components/${cat}/${f.slice(0, -3)}` });
    }
  }
}
check(`inventory: found the component files (${components.length})`, components.length >= 60);

// ── 1. coverage ────────────────────────────────────────────────────────────────────────────────────────────
const exportsMap = JSON.parse(read(`${PKG}/package.json`)).exports;
const readmeAll = read(`${PKG}/README.md`).replaceAll('\r\n', '\n');
const tableAt = readmeAll.indexOf('| Category | Entry points |');
const tableEnd = readmeAll.indexOf('\n\n', tableAt);
const readme = tableAt < 0 ? '' : readmeAll.slice(tableAt, tableEnd < 0 ? undefined : tableEnd);
check('coverage: the README path table exists', tableAt >= 0);
for (const c of components) {
  const target = exportsMap[`./${c.cat}/*`];
  check(`coverage: ${c.tag} is reachable as ${c.path} (exports ./${c.cat}/* → ${target ?? 'none'})`,
    target === `./src/${c.cat}/*.ts`);
  check(`coverage: ${c.tag} has a row in the README path table`, readme.includes(`\`${c.path}\``));
}

// ── 2. closure ─────────────────────────────────────────────────────────────────────────────────────────────
const tagFile = new Map(components.map((c) => [c.tag, `${SRC}/${c.file}`]));
const importsOf = (file) => {
  const out = [];
  // `import type` / `export type` are erased by esbuild, so they register nothing and are not followed.
  for (const m of stripComments(read(file)).matchAll(/^\s*(?:import|export)\b(?!\s+type\b)[^'"]*?['"](\.[^'"]+)['"]/gm)) {
    let p = normalize(join(dirname(file), m[1])).replaceAll('\\', '/');
    if (p.endsWith('.js')) p = p.slice(0, -3) + '.ts';
    else if (!p.endsWith('.ts')) p = existsSync(`${p}.ts`) ? `${p}.ts` : `${p}/index.ts`;
    out.push(p);
  }
  return out;
};
const closureOf = (file) => {
  const seen = new Set(); const stack = [file];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f); stack.push(...importsOf(f));
  }
  return seen;
};
for (const c of components) {
  const closure = closureOf(normalize(`${SRC}/${c.file}`).replaceAll('\\', '/'));
  const defined = new Set([...tagFile].filter(([, f]) => closure.has(normalize(f).replaceAll('\\', '/'))).map(([t]) => t));
  const rendered = new Set();
  for (const f of closure) {
    const code = stripComments(read(f));
    for (const m of code.matchAll(/<(b-[a-z0-9-]+)/g)) rendered.add(m[1]);
    for (const m of code.matchAll(/createElement\(\s*['"`](b-[a-z0-9-]+)/g)) rendered.add(m[1]);
  }
  const missing = [...rendered].filter((t) => tagFile.has(t) && !defined.has(t)).sort();
  check(`closure: ${c.tag} imports every b-* it renders${missing.length ? ` (missing ${missing.join(', ')})` : ''}`, missing.length === 0);
}

// ── 3. runtime ─────────────────────────────────────────────────────────────────────────────────────────────
// Children that render only on a condition get a fixture that meets it; everything else mounts bare.
const FIELD_TYPES = ['text', 'textarea', 'markdown', 'select', 'multi-select', 'tags', 'checkbox', 'switch', 'radio',
  'search', 'option-group', 'file', 'range', 'date', 'datetime', 'date-range', 'time'];
// The control each of those types renders; the fixture holds only if every one is in the form.
const FORM_CONTROLS = ['b-input', 'b-textarea', 'b-markdown-editor', 'b-select', 'b-multi-select', 'b-tag-input',
  'b-checkbox', 'b-switch', 'b-radio', 'b-search-input', 'b-option-group', 'b-file-upload', 'b-range',
  'b-date-picker', 'b-datetime-picker', 'b-date-range-picker', 'b-time'];
const FIXTURES = {
  'b-checkbox': `document.body.innerHTML = '<b-checkbox label="L" hint="A hint"></b-checkbox>';`,
  'b-switch': `document.body.innerHTML = '<b-switch label="L" hint="A hint"></b-switch>';`,
  'b-input': `document.body.innerHTML = '<b-input label="L" hint="A hint"></b-input>';`,
  'b-form': `const f = document.createElement('b-form'); document.body.append(f);
    await customElements.whenDefined('b-form');
    f.setSchema({ name: 'root', children: ${JSON.stringify(FIELD_TYPES)}.map((type) => ({
      name: 'f_' + type.replace(/-/g, '_'), type, label: type, options: [{ value: 'a', label: 'A' }] })) });`,
  'b-command-palette': `const { registerProvider } = await import('birko-web-components/command/command-provider');
    const { openCommandPalette } = await import('birko-web-components/command/b-command-palette');
    registerProvider({ id: 'slow', label: 'Slow', order: 0, search: () => new Promise(() => {}) });
    document.body.innerHTML = '<b-command-palette></b-command-palette>';
    await customElements.whenDefined('b-command-palette');
    openCommandPalette();
    await new Promise((r) => setTimeout(r, 50));
    const input = document.querySelector('b-command-palette').shadowRoot.querySelector('#search-input');
    input.value = 'x'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    window.__fixtureState = !!document.querySelector('b-command-palette').shadowRoot.querySelector('b-spinner');`,
};
// The condition a fixture exists for actually held — otherwise its PASS would be vacuous.
const FIXTURE_HOLDS = {
  'b-checkbox': `!!document.querySelector('b-checkbox').shadowRoot.querySelector('b-tooltip')`,
  'b-switch': `!!document.querySelector('b-switch').shadowRoot.querySelector('b-tooltip')`,
  'b-input': `!!document.querySelector('b-input').shadowRoot.querySelector('b-tooltip')`,
  'b-form': `${JSON.stringify(FORM_CONTROLS)}.every((t) => !!document.querySelector('b-form').shadowRoot.querySelector(t))`,
  'b-command-palette': `window.__fixtureState === true`,
};

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  for (const c of components) {
    const body = FIXTURES[c.tag] ?? `document.body.innerHTML = '<${c.tag}></${c.tag}>';`;
    let code;
    try {
      const out = await esbuild.build({
        stdin: { contents: `import '${c.path}';\n(async () => {\n${body}\nwindow.__mounted = true;\n})();`, resolveDir: SRC, loader: 'ts' },
        bundle: true, write: false, format: 'esm', alias: ALIAS, loader: { '.css': 'text' }, logLevel: 'silent',
      });
      code = out.outputFiles[0].text;
    } catch (e) {
      check(`runtime: ${c.tag} bundles alone through the documented alias (${e.errors?.[0]?.text ?? e.message})`, false);
      continue;
    }
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: code, type: 'module' });
    const mounted = await page.waitForFunction('window.__mounted === true', { timeout: 5000 }).then(() => true, () => false);
    check(`runtime: ${c.tag} mount script ran to the end`, mounted);
    await new Promise((r) => setTimeout(r, 150));
    const undefinedTags = await page.evaluate(() => {
      const found = new Set();
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.localName.startsWith('b-') && !customElements.get(el.localName)) found.add(el.localName);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      };
      walk(document);
      return [...found].sort();
    });
    if (FIXTURE_HOLDS[c.tag]) {
      check(`runtime: ${c.tag} fixture precondition holds (the conditional child was rendered)`, await page.evaluate(FIXTURE_HOLDS[c.tag]));
    }
    check(`runtime: ${c.tag} imported alone leaves no undefined b-*${undefinedTags.length ? ` (undefined: ${undefinedTags.join(', ')})` : ''}`,
      undefinedTags.length === 0);
    check(`runtime: ${c.tag} imported alone throws nothing${errors.length ? ` (${errors[0]})` : ''}`, errors.length === 0);
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`entry-points-check: ${results.length - failed.length}/${results.length} passed`);
for (const r of failed) console.log(`  ${r}`);
process.exit(failed.length ? 1 : 0);
