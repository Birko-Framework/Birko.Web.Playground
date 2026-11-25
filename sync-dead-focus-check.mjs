// Birko TASK-982 (reported by Reps, found running TASK-977's keyboard step) — b-sync-status's "N not saved" button had
// a focus indicator too faint to see: `outline: none` plus a 3px box-shadow at 15% red (--b-focus-ring-danger), which
// on the pink chip in light mode is barely different from the unfocused button. Checked in Chrome in every shipped
// theme, on a chip bound to a fake source with a dead write: the focused button draws a solid ring at least 2px wide,
// and that ring has 3:1 contrast against both the chip it surrounds and the page behind it (WCAG 1.4.11 / 2.4.11).
//
//   node build.js && node sync-dead-focus-check.mjs        (exit 1 on any FAIL)
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

// Colour maths (WCAG relative luminance), with alpha composited over what lies beneath.
const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!customElements.get('b-sync-status'));

  for (const theme of ['light', 'dark', 'neon', 'finstat', 'inverse']) {
    const m = await page.evaluate(async (theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      document.getElementById('sdf')?.remove();
      const host = document.createElement('div');
      host.id = 'sdf';
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;padding:40px;background:var(--b-bg)';
      host.innerHTML = '<button id="sdf-before">before</button> <b-sync-status id="sdf-chip"></b-sync-status>';
      document.body.appendChild(host);
      const chip = document.getElementById('sdf-chip');
      chip.bind({ pendingCount: 0, deadCount: 1, onChange: () => () => {} });
      await new Promise((r) => setTimeout(r, 50));
      const btn = chip.shadowRoot.querySelector('button.dead');
      const read = () => { const cs = getComputedStyle(btn); return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor, shadow: cs.boxShadow, chipBg: cs.backgroundColor }; };
      const unfocused = read();
      return { unfocused, pageBg: getComputedStyle(host).backgroundColor, visible: !btn.hidden };
    }, theme);
    // Focus by a real Tab from the button before it, so :focus-visible applies as it does for a keyboard user.
    await page.focus('#sdf-before');
    await page.keyboard.press('Tab');
    await sleep(50);
    const f = await page.evaluate(() => {
      const btn = document.getElementById('sdf-chip').shadowRoot.querySelector('button.dead');
      const cs = getComputedStyle(btn);
      return { focused: btn.matches(':focus-visible'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, shadow: cs.boxShadow };
    });
    const pageBg = parse(m.pageBg);
    const chipBg = over(parse(m.unfocused.chipBg), pageBg);
    const ring = over(parse(f.outlineColor), pageBg);
    const solid = f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) >= 2;
    const vsChip = contrast(ring, chipBg), vsPage = contrast(ring, pageBg);
    check(`${theme}: Tab reaches the dead button and it is :focus-visible`, m.visible && f.focused);
    check(`${theme}: a solid ring ≥ 2px when focused (${f.outlineStyle} ${f.outlineWidth}; was ${m.unfocused.outlineStyle} unfocused)`, solid);
    check(`${theme}: the ring has 3:1 against the chip (${vsChip.toFixed(2)}:1) and the page (${vsPage.toFixed(2)}:1)`,
      solid && vsChip >= 3 && vsPage >= 3);
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`sync-dead-focus-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
