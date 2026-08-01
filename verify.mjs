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

// Each smoke suite reports `[playground] <name>: N/M passed`, then one `<name> PASS|FAIL <check>` line
// per check. WAIT for all of it rather than trusting a fixed sleep — twice now the sleep has been the
// thing under test:
//   - when backport-smoke grew past the sleep budget it stopped reporting AT ALL, which reads as green,
//     because a suite that never ran leaves no FAIL lines to grep;
//   - and the per-check lines arrive AFTER their own summary, so grepping for FAIL the moment the
//     summary lands found none of them and reported "0 failing" over a 223/224 suite.
// So: wait for every summary, then wait for every suite's detail lines to be all in, and take the
// verdict from the summary counts, which cannot race.
const SUITES = [
  'backport-smoke', 'bare-smoke', 'description-smoke',
  'form-assoc-smoke', 'ribbon-overflow-smoke', 'ribbon-scaling-smoke',
];
const SUMMARY = /\] ([a-z-]+): (\d+)\/(\d+) passed/;
const summaries = () => new Map(logs.flatMap((l) => {
  const m = SUMMARY.exec(l);
  return m && SUITES.includes(m[1]) ? [[m[1], { passed: +m[2], total: +m[3] }]] : [];
}));
const details = (suite) => logs.filter((l) => l.includes(`] ${suite} PASS `) || l.includes(`] ${suite} FAIL `)).length;
const settled = () => {
  const s = summaries();
  return s.size === SUITES.length && SUITES.every((n) => details(n) >= s.get(n).total);
};
const deadline = Date.now() + 60_000;
while (!settled() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));

console.log('=== Playground headless verification ===');
console.log('Per-section component counts:', JSON.stringify(report.perSection));
console.log('Total components rendered:', report.total);
console.log('Token groups:', report.tokenGroups);
console.log('Components that rendered EMPTY (no shadow content, no note):', report.empties.length ? report.empties.join(', ') : '(none)');
console.log('--- [playground] console messages ---');
console.log(logs.length ? logs.join('\n') : '(none)');

const final = summaries();
const absent = SUITES.filter((s) => !final.has(s));
const truncated = SUITES.filter((s) => final.has(s) && details(s) < final.get(s).total);
const failedCount = [...final.values()].reduce((n, { passed, total }) => n + (total - passed), 0);
const failedLines = logs.filter((l) => l.includes(' FAIL '));

console.log('--- summary ---');
for (const [name, { passed, total }] of final) console.log(`${name}: ${passed}/${total} passed`);
if (absent.length) console.log(`SUITES THAT NEVER REPORTED: ${absent.join(', ')}`);
if (truncated.length) console.log(`SUITES WHOSE DETAIL LINES DID NOT ALL ARRIVE: ${truncated.join(', ')}`);
console.log(`Failing checks: ${failedCount}`);
for (const l of failedLines) console.log(l.replace(/^\w+: \[playground\] /, '  '));
if (absent.length || truncated.length || failedCount) process.exitCode = 1;

await browser.close();
server.close();
