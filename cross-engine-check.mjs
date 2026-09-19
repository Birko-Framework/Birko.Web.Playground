// Runs the `bare-smoke` harness in BOTH Chromium and Firefox.
//
//   npm run build && node cross-engine-check.mjs
//
// Why a second engine at all: these are Shadow DOM components, and the thing `bare` does is remove a
// wrapper element and rebuild the control's accessible name from attributes. Slot rendering, the
// accessibility tree and default control metrics are exactly where engines differ, so "it works" from
// one engine is a claim about one engine. TASK-001's human test plan asked for Chromium + Firefox for
// that reason and it sat unrunnable for sixteen weeks, because `verify.mjs` launches Chromium only.
//
// Firefox comes from puppeteer's own browser cache (`npx puppeteer browsers install firefox`), so this
// needs no system Firefox and no second driver. It speaks WebDriver BiDi rather than CDP, which is why
// a couple of Chromium-only conveniences are avoided below — see the notes at each.
//
// ⚠ This does NOT replace verify.mjs. It runs one suite in two engines; verify.mjs runs seven suites
// plus the token/export checks in one. Different questions.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';
const SUITE = 'bare-smoke';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

/*
 * Engine differences that are KNOWN, FILED and not defects of this suite.
 *
 * Firefox cannot focus a form-associated control whose focusable element is inside a shadow root, so
 * it logs this instead of showing its validation bubble. Both engines still suppress the submit --
 * the correctness half agrees, and `form-assoc-smoke` § 8i asserts it in both. What differs is the
 * bubble, which is [[TASK-466]].
 *
 * ⚠ Excused by exact message, never by "ignore page errors in Firefox": the whole value of running a
 * second engine is the errors it finds that the first does not, and a blanket would throw that away
 * on the first run. This entry goes when TASK-466 closes -- an allow-list that outlives its task is a
 * blanket wearing a reason's clothes.
 */
const KNOWN_ENGINE_DIFFERENCES = [
  /The invalid form control with name=.+ is not focusable/,
];

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
const base = `http://127.0.0.1:${server.address().port}/?smoke=1`;

/** Runs the suite in one engine and returns its reported totals plus any FAIL lines. */
async function run(browserName) {
  const browser = await puppeteer.launch({ browser: browserName, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const lines = [];
  const pageErrors = [];
  page.on('console', (m) => lines.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(base, { waitUntil: 'networkidle0', timeout: 90_000 });

  // The suite reports over console. Wait for ITS summary line rather than sleeping a fixed amount --
  // verify.mjs was doing the latter and silently stopped reporting a whole suite when it outgrew the
  // timeout, which read as green. Poll for the summary, then give the per-check lines a moment: they
  // arrive AFTER their own summary, which is the second half of that same trap.
  const summary = new RegExp(`${SUITE}: (\\d+)/(\\d+)`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !lines.some((l) => summary.test(l))) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();

  const hit = lines.find((l) => summary.test(l));
  const m = hit?.match(summary);
  const known = pageErrors.filter((e) => KNOWN_ENGINE_DIFFERENCES.some((p) => p.test(e)));
  return {
    engine: browserName,
    passed: m ? Number(m[1]) : null,
    total: m ? Number(m[2]) : null,
    failures: lines.filter((l) => l.includes(`${SUITE} FAIL`)),
    pageErrors: pageErrors.filter((e) => !known.includes(e)),
    known,
  };
}

const results = [];
for (const engine of ['chrome', 'firefox']) {
  process.stdout.write(`running ${SUITE} in ${engine} … `);
  try {
    const r = await run(engine);
    results.push(r);
    console.log(r.total === null ? 'NO SUMMARY' : `${r.passed}/${r.total}`);
  } catch (err) {
    results.push({ engine, passed: null, total: null, failures: [], pageErrors: [String(err)] });
    console.log('ERROR');
  }
}
server.close();

console.log('\n--- cross-engine summary ---');
const problems = [];
for (const r of results) {
  console.log(`${r.engine.padEnd(8)} ${r.total === null ? 'did not report' : `${r.passed}/${r.total} passed`}`);
  for (const f of r.failures) console.log(`   ${f}`);
  for (const e of r.pageErrors) console.log(`   page error: ${e}`);
  for (const e of r.known ?? []) console.log(`   KNOWN (TASK-466): ${e}`);
  if (r.total === null) problems.push(`${r.engine}: the suite never reported — it did not run, which is not the same as passing`);
  else if (r.passed !== r.total) problems.push(`${r.engine}: ${r.total - r.passed} failing`);
  if (r.pageErrors.length) problems.push(`${r.engine}: ${r.pageErrors.length} page error(s)`);
}

// The interesting failure is not "one engine is red" but "the two disagree", so say so explicitly.
const totals = results.map((r) => r.total).filter((t) => t !== null);
if (totals.length === 2 && totals[0] !== totals[1]) {
  problems.push(`the engines ran different numbers of checks (${totals.join(' vs ')}) — the suite is engine-dependent`);
}

if (problems.length) {
  console.error('\nFAIL');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nPASS — ${SUITE} is green in both engines`);
