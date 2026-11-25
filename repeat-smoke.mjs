// Runs chosen smoke suites many times to tell a flaky check from a broken one (Birko TASK-985).
// Each run loads /?smoke=1&only=<suites> in a fresh page and collects every suite's PASS/FAIL lines.
//
//   node build.js && node repeat-smoke.mjs carousel-smoke,ribbon-overflow-smoke [runs=20] [cpu=1] [only|full]
//
// `full` loads every suite (as verify does) and still reports only the named ones: a flake that needs the others running
// beside it shows up only there. `cpu` is Chrome's CPU throttling rate (4 = four times slower), to make a timing race show up on a fast machine.
// Exit 1 if any run had a FAIL.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launchBrowser } from './launch-browser.mjs';

const [only = '', runsArg = '20', cpuArg = '1', mode = 'only'] = process.argv.slice(2);
if (!only) { console.error('usage: node repeat-smoke.mjs <suite[,suite]> [runs] [cpu]'); process.exit(2); }
const suites = only.split(',');
const RUNS = Number(runsArg), CPU = Number(cpuArg);

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

const failures = new Map(); // check line -> count
let failedRuns = 0;
const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  for (let run = 1; run <= RUNS; run++) {
    const page = await browser.newPage();
    if (CPU > 1) { const s = await page.createCDPSession(); await s.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
    const lines = [];
    const done = new Set();
    page.on('console', (m) => {
      const t = m.text();
      lines.push(t);
      for (const s of suites) if (new RegExp(`\\[playground\\] ${s}: \\d+/\\d+ passed`).test(t)) done.add(s);
    });
    await page.goto(`http://localhost:${port}/?smoke=1${mode === 'full' ? '' : `&only=${only}`}`, { waitUntil: 'load', timeout: 120_000 });
    const deadline = Date.now() + 240_000;
    while (done.size < suites.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const fails = lines.filter((t) => / FAIL /.test(t) && suites.some((s) => t.includes(s)));
    if (done.size < suites.length) fails.push(`did not finish: ${suites.filter((s) => !done.has(s)).join(', ')}`);
    if (fails.length) failedRuns++;
    for (const f of fails) { const k = f.replace(/^.*?\] /, ''); failures.set(k, (failures.get(k) ?? 0) + 1); }
    console.log(`run ${run}/${RUNS}: ${fails.length ? `${fails.length} FAIL` : 'ok'}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
for (const [k, n] of failures) console.log(`  ${n}x ${k}`);
console.log(`repeat-smoke ${only} (${mode}, cpu x${CPU}): ${RUNS - failedRuns}/${RUNS} runs clean`);
process.exit(failedRuns ? 1 : 0);
