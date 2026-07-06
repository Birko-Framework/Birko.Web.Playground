// Headless verification of the built playground (wwwroot/). Serves it, loads it in Chromium,
// switches through every section, counts what renders, and reports console warnings.
// Run: npm run build && node verify.mjs   (requires puppeteer)
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
const logs = [];
page.on('console', (m) => { const t = m.text(); if (t.includes('[playground]')) logs.push(`${m.type()}: ${t}`); });
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

// ?smoke=1 opts into the EPIC-002 backport-smoke harness (gated out of interactive loads).
await page.goto(`http://localhost:${port}/?smoke=1`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));

const report = await page.evaluate(async () => {
  const nav = document.querySelector('#pg-nav');
  const gallery = document.querySelector('#pg-gallery');
  const sections = [...gallery.querySelectorAll(':scope > .pg-grid')];
  // force every lazy section to populate (the app builds on the switcher's 'change')
  for (const sec of sections) {
    nav.dispatchEvent(new CustomEvent('change', { detail: { value: sec.dataset.cat }, bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 400));

  const empties = [];
  const perSection = {};
  let total = 0;
  for (const sec of sections) {
    const cat = sec.dataset.cat;
    const items = [...sec.querySelectorAll('.pg-item')];
    perSection[cat] = items.length;
    total += items.length;
    for (const card of items) {
      const inst = card.querySelector('.pg-stage > *');
      const hasNote = !!card.querySelector('.pg-note');
      const hasLaunch = !!card.querySelector('.pg-launch'); // overlay opener — intentionally inline-empty
      const rendered = inst && (inst.shadowRoot ? inst.shadowRoot.childElementCount > 0 : inst.childElementCount > 0 || (inst.textContent || '').trim().length > 0);
      if (inst && !rendered && !hasNote && !hasLaunch) empties.push(inst.tagName.toLowerCase());
    }
  }
  // open the tokens drawer to build the accordion, then count groups
  document.querySelector('#open-tokens')?.click();
  await new Promise((r) => setTimeout(r, 300));
  const groups = document.querySelectorAll('#token-list b-accordion > [slot]').length;
  return { perSection, total, empties, tokenGroups: groups };
});

console.log('=== Playground headless verification ===');
console.log('Per-section component counts:', JSON.stringify(report.perSection));
console.log('Total components rendered:', report.total);
console.log('Token groups:', report.tokenGroups);
console.log('Components that rendered EMPTY (no shadow content, no note):', report.empties.length ? report.empties.join(', ') : '(none)');
console.log('--- [playground] console messages ---');
console.log(logs.length ? logs.join('\n') : '(none)');

await browser.close();
server.close();
