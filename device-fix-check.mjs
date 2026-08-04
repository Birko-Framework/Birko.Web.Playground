// Headless check for the 2026-08-01 device-pass fixes in Birko.Web.Components. These three defects are
// invisible to `verify.mjs`, which loads one 800x600 light-theme page: the overlay-width bug only shows
// below the modal's max-width cap (i.e. on a phone), the tint-token bug only shows under `data-theme=dark`,
// and the date-picker rule only applies under a coarse pointer. So this script drives the same built
// playground bundle three ways — narrow viewport, dark theme, emulated coarse pointer — and asserts the
// geometry / contrast numbers directly.
//
// Run: node build.js && node device-fix-check.mjs      (exit 0 = all pass, 1 = a FAIL)
// Every assertion carries its measured number in the NAME, so a failure says what it saw, not just "false".
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
const url = `http://localhost:${port}/`;

const results = [];
const check = (name, ok) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// Measures one overlay component: renders it, opens it, and reports the <dialog> box, the styled card
// inside it, and the footer's last button. `card` is `.modal` for b-modal and `.dialog` for b-confirm-dialog.
const measure = (tag, cardSel, attrs = {}) => page.evaluate(async (tag, cardSel, attrs) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (tag === 'b-modal') {
    el.innerHTML = '<p>body</p><div slot="footer"><b-button>OK</b-button></div>';
  }
  document.body.appendChild(el);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // b-modal opens with open(); b-confirm-dialog with show(), which returns the answer promise (left
  // unawaited on purpose — _answer() resolves it when we close below).
  if (typeof el.open === 'function') el.open();
  else if (typeof el.show === 'function') void el.show();
  await new Promise((r) => setTimeout(r, 120));

  const dlg = el.shadowRoot.querySelector('dialog');
  const card = el.shadowRoot.querySelector(cardSel);
  const btns = [...el.shadowRoot.querySelectorAll('.overlay-footer b-button, .overlay-footer ::slotted(*)')];
  const slotted = el.querySelectorAll('[slot="footer"] b-button');
  const lastBtn = btns.at(-1) ?? [...slotted].at(-1) ?? null;
  const r = (n) => Math.round(n * 100) / 100;
  const box = (n) => n && { left: r(n.left), right: r(n.right), width: r(n.width) };
  const out = {
    open: dlg.open,
    dialog: box(dlg.getBoundingClientRect()),
    card: box(card.getBoundingClientRect()),
    btn: box(lastBtn?.getBoundingClientRect()),
    viewport: window.innerWidth,
  };
  dlg.close();
  el.remove();
  return out;
}, tag, cardSel, attrs);

const load = async (theme, viewport) => {
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await new Promise((r) => setTimeout(r, 200));
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  if (applied !== theme) throw new Error(`theme did not apply: wanted ${theme}, got ${applied}`);
};

// ── 1. Overlay width at phone size ────────────────────────────────────────────────────────────────────
// The bug: `width: 90%` resolved against the <dialog>, which the UA sizes as fit-content — i.e. against a
// box derived from this very child. The card came out ~10% narrower than the dialog around it and pinned
// to its left, so a right-aligned footer read as "the buttons are shifted left". Only visible below the
// max-width cap, hence 390px (iPhone-class). The invariant that holds at every width: the card FILLS the
// dialog it lives in (dialogBase gives <dialog> border:none/padding:0, so they must measure equal).
await load('light', { width: 390, height: 844, deviceScaleFactor: 2 });

for (const [label, tag, sel, attrs] of [
  ['b-modal (default)', 'b-modal', '.modal', { title: 'T' }],
  ['b-modal size=sm', 'b-modal', '.modal', { title: 'T', size: 'sm' }],
  ['b-modal size=lg', 'b-modal', '.modal', { title: 'T', size: 'lg' }],
  ['b-confirm-dialog', 'b-confirm-dialog', '.dialog', { title: 'Delete item?', message: 'This action cannot be undone.', variant: 'danger' }],
]) {
  const m = await measure(tag, sel, attrs);
  const dw = m.dialog.width, cw = m.card.width;
  // Guard first: a dialog that never opened measures 0x0, and every geometry assertion below would pass
  // vacuously (0 === 0, "not left-pinned", "fits the viewport"). Caught exactly that when b-confirm-dialog
  // was driven with open() instead of show().
  check(`${label} @390px: the dialog actually opened (open=${m.open}, ${cw}px wide)`, m.open === true && cw > 0);
  check(`${label} @390px: card fills its <dialog> (card ${cw}px / dialog ${dw}px)`, Math.abs(cw - dw) <= 1);
  check(`${label} @390px: card is not left-pinned inside the dialog (left offset ${Math.round(m.card.left - m.dialog.left)}px)`,
    Math.abs(m.card.left - m.dialog.left) <= 1);
  check(`${label} @390px: card fits the 390px viewport (${cw}px, left ${m.card.left}px)`,
    m.card.left >= -0.5 && m.card.right <= 390.5);
  check(`${label} @390px: dialog is centred (left ${m.dialog.left}px vs right gap ${Math.round(390 - m.dialog.right)}px)`,
    Math.abs(m.dialog.left - (390 - m.dialog.right)) <= 2);
  if (m.btn) {
    // The reported symptom, measured: the footer's last button ended ~39px short of the dialog's right edge.
    // Once the card fills the dialog, that gap is just the footer's own padding.
    const gap = Math.round(m.dialog.right - m.btn.right);
    check(`${label} @390px: footer button sits one padding step from the dialog edge (gap ${gap}px)`, gap <= 30);
  }
}

