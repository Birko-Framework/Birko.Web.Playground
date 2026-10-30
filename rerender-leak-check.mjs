// Headless check that re-rendering a component does not pile up event listeners (TASK-790).
//
// A locale switch soft-updates components; TASK-790 extends that to components nested in other components'
// shadow roots, which the broadcast used to skip partly for fear of duplicated listeners. A component that wires
// `addEventListener` in onUpdated() without `listen()` (or its own AbortController) gains one more listener on
// every re-render, so this script measures it for every live BaseComponent in every gallery section: it tracks
// each listener added and whether it was removed or its signal aborted, soft-updates the instance, and calls
// it a leak only when the live count grows on BOTH of two later rounds (one-off lazy wiring is not a leak).
//
// Run: node build.js && node rerender-leak-check.mjs      (exit 0 = no leak, 1 = a FAIL)
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

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// Track every listener before the app's own scripts run.
await page.evaluateOnNewDocument(() => {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const live = new Set();
  const capOf = (o) => (typeof o === 'boolean' ? o : !!o?.capture);
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    add.call(this, type, fn, opts);
    if (!fn) return;
    const signal = typeof opts === 'object' ? opts?.signal : undefined;
    if (signal?.aborted) return;
    const capture = capOf(opts);
    for (const e of live) if (e.target === this && e.type === type && e.fn === fn && e.capture === capture) return;
    const entry = { target: this, type, fn, capture };
    live.add(entry);
    if (signal) add.call(signal, 'abort', () => live.delete(entry), { once: true });
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    remove.call(this, type, fn, opts);
    const capture = capOf(opts);
    for (const e of live) if (e.target === this && e.type === type && e.fn === fn && e.capture === capture) live.delete(e);
  };
  window.__liveListeners = live;
});

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));

const report = await page.evaluate(async () => {
  const nav = document.querySelector('#pg-ribbon');
  const sections = [...document.querySelectorAll('#pg-gallery > .pg-grid')];
  for (const sec of sections) nav.dispatchEvent(new CustomEvent('item-click', { detail: { itemId: `cat:${sec.dataset.cat}` } }));
  await new Promise((r) => setTimeout(r, 800));

  const all = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (typeof el.softUpdate === 'function' && el.shadowRoot) all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);

  const live = window.__liveListeners;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const leaks = [];
  const lost = [];
  let measured = 0;
  for (const el of all) {
    // A listener on a node no longer in the page cannot fire, and the node is garbage once the tracker lets go.
    const reachable = () => [...live].filter((e) => !(e.target instanceof Node) || e.target.isConnected);
    if (!el.isConnected) continue;
    const round = async () => { try { el.softUpdate(); } catch { /* render errors are verify.mjs's job */ } await settle(); return reachable().length; };
    // Live listeners per target + event type: a leak is a pair whose count grows, not a listener replaced.
    const counts = () => {
      const m = new Map();
      for (const e of reachable()) {
        const byType = m.get(e.target) ?? new Map();
        byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
        m.set(e.target, byType);
      }
      return m;
    };
    // What a re-render with nothing changed takes away: attributes set on shadow-tree nodes outside render().
    const snap = () => {
      const m = new Map();
      for (const n of el.shadowRoot.querySelectorAll('*')) m.set(n, new Map([...n.attributes].map((a) => [a.name, a.value])));
      return m;
    };
    const s0 = snap();
    await round();
    for (const [n, attrs] of s0) {
      if (!n.isConnected) continue;
      for (const [name, value] of attrs) {
        const now = n.getAttribute(name);
        if (now === value) continue;
        if (name === 'class' && now !== null && [...n.classList].sort().join(' ') === value.split(/\s+/).filter(Boolean).sort().join(' ')) continue;
        lost.push({ tag: el.localName, nested: !(el.getRootNode() instanceof Document), node: `${n.localName}${n.id ? '#' + n.id : ''}${n.classList?.length ? '.' + [...n.classList][0] : ''}`, attr: name, before: value.slice(0, 60), after: now === null ? null : now.slice(0, 60) });
      }
    }
    const l0 = reachable().length;
    const c0 = counts();
    const l1 = await round();
    const l2 = await round();
    measured++;
    if (l1 > l0 && l2 > l1) {
      const c2 = counts();
      const where = [];
      for (const [t, byType] of c2) {
        for (const [type, n] of byType) {
          if (n <= (c0.get(t)?.get(type) ?? 0)) continue;
          const name = t === window ? 'window' : t === document ? 'document' : t.nodeType === 1
            ? `${t.localName}${t.id ? '#' + t.id : ''}${t.classList?.length ? '.' + [...t.classList].slice(0, 2).join('.') : ''}`
            : t.constructor?.name ?? '?';
          where.push(`${name}:${type}`);
        }
      }
      where.splice(8);
      const root = el.getRootNode();
      leaks.push({ tag: el.localName, nested: !(root instanceof Document), perRender: (l2 - l0) / 2, where });
    }
  }
  return { instances: all.length, measured, leaks, lost };
});

await browser.close();
server.close();

const byTag = new Map();
for (const l of report.leaks) if (!byTag.has(l.tag)) byTag.set(l.tag, l);
console.log(`${report.measured} component instances re-rendered (${report.instances} found)`);
for (const l of byTag.values()) {
  console.log(`FAIL ${l.tag}${l.nested ? ' (nested)' : ''}: +${l.perRender} listener(s) per re-render on ${l.where.join(', ')}`);
}
// Not a failure: what re-rendering ONE component alone takes from its shadow tree. Usually state its host set on it
// (b-ribbon's roving tabindex), which the locale broadcast keeps by re-rendering hosts last; listed so a new entry
// is looked at. A dialog's `open` was one (TASK-791) and is kept by the morph now.
const lostSeen = new Set();
for (const l of report.lost) {
  const key = `${l.tag} ${l.node} ${l.attr}`;
  if (lostSeen.has(key)) continue;
  lostSeen.add(key);
  console.log(`note ${l.tag}${l.nested ? ' (nested)' : ''}: ${l.node} [${l.attr}] "${l.before}" -> ${l.after === null ? 'removed' : '"' + l.after + '"'}`);
}
if (pageErrors.length) console.log(`page errors:\n  ${pageErrors.join('\n  ')}`);
if (!byTag.size) console.log('PASS no component gains listeners on re-render');
process.exit(byTag.size || pageErrors.length ? 1 : 0);
