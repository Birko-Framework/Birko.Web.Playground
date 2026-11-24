// Birko TASK-976 — what a screen reader is given for a toast, read from Chrome's accessibility tree (CDP), on a fresh
// page. NVDA said nothing for the first toast of a page (its live region was created together with its text) and read
// "Item deletedUndo ×" for later ones (the buttons sat inside the live region). Checked here: the announcers are live
// regions in the tree before any toast; a toast's announcement is its message (and that its action is available),
// without "×"; an error goes to the assertive one; with a modal open, the announcer is inside the dialog, not inert.
//
//   node build.js && node toast-announce-check.mjs        (exit 1 on any FAIL)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launchBrowser } from './launch-browser.mjs';

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
const url = `http://localhost:${server.address().port}/?kb=1`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__kbToast);
  const cdp = await page.createCDPSession();

  /** The element with this id, looked for through open shadow roots (a modal's dialog is in one). */
  const FIND = (id) => `(() => {
    const find = (root) => {
      const direct = root.querySelector('#${id}');
      if (direct) return direct;
      for (const el of root.querySelectorAll('*')) { const inner = el.shadowRoot && find(el.shadowRoot); if (inner) return inner; }
      return null;
    };
    return find(document);
  })()`;
  /** Its accessibility node as Chrome exposes it: role, live, ignored, and the text it holds. */
  const axOf = async (id) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: FIND(id) });
    if (!result.objectId) return { exists: false };
    const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    const ax = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId) ?? nodes[0];
    const prop = (name) => ax?.properties?.find((p) => p.name === name)?.value?.value;
    const read = async (fn) => (await cdp.send('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration: fn, returnByValue: true })).result.value;
    const text = await read('function () { return this.textContent; }');
    const inDialog = await read('function () { return !!this.closest("dialog"); }');
    return { exists: true, role: ax?.role?.value, ignored: !!ax?.ignored, live: prop('live'), text, inDialog };
  };
  const show = (args) => page.evaluate((args) => {
    const [msg, variant, ms, withAction] = args;
    window.__kbToast.show(msg, variant, ms, withAction ? { action: { onClick: () => {} } } : {});
  }, args);

  // ── before any toast ──
  {
    const polite = await axOf('b-toast-announce');
    const assertive = await axOf('b-toast-announce-alert');
    check(`before any toast, the polite announcer is a live region in the tree (${JSON.stringify(polite)})`,
      polite.exists && !polite.ignored && polite.role === 'status' && polite.live === 'polite' && polite.text === '');
    check(`before any toast, the assertive announcer is too (${JSON.stringify(assertive)})`,
      assertive.exists && !assertive.ignored && assertive.role === 'alert' && assertive.live === 'assertive');
  }

  // ── the first toast: an undo toast ──
  await show(['Item deleted', 'success', 10000, true]);
  await sleep(400);
  {
    const polite = await axOf('b-toast-announce');
    check(`the first toast is announced as its message and its action ("${polite.text}")`,
      polite.text === 'Item deleted. Undo is available.');
    const itemLive = await page.evaluate(() => {
      const item = document.querySelector('#b-toast-system b-toast-item');
      return !!item?.shadowRoot?.querySelector('[aria-live], [role="status"], [role="alert"]')
        || document.getElementById('b-toast-system')?.hasAttribute('aria-live');
    });
    check('the toast and its container are not live regions (no "Undo ×" in the announcement)', !itemLive);
  }

  // ── an error goes to the assertive announcer ──
  await show(['Save failed.', 'error', 6000, false]);
  await sleep(400);
  {
    const assertive = await axOf('b-toast-announce-alert');
    check(`an error is announced assertively ("${assertive.text}")`, assertive.text === 'Save failed.');
  }

  // ── with a modal open, the announcer is inside the dialog and not inert ──
  await page.evaluate(async () => {
    document.querySelectorAll('b-toast-item').forEach((t) => t.remove());
    const m = document.createElement('b-modal');
    m.id = 'ta-modal';
    m.setAttribute('title', 'Edit');
    m.innerHTML = '<p>Body</p>';
    document.body.appendChild(m);
    await new Promise((r) => setTimeout(r, 50));
    m.open();
  });
  await sleep(200);
  await show(['Saved', 'success', 4000, false]);
  await sleep(600);
  {
    const polite = await axOf('b-toast-announce');
    check(`with a modal open, the announcer is in the dialog, in the tree, and says the toast (${JSON.stringify(polite)})`,
      polite.inDialog && !polite.ignored && polite.text === 'Saved');
  }
  await page.evaluate(() => { const m = document.getElementById('ta-modal'); m?.close?.(); m?.remove(); });
  await sleep(200);
  {
    const polite = await axOf('b-toast-announce');
    check(`after the modal closes, the announcer is back on the page, in the tree (${JSON.stringify({ ...polite, text: undefined })})`,
      polite.exists && !polite.inDialog && !polite.ignored);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\ntoast-announce-check: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