// ── 2. Desktop back-compat ────────────────────────────────────────────────────────────────────────────
// Above the cap, `90vw` is clamped by max-width to exactly the same px the old `90%` produced, so an
// existing desktop consumer must measure unchanged. Tokens resolve against a 14px root (the Birko reset
// sets html{font-size:--b-text-base}), so 32.5rem = 455px and 23.75rem = 332.5px — asserted against a live
// probe rather than those literals, so a rescale of the token can't silently break this.
await load('light', { width: 1280, height: 900 });
const probe = (expr) => page.evaluate((e) => {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;visibility:hidden;width:${e}`;
  document.body.appendChild(d);
  const w = Math.round(d.getBoundingClientRect().width * 100) / 100;
  d.remove();
  return w;
}, expr);

const capModal = await probe('var(--b-modal-width, 32.5rem)');
const capSm = await probe('var(--b-modal-width-sm, 23.75rem)');
const dm = await measure('b-modal', '.modal', { title: 'T' });
const dc = await measure('b-confirm-dialog', '.dialog', { title: 'T', message: 'm' });
check(`b-modal @1280px opened (open=${dm.open}, ${dm.card.width}px)`, dm.open === true && dm.card.width > 0);
check(`b-confirm-dialog @1280px opened (open=${dc.open}, ${dc.card.width}px)`, dc.open === true && dc.card.width > 0);
check(`b-modal @1280px still caps at --b-modal-width (${dm.card.width}px = ${capModal}px)`, Math.abs(dm.card.width - capModal) <= 1);
check(`b-confirm-dialog @1280px still caps at --b-modal-width-sm (${dc.card.width}px = ${capSm}px)`, Math.abs(dc.card.width - capSm) <= 1);
check(`b-modal @1280px: card still fills its dialog (${dm.card.width}px / ${dm.dialog.width}px)`, Math.abs(dm.card.width - dm.dialog.width) <= 1);
check(`b-confirm-dialog @1280px: card still fills its dialog (${dc.card.width}px / ${dc.dialog.width}px)`, Math.abs(dc.card.width - dc.dialog.width) <= 1);

// ── 3. Dark-theme tint tokens ─────────────────────────────────────────────────────────────────────────
// dark.css darkened only --b-color-primary-light; the other four kept their light-page pastel while
// --b-text flipped to near-white. Two different pairs ride on these tokens and BOTH have to hold, which is
// why the fix is asserted from the token side rather than from one component:
//   --b-text on the tint            → b-stale-banner, b-sync-status, b-markdown-editor  (the reported bug)
//   --b-color-{name} on the tint    → b-badge, b-stat                                    (must not regress)
const contrastReport = await page.evaluate(async (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  await new Promise((r) => setTimeout(r, 120));
  const cs = getComputedStyle(document.documentElement);
  const rgb = (v) => {
    const d = document.createElement('div');
    d.style.color = v; document.body.appendChild(d);
    const m = getComputedStyle(d).color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    d.remove();
    return m;
  };
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const text = cs.getPropertyValue('--b-text').trim();
  const out = {};
  for (const name of ['success', 'warning', 'danger', 'info', 'primary']) {
    const tint = cs.getPropertyValue(`--b-color-${name}-light`).trim();
    const strong = cs.getPropertyValue(`--b-color-${name}`).trim();
    out[name] = { tint, onText: ratio(text, tint), onStrong: ratio(strong, tint) };
  }
  return out;
}, 'dark');

for (const [name, m] of Object.entries(contrastReport)) {
  // AA for body text is 4.5:1. b-stale-banner's warning line is small text on the tint.
  check(`dark: --b-text on --b-color-${name}-light is AA-legible (${m.onText}:1 on ${m.tint})`, m.onText >= 4.5);
  // b-badge/b-stat paint the strong colour on the same tint — darkening the tint must help this pair too,
  // not trade one contrast for the other. 3:1 is the AA bar for the large/bold badge text.
  check(`dark: --b-color-${name} on --b-color-${name}-light stays readable for b-badge/b-stat (${m.onStrong}:1)`, m.onStrong >= 3);
}

// A rendered consumer, so this is not purely a token-arithmetic result: b-stale-banner is the component
// the device pass actually reported as unreadable.
const banner = await page.evaluate(async () => {
  const el = document.createElement('b-stale-banner');
  el.setAttribute('stale', '');
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 200));
  const inner = el.shadowRoot?.querySelector('.banner, [class*="banner"]') ?? el.shadowRoot?.firstElementChild;
  const s = inner ? getComputedStyle(inner) : null;
  const out = s ? { bg: s.backgroundColor, color: s.color } : null;
  el.remove();
  return out;
});
if (banner) {
  const bannerRatio = await page.evaluate(({ bg, color }) => {
    const parse = (v) => v.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = (c) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [x, y] = [lum(parse(color)), lum(parse(bg))].sort((p, q) => q - p);
    return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  }, banner);
  check(`dark: b-stale-banner text on its own background is AA-legible (${bannerRatio}:1, ${banner.color} on ${banner.bg})`, bannerRatio >= 4.5);
}

// Light theme must be untouched — the fix is dark-only.
const lightReport = await page.evaluate(async () => {
  document.documentElement.setAttribute('data-theme', 'light');
  await new Promise((r) => setTimeout(r, 120));
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(['success', 'warning', 'danger', 'info'].map((n) => [n, cs.getPropertyValue(`--b-color-${n}-light`).trim()]));
});
check(`light theme tints unchanged (${JSON.stringify(lightReport)})`,
  lightReport.success === '#dcfce7' && lightReport.warning === '#fef3c7' && lightReport.danger === '#fee2e2' && lightReport.info === '#cffafe');

// ── 4. b-date-picker under a coarse pointer ───────────────────────────────────────────────────────────
// The iOS spill itself is NOT reproducible here — Safari's platform-rendered date control is what carries
// the intrinsic width, and Chromium/desktop-WebKit do not. What IS testable is the part that can regress
// silently: the rule must apply under a coarse pointer and must NOT reach a fine one (desktop keeps its
// calendar affordance, which -webkit-appearance:none strips).
// How the pointer is emulated: puppeteer's emulateMediaFeatures() whitelists only prefers-color-scheme /
// prefers-reduced-motion / color-gamut / forced-colors and THROWS on `pointer`. Raw
// Emulation.setEmulatedMedia works, but silently no-ops unless `media` is also sent — which is how the
// first version of this check reported a desktop `appearance: auto` as a failed fix. Viewport-level touch
// emulation is what a phone actually is, so use that and assert the media query really flipped.
const emulatePointer = (value) => page.setViewport(
  value === 'coarse'
    ? { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { width: 1280, height: 900, hasTouch: false, isMobile: false });

await emulatePointer('coarse');
const coarseApplied = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
await emulatePointer('fine');
const fineApplied = await page.evaluate(() => matchMedia('(pointer: fine)').matches);
// Without this guard the two checks below would both read a desktop pointer and the coarse one would
// look like a broken fix rather than a broken harness.
check(`pointer emulation actually flips the media query (coarse=${coarseApplied}, fine=${fineApplied})`,
  coarseApplied && fineApplied);

const appearanceUnder = async (pointer) => {
  await emulatePointer(pointer);
  return page.evaluate(async () => {
    const el = document.createElement('b-date-picker');
    el.setAttribute('native', '');
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 200));
    const input = el.shadowRoot?.querySelector('input[type="date"]');
    const out = input ? getComputedStyle(input).webkitAppearance || getComputedStyle(input).appearance : 'NO-NATIVE-INPUT';
    el.remove();
    return out;
  });
};
const coarse = await appearanceUnder('coarse');
const fine = await appearanceUnder('fine');
check(`b-date-picker native input drops the UA appearance under pointer:coarse (got "${coarse}")`, coarse === 'none');
check(`b-date-picker keeps the desktop calendar affordance under pointer:fine (got "${fine}")`, fine !== 'none' && fine !== 'NO-NATIVE-INPUT');

// Same rule, measured where the report came from: a native date field inside a size="sm" modal on a phone.
await load('light', { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const inModal = await page.evaluate(async () => {
  const modal = document.createElement('b-modal');
  modal.setAttribute('title', 'Mark exception');
  modal.setAttribute('size', 'sm');
  modal.innerHTML = '<b-date-picker native label="Date"></b-date-picker>';
  document.body.appendChild(modal);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  modal.open();
  await new Promise((r) => setTimeout(r, 250));
  const card = modal.shadowRoot.querySelector('.modal').getBoundingClientRect();
  const dp = modal.querySelector('b-date-picker');
  const input = dp.shadowRoot?.querySelector('input');
  const ib = input.getBoundingClientRect();
  const out = { card: Math.round(card.width), cardRight: Math.round(card.right), inputRight: Math.round(ib.right), input: Math.round(ib.width) };
  modal.close();
  modal.remove();
  return out;
});
check(`b-date-picker native field stays inside a size=sm modal on a phone (input ${inModal.input}px right ${inModal.inputRight}px vs card ${inModal.card}px right ${inModal.cardRight}px)`,
  inModal.inputRight <= inModal.cardRight);

// ── 5. Shadow depth across every theme ────────────────────────────────────────────────────────────────
// Why here: a shadow token is only wrong *in a theme*, which is exactly the blind spot this file exists
// for. dark/neon/inverse had never overridden --b-shadow-xl, so the level every overlay uses (b-modal,
// b-drawer, b-confirm-dialog, b-command-palette, b-tour) fell through to the light :root value and landed
// WEAKER than --b-shadow four rungs below it. Nothing could see that: --b-shadow-* has no DOM, no ARIA and
// no geometry, so verify.mjs and every in-page smoke suite are blind to it by construction. It has to be
// measured off rendered pixels.
//
// The metric is INK — the delta summed down the column below the box — not the single deepest pixel. Peak
// alone punishes a wide, soft shadow: finstat's xl is deliberately broad and diffuse (0 20px 70px -25px)
// and reads as the theme's deepest level to the eye while measuring a lower peak than its md. Ink credits
// spread and depth together, and it is the ordering, not the absolute number, that is the contract.
const THEMES = ['light', 'dark', 'neon', 'finstat', 'inverse'];
const LEVELS = ['--b-shadow-sm', '--b-shadow', '--b-shadow-md', '--b-shadow-lg', '--b-shadow-xl'];
const SW = 140, SH = 90, GAP = 90, TOP = 80;

// Screenshot the page, then hand the PNG back INTO it and read pixels off a canvas. Real CSS rendering
// rather than a re-implementation of the blur, and no PNG decoder needed on the node side.
const sampleStage = async () => {
  const uri = `data:image/png;base64,${await page.screenshot({ encoding: 'base64' })}`;
  return page.evaluate(async (uri, LEVELS, SW, SH, GAP, TOP) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = uri; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    const bg = px(10, img.height - 10);                       // stage background, clear of every swatch
    const dev = (p) => Math.max(...p.map((c, k) => Math.abs(c - bg[k])));

    const levels = LEVELS.map((lv, i) => {
      const cx = Math.round(GAP + i * (SW + GAP) + SW / 2);
      let ink = 0, peak = 0;
      for (let dy = 1; dy <= 60; dy++) { const d = dev(px(cx, TOP + SH + dy)); ink += d; peak = Math.max(peak, d); }
      return { lv, ink, peak };
    });
    // What separates a real b-card from the page: surface step, 1px border and shadow together. dark and
    // inverse set --b-bg-secondary == --b-bg-elevated, so their cards have NO surface step and the border
    // carries the whole job — measured as legible as light's, but nothing else would notice if it stopped.
    const card = document.querySelector('#shadow-stage b-card')?.getBoundingClientRect();
    let edge = 0;
    if (card) for (let dy = -6; dy <= 6; dy++) edge = Math.max(edge, dev(px(card.x + card.width / 2, card.y + dy)));
    return { levels, edge, stageBg: `rgb(${bg.join(',')})` };
  }, uri, LEVELS, SW, SH, GAP, TOP);
};

await load('light', { width: 1200, height: 460, deviceScaleFactor: 1 });
await page.evaluate((LEVELS, SW, SH, GAP, TOP) => {
  const stage = document.createElement('div');
  stage.id = 'shadow-stage';
  stage.style.cssText = 'position:fixed; inset:0; z-index:99999; background:var(--b-bg-secondary);';
  stage.innerHTML = LEVELS.map((lv, i) => `
    <div style="position:absolute; left:${GAP + i * (SW + GAP)}px; top:${TOP}px; width:${SW}px; height:${SH}px;
      background:var(--b-bg); border-radius:8px; box-shadow:var(${lv});"></div>`).join('')
    + `<b-card style="position:absolute; left:${GAP}px; top:${TOP + SH + 120}px; width:260px;">card</b-card>`;
  document.body.appendChild(stage);
}, LEVELS, SW, SH, GAP, TOP);
await new Promise((r) => setTimeout(r, 400));

