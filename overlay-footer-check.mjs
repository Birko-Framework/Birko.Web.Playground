// Birko TASK-980 (reported by Reps TASK-196) — an empty overlay footer took space. <b-modal> always rendered its
// footer (padding + top border) even with nothing in slot="footer", and <b-drawer>'s `.overlay-footer:empty` rule
// never matched (the div always holds its <slot>). Checked in Chrome on both components: an empty footer takes no
// space and draws no border; one slotted in later appears; removing it hides the footer again; a footer present
// from the start looks as before.
//
//   node build.js && node overlay-footer-check.mjs        (exit 1 on any FAIL)
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
const url = `http://localhost:${server.address().port}/`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!customElements.get('b-modal') && !!customElements.get('b-drawer'));

  /** Mount and open `tag`, with a footer from the start or not. */
  const open = (tag, withFooter) => page.evaluate((tag, withFooter) => {
    document.getElementById('of')?.remove();
    const el = document.createElement(tag);
    el.id = 'of';
    el.setAttribute('title', 'Footer check');
    if (tag === 'b-drawer') el.setAttribute('modal', '');
    el.innerHTML = `<p>Body line</p>${withFooter ? '<div slot="footer"><button>Save</button></div>' : ''}`;
    document.body.appendChild(el);
    el.open();
  }, tag, withFooter);
  const footer = () => page.evaluate(() => {
    const f = document.getElementById('of').shadowRoot.querySelector('.overlay-footer');
    const cs = getComputedStyle(f);
    return { height: f.getBoundingClientRect().height, display: cs.display, border: cs.borderTopWidth, padding: cs.paddingTop };
  });
  const addFooter = () => page.evaluate(() => {
    const d = document.createElement('div'); d.slot = 'footer'; d.id = 'of-late'; d.innerHTML = '<button>Later</button>';
    document.getElementById('of').appendChild(d);
  });
  const removeFooter = () => page.evaluate(() => document.getElementById('of-late')?.remove());

  for (const tag of ['b-modal', 'b-drawer']) {
    await open(tag, false);
    await sleep(150);
    let f = await footer();
    check(`${tag}: an empty footer takes no space and draws no border (${f.display}, ${Math.round(f.height)}px)`,
      f.display === 'none' && f.height === 0);
    await addFooter();
    await sleep(100);
    f = await footer();
    check(`${tag}: a footer slotted in later appears (${f.display}, ${Math.round(f.height)}px, border ${f.border})`,
      f.display !== 'none' && f.height > 20 && f.border !== '0px');
    await removeFooter();
    await sleep(100);
    f = await footer();
    check(`${tag}: removing it hides the footer again (${f.display})`, f.display === 'none');
    await open(tag, true);
    await sleep(150);
    f = await footer();
    check(`${tag}: a footer from the start shows as before (${f.display}, padding ${f.padding}, border ${f.border})`,
      f.display === 'flex' && parseFloat(f.padding) > 0 && f.border !== '0px');
    await page.evaluate(() => document.getElementById('of').close());
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`overlay-footer-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
