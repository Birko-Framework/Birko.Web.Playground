// Birko TASK-983 (found at TASK-982, reported by Reps) — the shared focus ring (--b-focus-ring / --b-focus-ring-danger)
// was a 3px wash at 15-30%: 1.2-2.0:1 against the page in every theme, under the 3:1 a focus indicator needs
// (WCAG 1.4.11 / 2.4.11). The user picked a 1px solid line with a tight soft glow ("G"). Checked in Chrome, in every
// shipped theme and in an inverse area on a light page:
//   - a real Tab onto a b-checkbox and into a b-input draws the ring token on the focused element;
//   - the ring's solid 1px line has 3:1 against the page background and the secondary surface, for both rings.
// Birko TASK-986 (asked for by DraCode): --b-focus-ring-inset / --b-focus-ring-danger-inset draw the same ring wholly inside
// the control, in every theme, with a 3:1 line.
//
//   node build.js && node focus-ring-check.mjs        (exit 1 on any FAIL)
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

const rgb = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/**
 * The first shadow of a computed box-shadow when it is an unblurred line (Chrome serialises it as
 * "rgb(37, 99, 235) 0px 0px 0px 1px"), or null: the old 3px wash also matches, so the contrast decides.
 */
function lineColour(shadow) {
  const parts = shadow.split(/,(?![^(]*\))/).map((s) => s.trim());
  const c = parts[0].match(/^(rgba?\([^)]*\))\s+0px\s+0px\s+0px\s+([\d.]+)px(\s+inset)?$/i);
  // `allInset`: every shadow in the list is inset (TASK-986's tokens); `noneInset`: none is (the outer ring).
  return c ? { colour: c[1], width: parseFloat(c[2]), allInset: parts.every((p) => /\binset$/.test(p)),
    noneInset: parts.every((p) => !/\binset$/.test(p)) } : null;
}

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!customElements.get('b-checkbox') && !!customElements.get('b-input'));

  const areas = [['light', null], ['dark', null], ['neon', null], ['finstat', null], ['light', 'inverse'], ['finstat', 'inverse']];
  for (const [theme, area] of areas) {
    const label = area ? `${theme} page, ${area} area` : theme;
    await page.evaluate((theme, area) => {
      document.documentElement.setAttribute('data-theme', theme);
      document.getElementById('fr')?.remove();
      const host = document.createElement('div');
      host.id = 'fr';
      if (area) host.setAttribute('data-theme', area);
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;padding:40px;background:var(--b-bg)';
      host.innerHTML = '<button id="fr-start">start</button><b-checkbox id="fr-cb" label="Remember me"></b-checkbox>'
        + '<b-input id="fr-in" label="Name"></b-input>';
      document.body.appendChild(host);
    }, theme, area);
    await sleep(80);
    await page.focus('#fr-start');

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('fr'));
      return { ring: cs.getPropertyValue('--b-focus-ring').trim(), danger: cs.getPropertyValue('--b-focus-ring-danger').trim(),
        ringIn: cs.getPropertyValue('--b-focus-ring-inset').trim(), dangerIn: cs.getPropertyValue('--b-focus-ring-danger-inset').trim(),
        bg: cs.backgroundColor, bg2: cs.getPropertyValue('--b-bg-secondary').trim() };
    });
    // Resolve the secondary surface to rgb through a probe element.
    const bg2 = await page.evaluate((v) => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c; }, tokens.bg2);
    const page0 = rgb(tokens.bg);
    const surf = over(rgb(bg2), page0);

    // TASK-986: the inset forms draw the same ring entirely inside the control (line and glow both inset).
    for (const [name, value, inside] of [['inset ring', tokens.ringIn, true], ['inset danger ring', tokens.dangerIn, true]]) {
      const resolved = await page.evaluate((v) => { const d = document.createElement('div'); d.style.boxShadow = v;
        document.getElementById('fr').appendChild(d); const s = getComputedStyle(d).boxShadow; d.remove(); return s; }, value);
      const line = value ? lineColour(resolved) : null;
      const vsPage = line ? ratio(over(rgb(line.colour), page0), page0) : 0, vsSurf = line ? ratio(over(rgb(line.colour), surf), surf) : 0;
      check(`${label}: the ${name} is defined and wholly inside (${line ? (line.allInset ? 'all inset' : 'NOT all inset') : 'missing'}), its line ${vsPage.toFixed(2)}:1 on the page and ${vsSurf.toFixed(2)}:1 on the secondary surface`,
        !!line && inside && line.allInset && line.width >= 1 && vsPage >= 3 && vsSurf >= 3);
    }

    for (const [name, value] of [['ring', tokens.ring], ['danger ring', tokens.danger]]) {
      const resolved = await page.evaluate((v) => { const d = document.createElement('div'); d.style.boxShadow = v;
        document.getElementById('fr').appendChild(d); const s = getComputedStyle(d).boxShadow; d.remove(); return s; }, value);
      const line = lineColour(resolved);
      const lc = line ? over(rgb(line.colour), page0) : null;
      const vsPage = lc ? ratio(lc, page0) : 0, vsSurf = lc ? ratio(over(rgb(line.colour), surf), surf) : 0;
      check(`${label}: the ${name} has a solid ${line?.width ?? '?'}px line, ${vsPage.toFixed(2)}:1 on the page and ${vsSurf.toFixed(2)}:1 on the secondary surface`,
        !!line && line.width >= 1 && vsPage >= 3 && vsSurf >= 3);
    }

    // Real keyboard focus: Tab onto the checkbox, then into the input; each draws the ring token.
    const focusedShadow = () => page.evaluate(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return { tag: el?.tagName, shadow: getComputedStyle(el).boxShadow };
    });
    const expected = await page.evaluate((v) => { const d = document.createElement('div'); d.style.boxShadow = v;
      document.getElementById('fr').appendChild(d); const s = getComputedStyle(d).boxShadow; d.remove(); return s; }, tokens.ring);
    await page.keyboard.press('Tab');
    await sleep(300);
    let f = await focusedShadow();
    check(`${label}: Tab onto b-checkbox draws the ring (${f.tag}${f.shadow === expected ? "" : ": " + f.shadow})`, f.shadow === expected);
    await page.keyboard.press('Tab');
    await sleep(300);
    f = await focusedShadow();
    check(`${label}: Tab into b-input draws the ring (${f.tag}${f.shadow === expected ? "" : ": " + f.shadow})`, f.shadow === expected);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`focus-ring-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