// Precondition: a stage that never rendered measures 0 everywhere and every ordering assertion below
// would pass vacuously — the same trap as a <dialog> that never opened.
const lightStage = await sampleStage();
check(`premise: the shadow stage renders and the levels are non-zero (ink ${lightStage.levels.map((l) => l.ink).join('/')} on ${lightStage.stageBg})`,
  lightStage.levels.every((l) => l.ink > 0));

for (const theme of THEMES) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await new Promise((r) => setTimeout(r, 200));
  const { levels, edge } = await sampleStage();

  const inks = levels.map((l) => l.ink);
  const inverted = levels.slice(1).map((l, i) => (l.ink < levels[i].ink ? `${levels[i].lv} > ${l.lv}` : null)).filter(Boolean);
  check(`${theme}: shadow scale rises sm -> xl (ink ${inks.join(' < ')})${inverted.length ? ` — INVERTED: ${inverted.join(', ')}` : ''}`,
    inverted.length === 0);

  // xl is the overlay level; on a dark page it is the one that silently fell back to light's value.
  const xl = levels.at(-1);
  check(`${theme}: --b-shadow-xl is the deepest level and reads (ink ${xl.ink}, peak ${xl.peak})`,
    xl.ink === Math.max(...inks) && xl.peak >= 6);

  check(`${theme}: a b-card is delineated from the page (edge delta ${edge})`, edge >= 8);
}

