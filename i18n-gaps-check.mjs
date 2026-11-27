// Headless check for Birko TASK-1009 (asked for by Symbio at its TASK-1140): three texts a Czech screen still showed
// in English or in the wrong form.
//
//   1. b-chat formatted a message's time with the BROWSER's locale (`toLocaleTimeString([])`), so a Czech app in an
//      English browser showed "02:19 PM"; its status and empty texts were hard-coded English.
//   2. b-pagination had one word for the count, so Czech read "1 položek". `bwc.pagination.items` may now hold plural
//      forms ({ one, few, many, other }), chosen by the count; a CRUD page's `paginationLabels.items` may be a function
//      of the count, which b-data-table calls with its total.
//   3. b-select read "No matches" only from its attribute, which a b-form field cannot set; it now reads
//      `bwc.select.noMatches`.
//
// The page is switched to Czech through the ribbon's locale item, as locale-switch-check.mjs does; the Czech words come
// from this Playground's locales/cs.json.
// Run: node build.js && node i18n-gaps-check.mjs      (exit 0 = all pass, 1 = a FAIL)
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
const port = server.address().port;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

// The browser speaks English; only the app is Czech. That is the case Symbio hit.
const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));

const TIME = Date.UTC(2026, 10, 27, 14, 19);

// Fixtures, at the document level so the locale switch re-renders them.
await page.evaluate((time) => {
  const host = document.createElement('div');
  host.id = 'gaps';
  host.innerHTML = [1, 2, 5]
    .map((n) => `<b-pagination class="pg" data-n="${n}" page="1" total-pages="1" total-count="${n}"></b-pagination>`)
    .join('')
    + '<b-pagination class="pg-attr" page="1" total-pages="1" total-count="2" label-items="kusů"></b-pagination>'
    + '<b-select class="sel" searchable></b-select><b-chat class="chat"></b-chat>';
  document.body.appendChild(host);
  host.querySelector('.sel').setOptions([]);
  const chat = host.querySelector('.chat');
  chat.addMessage({ id: 'a', role: 'user', content: 'ahoj', timestamp: time, status: 'sending' });
}, TIME);
await new Promise((r) => setTimeout(r, 100));

const read = () => page.evaluate(() => {
  const g = document.querySelector('#gaps');
  const sr = (el) => el.shadowRoot;
  const chat = sr(g.querySelector('.chat'));
  return {
    pages: [...g.querySelectorAll('.pg')].map((p) => sr(p).querySelector('.info')?.textContent.trim()),
    pageAttr: sr(g.querySelector('.pg-attr')).querySelector('.info')?.textContent.trim(),
    noMatches: sr(g.querySelector('.sel')).querySelector('.no-results')?.textContent.trim(),
    time: chat.querySelector('.message-time')?.textContent.trim(),
    sending: chat.querySelector('.message-status.sending')?.textContent.trim(),
    send: chat.querySelector('#send-btn')?.textContent.trim(),
    placeholder: chat.querySelector('#input')?.getAttribute('placeholder'),
  };
});

const switchTo = async (locale, expectFirstPage) => {
  await page.evaluate((locale) => document.querySelector('#pg-ribbon')
    .dispatchEvent(new CustomEvent('item-click', { detail: { itemId: `locale:${locale}` } })), locale);
  for (let i = 0; i < 40; i++) {
    const r = await read();
    if (r.pages[0] === expectFirstPage) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  return read();
};

// ── English: the bundle's plural forms, and the English defaults ────────────────────────────────────────────
const en = await read();
check('en: b-pagination reads "1 item", "2 items", "5 items"', JSON.stringify(en.pages) === JSON.stringify(['1 item', '2 items', '5 items']), JSON.stringify(en.pages));
check('en: b-select shows "No matches"', en.noMatches === 'No matches', en.noMatches);
check('en: b-chat status and button in English', en.sending === 'Sending...' && en.send === 'Send', `${en.sending} / ${en.send}`);

// ── Czech, in an English browser ───────────────────────────────────────────────────────────────────────────
const cs = await switchTo('cs', '1 položka');
check('cs: b-pagination picks the plural form per count (1 položka, 2 položky, 5 položek)',
  JSON.stringify(cs.pages) === JSON.stringify(['1 položka', '2 položky', '5 položek']), JSON.stringify(cs.pages));
check('cs: a label-items attribute still wins over the bundle', cs.pageAttr === '2 kusů', cs.pageAttr);
check('cs: b-select reads bwc.select.noMatches', cs.noMatches === 'Žádné shody', cs.noMatches);
const csTime = new Date(TIME).toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' });
check(`cs: b-chat formats the time in the app's locale (${csTime}), not the browser's`, cs.time === csTime && !/AM|PM/.test(cs.time ?? ''), cs.time);
check('cs: b-chat status, button and placeholder from bwc.chat.*',
  cs.sending === 'Odesílá se...' && cs.send === 'Odeslat' && cs.placeholder === 'Napište zprávu...',
  `${cs.sending} / ${cs.send} / ${cs.placeholder}`);

// ── b-data-table: a paginationLabels.items function gets the total ─────────────────────────────────────────
const table = await page.evaluate(async () => {
  const t = document.createElement('b-data-table');
  document.querySelector('#gaps').appendChild(t);
  const seen = [];
  const apiClient = { get: async () => ({ ok: true, status: 200, data: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }] }) };
  t.setConfig({
    endpoint: '/x', apiClient, columns: [{ key: 'name', label: 'Name' }],
    paginationLabels: { items: (n) => { seen.push(n); return n === 1 ? 'kus' : 'kusy'; } },
  });
  await t.load();
  const pager = () => t.shadowRoot?.querySelector('b-pagination');
  // The first render precedes the load (count 0); wait for the loaded total.
  for (let i = 0; i < 40 && pager()?.getAttribute('total-count') !== '3'; i++) await new Promise((r) => setTimeout(r, 50));
  const pg = pager();
  return { attr: pg?.getAttribute('label-items') ?? null, info: pg?.shadowRoot?.querySelector('.info')?.textContent.trim(), seen };
});
check('b-data-table: a paginationLabels.items function is called with the total and its word reaches b-pagination',
  table.seen.includes(3) && table.attr === 'kusy' && table.info === '3 kusy', JSON.stringify(table));

check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\ni18n-gaps-check: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
