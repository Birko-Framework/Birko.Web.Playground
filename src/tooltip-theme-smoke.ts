// TASK-738 — b-tooltip's light theme and structured content (heading, text, shortcut as text), the old text-only form
// unchanged, and b-ribbon's commands described for screen readers with no native title left. Opens no popover: the
// anchored mode (showFor) and the ribbon's hover timing are checked in keyboard-check.mjs, which has the page alone.
import 'birko-web-components/layout';
import 'birko-web-components/nav';
import type { RibbonGroup } from 'birko-web-components';

type Ribbon = HTMLElement & { setTabs(t: { id: string; label: string; groups: RibbonGroup[] }[]): void };
const settle = (ms = 60) => new Promise<void>((r) => setTimeout(() => requestAnimationFrame(() => r()), ms));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(host);

  try {
    // ── 1. b-tooltip: the old form is unchanged ──
    host.innerHTML = '<b-tooltip id="t-old" text="Hello <b>world</b>"><span>x</span></b-tooltip>';
    await settle();
    const old = host.querySelector('#t-old')!.shadowRoot!;
    check('text alone keeps its markup (existing callers)', old.querySelector('.tip b')?.textContent === 'world');
    check('and stays the dark theme by default', getComputedStyle(old.querySelector('.tip')!).backgroundColor !== getComputedStyle(document.body).backgroundColor);

    // ── 2. Structured content, as text ──
    host.innerHTML = '<b-tooltip id="t-new" theme="light" heading="Paste <i>x</i>" shortcut="Ctrl+V" text="Add <img src=x onerror=&quot;window.__tipXss=1&quot;> content"><span>x</span></b-tooltip>';
    await settle();
    const t = host.querySelector('#t-new')!.shadowRoot!;
    check(`heading and shortcut render (${t.querySelector('.tip-title')?.textContent?.trim()})`, t.querySelector('.tip-heading')?.textContent === 'Paste <i>x</i>' && t.querySelector('.tip-shortcut')?.textContent === '(Ctrl+V)');
    check('in the structured form every part is text', !t.querySelector('.tip i, .tip img') && !(globalThis as { __tipXss?: number }).__tipXss);
    check('the trigger is described by the tip', t.querySelector('.trigger')?.getAttribute('aria-describedby') === t.querySelector('.tip')?.id);
    const light = getComputedStyle(t.querySelector('.tip')!);
    const probe = document.createElement('div');
    probe.style.background = 'var(--b-bg-elevated)';
    host.appendChild(probe);
    check(`theme="light" uses the elevated surface (${light.backgroundColor})`, light.backgroundColor === getComputedStyle(probe).backgroundColor);
    probe.remove();

    // ── 3. b-ribbon: described commands, no native title ──
    const el = document.createElement('b-ribbon') as Ribbon;
    el.style.width = '900px';
    el.setAttribute('expanded', '');
    el.setAttribute('pinned', '');
    host.appendChild(el);
    await settle(20);
    el.setTabs([{ id: 'home', label: 'Home', groups: [
      { id: 'clip', label: 'Clipboard', items: [
        { id: 'paste', label: 'Paste', icon: '📋', description: 'Add content from the clipboard.', shortcut: 'Ctrl+V', split: true, menu: [{ id: 'pt', label: 'Paste as text' }] },
        { id: 'cut', label: 'Cut', icon: '✂️' },
      ] },
    ] }]);
    await settle(160);
    const sr = el.shadowRoot!;
    const paste = sr.querySelector<HTMLElement>('.ribbon-split-main')!;
    check(`a described command carries aria-description (${paste.getAttribute('aria-description')})`, paste.getAttribute('aria-description') === 'Add content from the clipboard.');
    check(`and aria-keyshortcuts (${paste.getAttribute('aria-keyshortcuts')})`, paste.getAttribute('aria-keyshortcuts') === 'Ctrl+V');
    check('no command, ▾ part or folded group has a native title', !sr.querySelector('.ribbon-panel .ribbon-item[title], .ribbon-split-arrow[title], .ribbon-chunk[title]'));
    const tip = sr.querySelector('b-tooltip.ribbon-tooltip');
    check('the ribbon holds one shared b-tooltip, light by default, hidden from the tree', !!tip && tip.getAttribute('theme') === 'light' && tip.getAttribute('aria-hidden') === 'true' && sr.querySelectorAll('b-tooltip').length === 1);
    el.setAttribute('tooltip-theme', 'dark');
    await settle();
    check('tooltip-theme switches it', sr.querySelector('b-tooltip.ribbon-tooltip')?.getAttribute('theme') === 'dark');
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] tooltip-theme-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] tooltip-theme-smoke ${r}`);
})();