// ── 6. b-segmented clears the 44 x 44 touch floor under a coarse pointer ──────────────────────────────
// The floor itself is a framework fix, but for its first two months its ONLY regression test lived in a
// consumer repo (Reps' layout-invariants family E). That is backwards for a shared component, and it cost
// something concrete: the consumer's suite runs the `sk` locale, where every label is long enough to clear
// the floor from padding alone, so the height-only version of the fix stayed green there while the English
// "All" pill shipped at 36.6 x 44. This group measures the component directly, with a deliberately
// SHORT label, so the framework can no longer ship the regression and wait for a consumer to notice.
//
// Both axes, because that is the criterion (Apple HIG / WCAG 2.1 SC 2.5.5 — not SC 2.5.8, which is 24 x 24).
const segmentedUnder = async (pointer) => {
  await emulatePointer(pointer);
  return page.evaluate(async () => {
    const el = document.createElement('b-segmented');
    document.body.appendChild(el);
    // "All" / "On" is the shape that fails: a short label leaves a padding-derived width under the floor.
    el.setOptions([{ value: 'all', label: 'All' }, { value: 'thirty', label: '30 days' }]);
    el.setAttribute('value', 'all');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const bs = [...el.shadowRoot.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.textContent.trim(), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    });
    el.remove();
    return bs;
  });
};
const segCoarse = await segmentedUnder('coarse');
const segFine = await segmentedUnder('fine');
const worst = (bs, k) => Math.min(...bs.map((b) => b[k]));
check(`b-segmented clears 44px in HEIGHT under pointer:coarse (narrowest ${worst(segCoarse, 'h')}px of ${segCoarse.map((b) => b.h).join('/')})`,
  worst(segCoarse, 'h') >= 43.5);
check(`b-segmented clears 44px in WIDTH under pointer:coarse — the "All" case (narrowest ${worst(segCoarse, 'w')}px of ${segCoarse.map((b) => `${b.label}=${b.w}`).join(' ')})`,
  worst(segCoarse, 'w') >= 43.5);
// The other half of the policy: this is a coarse-pointer rule, so a desktop toolbar must stay dense. A fix
// that floored every pointer type would pass the two checks above and silently re-size every consumer.
check(`b-segmented stays dense under pointer:fine — the rule is coarse-only (${segFine.map((b) => `${b.w}x${b.h}`).join(' ')})`,
  worst(segFine, 'h') < 43.5);

check(`no page errors during the run (${pageErrors.length})`, pageErrors.length === 0);
if (pageErrors.length) for (const e of pageErrors) console.log(`  PAGEERROR: ${e}`);

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== device-fix-check: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) { for (const f of failed) console.log(`  FAIL ${f.name}`); process.exit(1); }
