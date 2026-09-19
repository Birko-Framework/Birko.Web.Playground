// Runs a playground suite in WEBKIT, the engine puppeteer cannot drive.
//
//   npm run build && node webkit-check.mjs form-assoc-smoke
//
// Why a third engine, and why this one in particular: TASK-035 made fifteen controls form-associated
// through `ElementInternals`, and its human test plan asks for "Chromium + Firefox + WebKit —
// ElementInternals / form-association support and validation-bubble behaviour differ across engines."
// WebKit is the one where that support landed last and where the differences are most likely to be
// real rather than cosmetic, so a form-association suite that has only ever run in Chromium is a claim
// about Chromium.
//
// Playwright rather than puppeteer because puppeteer drives Chromium and Firefox only. Playwright and
// its WebKit build already exist in this checkout's sibling consumer (Reps' ui-e2e suite), so this
// resolves it from there rather than adding a second heavyweight dependency to the playground for one
// script. ⚠ That is a real coupling and it is why this file fails with an explanation rather than a
// module-not-found stack when the sibling is absent.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'wwwroot';
const SUITE = process.argv[2] ?? 'form-assoc-smoke';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

const PLAYWRIGHT = resolve(
  process.env.BIRKO_PLAYWRIGHT
    ?? '../../Consumers/WorkoutTracker/Reps.Web/tests/ui-e2e/node_modules/playwright/index.mjs',
);
if (!existsSync(PLAYWRIGHT)) {
  console.error(
    'Cannot find Playwright.\n'
    + `  looked in: ${PLAYWRIGHT}\n`
    + '  This borrows the WebKit build from the Reps ui-e2e suite rather than adding Playwright to the\n'
    + '  playground for one script. Set BIRKO_PLAYWRIGHT to a playwright entry point, or install it here.',
  );
  process.exit(1);
}
const { webkit } = await import(pathToFileURL(PLAYWRIGHT).href);

/*
 * Checks that are KNOWN, FILED and not defects of the suite — engine capability gaps, not framework bugs.
 *
 * `b-date-picker native` borrows the inner `<input type="date">`'s validity, and this WebKit build does
 * not implement that input type: it reports `type="text"`, so there is no `rangeUnderflow` to mirror
 * and the control reports valid. Measured directly against the same markup in both engines. That is
 * TASK-467, which also has to establish whether real Safari is affected or only this build.
 *
 * ⚠ By exact check name, never "ignore WebKit failures": this entry exists because the first WebKit run
 * found something, and a blanket would have discarded exactly that. It goes when TASK-467 closes.
 */
const KNOWN_ENGINE_GAPS = [
  'b-date-picker native mirrors min via rangeUnderflow',
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

const browser = await webkit.launch();
const page = await browser.newPage();

const lines = [];
const pageErrors = [];
page.on('console', (m) => lines.push(m.text()));
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle', timeout: 90_000 });

// Wait for the suite's own summary rather than sleeping: a fixed sleep is how verify.mjs once stopped
// reporting a whole suite and still read as green.
const summary = new RegExp(`${SUITE}: (\\d+)/(\\d+)`);
const deadline = Date.now() + 120_000;
while (Date.now() < deadline && !lines.some((l) => summary.test(l))) {
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 2000));
await browser.close();
server.close();

const m = lines.find((l) => summary.test(l))?.match(summary);
const allFailures = lines.filter((l) => l.includes(`${SUITE} FAIL`));
const known = allFailures.filter((l) => KNOWN_ENGINE_GAPS.some((k) => l.includes(k)));
const failures = allFailures.filter((l) => !known.includes(l));

console.log(`\n--- ${SUITE} in WebKit ---`);
console.log(m ? `${m[1]}/${m[2]} passed` : 'the suite never reported');
for (const f of failures) console.log(`   ${f.replace(/^.*\[playground\] /, '')}`);
for (const k of known) console.log(`   KNOWN (TASK-467): ${k.replace(/^.*\[playground\] /, '')}`);
for (const e of pageErrors) console.log(`   page error: ${e}`);

const problems = [];
if (!m) problems.push('the suite never reported — it did not run, which is not the same as passing');
else if (Number(m[2]) - Number(m[1]) - known.length > 0) {
  problems.push(`${Number(m[2]) - Number(m[1]) - known.length} failing (excluding ${known.length} filed engine gap(s))`);
}
if (pageErrors.length) problems.push(`${pageErrors.length} page error(s)`);

if (problems.length) {
  console.error('\nFAIL');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nPASS — ${SUITE} is green in WebKit`);
