// Birko TASK-122 (FEATURE-015 D13 / D14, STORY-056) — a ribbon group with mixed command sizes: Word's Clipboard, a big
// Paste beside Cut / Copy / Format Painter stacked in one column. Checked in Chrome with real keys:
//   - the group draws its step's resolved layout: Paste spans the three rows, the others stack in one column beside it;
//   - a uniform group beside it renders as before (its size class, no per-command size classes);
//   - every command keeps its accessible name at every step, icon-only Small included;
//   - the arrow keys reach every command of the mixed group in visual order;
//   - it degrades through its steps (Small: Paste Medium, the rest icons) to Popup, whose flyout holds every command;
//   - a sweep across the widths down and back up resolves the same at each width (no oscillation).
//
//   node build.js && node ribbon-mixed-check.mjs        (exit 1 on any FAIL)
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXPLORE = process.argv.includes('--explore');

const browser = await launchBrowser({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  const warnings = [];
  page.on('console', (m) => { if (m.type().startsWith('warn')) warnings.push(m.text()); });
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(`${base}?kb=1`, { waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'mx-host';
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:var(--b-bg);padding:8px';
    host.innerHTML = '<button id="mx-before">before</button><b-ribbon id="mx" expanded pinned style="width:900px"></b-ribbon>';
    document.body.prepend(host);
    await customElements.whenDefined('b-ribbon');
    document.getElementById('mx').setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', icon: '📋', scalingPriority: 0, items: [
        { id: 'paste', label: 'Paste', icon: '📋', size: 'large' },
        { id: 'cut', label: 'Cut', icon: '✂️' },
        { id: 'copy', label: 'Copy', icon: '⧉' },
        { id: 'format', label: 'Format Painter', icon: '🖌' },
      ] },
      { id: 'font', label: 'Font', icon: 'A', scalingPriority: 10, items: [
        { id: 'bold', label: 'Bold', icon: 'B' }, { id: 'italic', label: 'Italic', icon: 'I' }, { id: 'under', label: 'Underline', icon: 'U' },
        { id: 'grow', label: 'Grow Font', icon: 'A+' }, { id: 'shrink', label: 'Shrink Font', icon: 'A-' }, { id: 'clear', label: 'Clear Formatting', icon: 'Ax' },
      ] },
    ] }]);
  });

  const setWidth = async (w) => {
    await page.evaluate((w) => { document.getElementById('mx').style.width = `${w}px`; }, w);
    await sleep(160);
  };
  const state = () => page.evaluate(() => {
    const sr = document.getElementById('mx').shadowRoot;
    const g = sr.querySelector('.ribbon-panel-inner > [data-group="clip"]');
    const f = sr.querySelector('.ribbon-panel-inner > [data-group="font"]');
    const box = (id) => {
      const el = g?.querySelector(`[data-item="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const label = el.querySelector('.ribbon-item-label');
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: el.className,
        name: el.getAttribute('aria-label'), labelShown: !!label && getComputedStyle(label).display !== 'none' };
    };
    const items = g?.querySelector('.ribbon-group-items')?.getBoundingClientRect();
    return {
      clip: g ? { cls: g.className, step: g.getAttribute('data-step'), itemsH: items ? Math.round(items.height) : 0 } : null,
      font: f ? { cls: f.className, sized: [...f.querySelectorAll('*')].filter((e) => /item-(large|medium|small)/.test(e.className)).length } : null,
      paste: box('paste'), cut: box('cut'), copy: box('copy'), format: box('format'),
    };
  });
  const brief = (s) => `${s.clip?.step ?? s.clip?.cls}|${s.font?.cls}`;

  if (EXPLORE) {
    for (const w of [900, 700, 600, 500, 400, 330, 300, 260, 230, 200]) { await setWidth(w); console.log(w, JSON.stringify(await state())); }
  }

  // ── Wide: the Medium step's layout ──
  await setWidth(900);
  let s = await state();
  check(`wide: the mixed group draws its step without a size class (${s.clip?.cls}, step ${s.clip?.step})`,
    /\bmixed\b/.test(s.clip?.cls ?? '') && !/\bsize-/.test(s.clip?.cls ?? '') && s.clip?.step === 'medium');
  check(`wide: Paste is Large and spans the three rows (${s.paste?.h}px of ${s.clip?.itemsH}px)`,
    /item-large/.test(s.paste?.cls ?? '') && s.paste.h >= s.clip.itemsH - 2);
  check(`wide: Cut, Copy and Format Painter stack in one column right of Paste (x ${s.cut?.x} / ${s.copy?.x} / ${s.format?.x}, Paste ${s.paste?.x})`,
    s.cut.x === s.copy.x && s.copy.x === s.format.x && s.cut.x > s.paste.x && s.cut.y < s.copy.y && s.copy.y < s.format.y);
  check(`wide: they are Medium, with their labels (${s.cut?.cls})`,
    ['cut', 'copy', 'format'].every((k) => /item-medium/.test(s[k].cls) && s[k].labelShown));
  check(`wide: a uniform group renders as before (${s.font?.cls}, ${s.font?.sized} sized commands)`,
    /\bsize-(large|medium|small)\b/.test(s.font?.cls ?? '') && !/\bmixed\b/.test(s.font?.cls ?? '') && s.font?.sized === 0);
  check('wide: every command is named by its label',
    s.paste.name === 'Paste' && s.cut.name === 'Cut' && s.copy.name === 'Copy' && s.format.name === 'Format Painter');

  // ── Keyboard: the arrows reach every command in visual order ──
  const focused = () => page.evaluate(() => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el?.getAttribute?.('data-item') ?? el?.tagName ?? 'none';
  });
  // Office's order: Right from the big Paste goes to the TOP of the next column (Cut), not its middle row; Down walks
  // the column; Left from any of them goes back to Paste.
  await page.evaluate(() => document.getElementById('mx').shadowRoot.querySelector('[data-group="clip"] [data-item="paste"]').focus());
  const visited = [await focused()];
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft']) { await page.keyboard.press(key); visited.push(await focused()); }
  check(`keyboard: Right, Down, Down, Left walk Paste > Cut > Copy > Format Painter > Paste (${visited.join(' > ')})`,
    visited.join(' > ') === 'paste > cut > copy > format > paste');

  // ── Degrading: find the widths where the group reaches Small and Popup ──
  // TASK-123: at every width nothing is cut off by the panel's ceiling (--b-ribbon-panel-height). Symbio once sized
  // it for the full-width look; it was perfect at 1600px and clipped two links at 1024px.
  const clipped = () => page.evaluate(() => {
    const sr = document.getElementById('mx').shadowRoot;
    const panel = sr.querySelector('.ribbon-panel').getBoundingClientRect();
    // A group stretches to the panel, so its box never sticks out: what overflows is its content. Popovers are not drawn.
    return [...sr.querySelectorAll('.ribbon-panel-inner > .ribbon-group')]
      .filter((g) => [...g.querySelectorAll('*')].some((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > panel.bottom + 0.5; }))
      .map((g) => g.dataset.group ?? '?');
  });
  const sweep = [];
  const clipAt = [];
  for (let w = 900; w >= 200; w -= 10) {
    await setWidth(w);
    sweep.push([w, await state()]);
    const c = await clipped();
    if (c.length) clipAt.push(`${w}px: ${c.join(',')}`);
  }
  check(`no group is cut off by the panel at any width from 900 to 200px (${clipAt.slice(0, 3).join('; ') || 'none'})`, clipAt.length === 0);
  const required = await page.evaluate(() => document.getElementById('mx').requiredPanelHeight);
  const ceiling = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('mx').shadowRoot.querySelector('.ribbon-panel')).maxHeight));
  check(`requiredPanelHeight is reported and the default ceiling covers it (${required}px needed, ${ceiling}px ceiling)`,
    typeof required === 'number' && required > 0 && ceiling >= required);
  const small = sweep.find(([, st]) => st.clip?.step === 'small');
  const popup = sweep.find(([, st]) => /size-popup/.test(st.clip?.cls ?? ''));
  check(`degrades to its Small step (at ${small?.[0]}px)`, !!small);
  if (small) {
    const st = small[1];
    check(`Small step: Paste is Medium with its label, the rest are icons (${st.paste?.cls} / ${st.cut?.cls})`,
      /item-medium/.test(st.paste.cls) && st.paste.labelShown && ['cut', 'copy', 'format'].every((k) => /item-small/.test(st[k].cls) && !st[k].labelShown));
    check('Small step: icon-only commands keep their names',
      st.cut.name === 'Cut' && st.copy.name === 'Copy' && st.format.name === 'Format Painter');
  }
  check(`collapses to Popup last (at ${popup?.[0]}px)`, !!popup && (!small || popup[0] < small[0]));
  if (popup) {
    await setWidth(popup[0]);
    const flyout = await page.evaluate(async () => {
      const sr = document.getElementById('mx').shadowRoot;
      sr.querySelector('[data-chunk="clip"]').click();
      await new Promise((r) => setTimeout(r, 100));
      return [...sr.querySelectorAll('[data-group="clip"] .ribbon-flyout [data-item]')].map((b) => b.getAttribute('aria-label'));
    });
    check(`Popup is lossless: its flyout holds every command (${flyout.join(', ')})`,
      JSON.stringify(flyout) === JSON.stringify(['Paste', 'Cut', 'Copy', 'Format Painter']));
    await page.keyboard.press('Escape');
  }

  // ── No oscillation: back up, each width resolves as it did on the way down ──
  let same = 'same';
  for (let i = sweep.length - 1; i >= 0; i--) {
    const [w, down] = sweep[i];
    await setWidth(w);
    if (brief(await state()) !== brief(down)) { same = `differs at ${w}px`; break; }
  }
  check(`a sweep down and back up resolves the same at every width (${same})`, same === 'same');

  // ── TASK-123: a ceiling below what the ribbon can reach is reported, and the clipping it causes is caught ──
  check('no panel-height warning with the default ceiling', !warnings.some((w) => w.includes('--b-ribbon-panel-height')));
  await page.evaluate(() => document.getElementById('mx').style.setProperty('--b-ribbon-panel-height', '60px'));
  await setWidth(880);
  await setWidth(900);
  await sleep(400); // the panel animates its height
  const warned = warnings.find((w) => w.includes('--b-ribbon-panel-height is 60px'));
  check(`a 60px ceiling is warned about, naming the height needed ("${warned?.slice(0, 90) ?? 'no warning'}")`, !!warned);
  check(`…and the clipping it causes is caught (${(await clipped()).join(', ') || 'none'})`, (await clipped()).length > 0);
  await page.evaluate(() => document.getElementById('mx').style.removeProperty('--b-ribbon-panel-height'));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`ribbon-mixed-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
