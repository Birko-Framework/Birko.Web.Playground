// Reads the ACCESSIBILITY TREE for a control carrying `description`, in Chromium and Firefox.
//
//   npm run build && node a11y-description-check.mjs
//
// `description-smoke` already asserts the wiring: that `aria-describedby` carries the help id, that it
// resolves to a real element, and that with an error present both ids appear with the error first.
// That is the DOM. What it cannot say is what an assistive technology is actually handed — the
// browser computes an accessible description from those IDREFs, and a correct-looking IDREF that the
// engine declines to resolve (a shadow boundary, a hidden ancestor, an id the engine scopes
// differently) produces perfect markup and a silent screen reader.
//
// This is the closest a headless run gets to TASK-091's "focus a field with a screen reader and
// confirm it is announced as the field's description": it asks the browser for the computed node,
// which is the same thing it hands NVDA or VoiceOver. It is not a substitute for hearing one speak —
// announcement ORDER, verbosity and the AT's own heuristics are not here — but it moves the claim
// from "the attribute points somewhere" to "the browser computed this description".
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

const DESCRIPTION = 'Weight in kilograms, one decimal';
const ERROR = 'Too low';

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

const results = [];

for (const engine of ['chrome', 'firefox']) {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  const browser = await puppeteer.launch({ browser: engine, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 90_000 });

  // Build the two cases in the page, on-screen: an off-screen or hidden host is exactly the thing
  // that makes an engine drop a node from the accessibility tree, which would make this check report
  // a failure that only its own fixture caused.
  await page.evaluate(async ({ description, error }) => {
    const host = document.createElement('div');
    host.id = 'a11y-probe';
    host.style.cssText = 'position:fixed;top:0;left:0;width:420px;background:#fff;z-index:99999';
    host.innerHTML = `
      <b-input id="probe-desc" label="Weight" description="${description}"></b-input>
      <b-input id="probe-both" label="Reps" description="${description}" error="${error}"></b-input>
      <div style="width:120px" id="narrow">
        <b-input id="probe-narrow" label="N"
                 description="A deliberately long description that must wrap inside a narrow column rather than widening it"></b-input>
      </div>`;
    document.body.appendChild(host);
    await new Promise((r) => setTimeout(r, 400));
  }, { description: DESCRIPTION, error: ERROR });

  // ⚠ Chromium only, and not by choice: `page.accessibility.snapshot()` goes over CDP, and Firefox
  // speaks WebDriver BiDi, which has no accessibility-tree API for puppeteer to call. So the computed
  // description is read in Chromium and the LAYOUT half below runs in both — which is the honest
  // split rather than silently reporting a Chromium result twice.
  const tree = engine === 'chrome'
    ? await page.accessibility.snapshot({ interestingOnly: false })
    : null;

  /** Every node in the tree, flattened — the control is nested inside the component's own structure. */
  const flatten = (node, out = []) => {
    if (!node) return out;
    out.push(node);
    for (const c of node.children ?? []) flatten(c, out);
    return out;
  };
  if (tree) {
    const nodes = flatten(tree);
    const described = nodes.filter((n) => (n.description ?? '').includes(DESCRIPTION));

    check('the browser computes an accessible description from the description attribute',
      described.length > 0,
      described.length ? `${described.length} node(s)` : `no node in the tree carries it (${nodes.length} nodes scanned)`);

    // With an error present the control must still be described — TASK-091 puts the error FIRST and
    // the description second, and an engine exposing only the first would silently drop the help text.
    const both = nodes.filter((n) => (n.description ?? '').includes(ERROR) && (n.description ?? '').includes(DESCRIPTION));
    check('with an error set, the description is still part of the computed description',
      both.length > 0,
      both.length ? both[0].description : 'the error displaced it');

    check('and the error comes first in it',
      both.length > 0 && both[0].description.indexOf(ERROR) < both[0].description.indexOf(DESCRIPTION),
      both.length ? both[0].description : 'n/a');
  } else {
    console.log(`  (accessibility tree not readable in ${engine}: BiDi exposes no such API)`);
  }

  // The wrapping half of the human plan: a long description must wrap, not widen its column.
  const widths = await page.evaluate(() => {
    const narrow = document.querySelector('#narrow');
    const field = document.querySelector('#probe-narrow');
    return {
      container: Math.round(narrow.getBoundingClientRect().width),
      field: Math.round(field.getBoundingClientRect().width),
      scroll: Math.round(narrow.scrollWidth),
    };
  });
  check('a long description wraps rather than widening its column',
    widths.field <= widths.container + 1 && widths.scroll <= widths.container + 1,
    `container=${widths.container}px field=${widths.field}px scroll=${widths.scroll}px`);

  await page.evaluate(() => document.querySelector('#a11y-probe')?.remove());
  await browser.close();
  results.push({ engine, checks });
}
server.close();

let failed = 0;
for (const { engine, checks } of results) {
  console.log(`\n[${engine}]`);
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  }
}

// Say exactly what was checked where. "Green in both engines" would be an overclaim: only the layout
// half ran in Firefox, because BiDi exposes no accessibility tree.
console.log(failed
  ? `\nFAIL — ${failed} check(s)`
  : '\nPASS — computed accessible description verified in Chromium; wrapping verified in both engines');
process.exit(failed ? 1 : 0);
