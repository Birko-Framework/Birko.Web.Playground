// Runs one playground suite in BOTH Chromium and Firefox.
//
//   npm run build && node cross-engine-check.mjs            # bare-smoke   (TASK-001)
//   npm run build && node cross-engine-check.mjs grid-bench # the benchmark (TASK-002)
//
// Why a second engine at all: these are Shadow DOM components, and the things under test here —
// removing a wrapper and rebuilding an accessible name from attributes (`bare`), or paying for a
// shadow root per table cell (the benchmark) — land exactly where engines differ: slot rendering, the
// accessibility tree, and the cost of constructing a shadow root. "It works" from one engine is a
// claim about one engine. TASK-001 and TASK-002 both asked for Chromium + Firefox and both sat
// unrunnable for sixteen weeks, because `verify.mjs` launches Chromium only.
//
// Firefox comes from puppeteer's own browser cache (`npx puppeteer browsers install firefox`), so this
// needs no system Firefox and no second driver; it speaks WebDriver BiDi rather than CDP.
//
// ⚠ This does NOT replace verify.mjs. It runs one suite in two engines; verify.mjs runs seven suites
// plus the token/export checks in one. Different questions.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = 'wwwroot';

/*
 * A suite that reports a `name: passed/total` summary is checked against it.
 *
 * `grid-bench` reports timings rather than checks, so it is run for its OUTPUT: the lines are printed
 * for comparison against the ratios recorded in TASK-002, and only a crash, a page error or a missing
 * configuration fails the run. Giving a benchmark a pass/fail verdict would mean inventing a
 * threshold nobody measured — and the durable result there is the RATIO between the two variants, not
 * absolute milliseconds, which are machine- and engine-dependent by nature.
 */
const SUITE = process.argv[2] ?? 'bare-smoke';
const IS_BENCHMARK = SUITE === 'grid-bench';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

/*
 * Engine differences that are KNOWN, FILED and not defects of the suite under test.
 *
 * Firefox cannot focus a form-associated control whose focusable element is inside a shadow root, so
 * it logs this instead of showing its validation bubble. Both engines still suppress the submit — the
 * correctness half agrees, and `form-assoc-smoke` § 8i asserts it in both. What differs is the
 * bubble, which is TASK-466.
 *
 * ⚠ Excused by exact message, never by "ignore page errors in Firefox": the whole value of a second
 * engine is the errors it finds that the first does not, and a blanket would have thrown that away on
 * the very first run — this entry exists *because* that run found something. It goes when TASK-466
 * closes; an allow-list that outlives its task is a blanket wearing a reason's clothes.
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

/** Runs the suite in one engine and returns what it reported. */
async function run(browserName) {
  const browser = await puppeteer.launch({ browser: browserName, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const lines = [];
  const pageErrors = [];
  page.on('console', (m) => lines.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(base, { waitUntil: 'networkidle0', timeout: 90_000 });

  // Wait for the suite's OWN completion signal rather than sleeping a fixed amount. verify.mjs did the
  // latter and silently stopped reporting a whole suite once it outgrew the timeout — and a suite that
  // never ran leaves no FAIL lines to grep, so it read as green. Then give the per-check lines a
  // moment: they arrive AFTER their own summary, which is the second half of that same trap.
  const summary = new RegExp(`${SUITE}: (\\d+)/(\\d+)`);
  const ratios = () => lines.filter((l) => l.includes('grid-bench ratio')).length;
  const done = IS_BENCHMARK ? () => ratios() >= 2 : () => lines.some((l) => summary.test(l));

  // The benchmark builds 3000 cells twice per pass, three passes, two configurations — it needs far
  // longer than a check suite, and longer again in Firefox.
  const deadline = Date.now() + (IS_BENCHMARK ? 600_000 : 60_000);
  while (Date.now() < deadline && !done()) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();

  const m = lines.find((l) => summary.test(l))?.match(summary);
  const known = pageErrors.filter((e) => KNOWN_ENGINE_DIFFERENCES.some((p) => p.test(e)));
  return {
    engine: browserName,
    passed: m ? Number(m[1]) : null,
    total: m ? Number(m[2]) : null,
    failures: lines.filter((l) => l.includes(`${SUITE} FAIL`)),
    pageErrors: pageErrors.filter((e) => !known.includes(e)),
    known,
    output: lines.filter((l) => l.includes(SUITE)).map((l) => l.replace(/^.*\[playground\] /, '')),
  };
}

const results = [];
for (const engine of ['chrome', 'firefox']) {
  process.stdout.write(`running ${SUITE} in ${engine} … `);
  try {
    const r = await run(engine);
    results.push(r);
    console.log(IS_BENCHMARK ? 'done' : r.total === null ? 'NO SUMMARY' : `${r.passed}/${r.total}`);
  } catch (err) {
    results.push({ engine, passed: null, total: null, failures: [], pageErrors: [String(err)], known: [], output: [] });
    console.log('ERROR');
  }
}
server.close();

console.log(`\n--- cross-engine summary (${SUITE}) ---`);
const problems = [];
for (const r of results) {
  if (IS_BENCHMARK) {
    console.log(`\n[${r.engine}]`);
    for (const l of r.output) console.log(`   ${l}`);
  } else {
    console.log(`${r.engine.padEnd(8)} ${r.total === null ? 'did not report' : `${r.passed}/${r.total} passed`}`);
  }
  for (const f of r.failures) console.log(`   ${f}`);
  for (const e of r.pageErrors) console.log(`   page error: ${e}`);
  for (const e of r.known) console.log(`   KNOWN (TASK-466): ${e}`);

  if (IS_BENCHMARK) {
    if (r.output.filter((l) => l.includes('ratio')).length < 2) {
      problems.push(`${r.engine}: the benchmark did not report both configurations`);
    }
  } else if (r.total === null) {
    problems.push(`${r.engine}: the suite never reported — it did not run, which is not the same as passing`);
  } else if (r.passed !== r.total) {
    problems.push(`${r.engine}: ${r.total - r.passed} failing`);
  }
  if (r.pageErrors.length) problems.push(`${r.engine}: ${r.pageErrors.length} page error(s)`);
}

// For a check suite the interesting failure is not "one engine is red" but "the two disagree about how
// many checks there even are", so say so explicitly.
const totals = results.map((r) => r.total).filter((t) => t !== null);
if (!IS_BENCHMARK && totals.length === 2 && totals[0] !== totals[1]) {
  problems.push(`the engines ran different numbers of checks (${totals.join(' vs ')}) — the suite is engine-dependent`);
}

if (problems.length) {
  console.error('\nFAIL');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(IS_BENCHMARK
  ? `\nPASS — ${SUITE} ran in both engines; compare the ratios above against the decision recorded in TASK-002`
  : `\nPASS — ${SUITE} is green in both engines`);
