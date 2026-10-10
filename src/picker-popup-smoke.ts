// TASK-496 — the four picker triggers announce their popup, and the popup is usable from the keyboard:
// opening moves focus in, every action keeps it there (the panels rebuild with innerHTML), picking or
// Escape returns it to the trigger. Before, focus stayed on a read-only field that announced no popup,
// fell to <body> after the first action inside a calendar, and fell again when a pick closed the panel.
//
// ⚠ Focus is page-global and every smoke suite runs concurrently in this page, so another suite can move
// focus whenever this one awaits. The components act synchronously, so each focus assertion below runs
// in the same task as the action it checks, with no await in between. An await there would make these
// checks flaky, and they would fail as though the component were broken.
import 'birko-web-components/inputs';
import { focusable } from './smoke-focus';

const settle = () => new Promise((r) => setTimeout(r, 40));

interface Picker {
  tag: string;
  trigger: string;
  /** Pick a value synchronously from the keyboard (focus already in the panel). */
  pick: (sr: ShadowRoot) => void;
  /** A control whose action rebuilds the panel, to prove focus survives it. */
  rebuild?: string;
}

/** Activate a control the way Enter on a focused button does: focus, then click. Synchronous. */
function activate(sr: ShadowRoot, selector: string) {
  const el = sr.querySelector<HTMLElement>(selector);
  el?.focus();
  el?.click();
}

function press(el: Element | null, key: string) {
  el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
}

const PICKERS: Picker[] = [
  { tag: 'b-date-picker', trigger: '.dp-input', rebuild: '[data-nav="next-month"]:not([disabled])',
    pick: (sr) => activate(sr, '.dp-panel [data-date]:not(.disabled)') },
  { tag: 'b-datetime-picker', trigger: '.dp-input', rebuild: '[data-nav="next-month"]:not([disabled])',
    pick: (sr) => { activate(sr, '.dp-panel [data-date]:not(.disabled)'); activate(sr, '[data-nav="set"]'); } },
  { tag: 'b-date-range-picker', trigger: '.drp-input-start', rebuild: '[data-nav="next-month"]:not([disabled])',
    pick: (sr) => {
      // The first date rebuilds the panel; the second is picked from what is there now.
      const first = [...sr.querySelectorAll<HTMLElement>('.drp-panel [data-date]:not(.disabled)')][3];
      first?.focus(); first?.click();
      const second = [...sr.querySelectorAll<HTMLElement>('.drp-panel [data-date]:not(.disabled)')][8];
      second?.focus(); second?.click();
    } },
  { tag: 'b-time', trigger: '.tp-input',
    pick: (sr) => activate(sr, '[data-action="now"]') },
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:30rem;padding:1rem;background:#fff;z-index:99999';
  document.body.prepend(host);

  for (const p of PICKERS) {
    try {
      host.innerHTML = `<${p.tag} label="When"></${p.tag}>`;
      await settle();
      const el = host.querySelector(p.tag)!;
      const sr = el.shadowRoot!;
      const trigger = sr.querySelector<HTMLInputElement>(p.trigger)!;
      const panelId = trigger.getAttribute('aria-controls') ?? '';
      const panel = () => (panelId ? sr.getElementById(panelId) : null) as HTMLElement | null;
      const inPanel = () => !!panel()?.contains(sr.activeElement);
      const expanded = () => trigger.getAttribute('aria-expanded');

      // ── ARIA ──
      check(`${p.tag}: the trigger is a combobox`, trigger.getAttribute('role') === 'combobox');
      check(`${p.tag}: ...that announces a dialog popup`, trigger.getAttribute('aria-haspopup') === 'dialog');
      check(`${p.tag}: ...collapsed while closed`, expanded() === 'false');
      check(`${p.tag}: aria-controls resolves to a named dialog`,
        panel()?.getAttribute('role') === 'dialog' && !!panel()?.getAttribute('aria-label'));

      // ── Not readonly (NVDA read readonly as "combo edit", no expanded state), yet typing is refused ──
      check(`${p.tag}: the trigger is not readonly`, !trigger.readOnly);
      const before = trigger.value;
      const bi = new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true, composed: true });
      trigger.dispatchEvent(bi);
      check(`${p.tag}: typing is refused (beforeinput cancelled)`, bi.defaultPrevented);
      // IME composition cannot be cancelled; whatever lands is put back.
      trigger.value = 'typed';
      trigger.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      check(`${p.tag}: text that lands anyway is restored`, trigger.value === before);

      // ── Keyboard open (assertions in the same task as the key) ──
      check(`${p.tag}: precondition — the trigger can take focus (no modal holding the page)`, await focusable(sr, trigger));
      press(trigger, 'Enter');
      check(`${p.tag}: Enter expands it`, expanded() === 'true');
      check(`${p.tag}: ...and moves focus into the panel`, inPanel());

      // ── An action that rebuilds the panel keeps focus on the same control ──
      if (p.rebuild && panel()) {
        activate(sr, `#${CSS.escape(panelId)} ${p.rebuild}`);
        const now = sr.activeElement as HTMLElement | null;
        check(`${p.tag}: focus survives the panel rebuilding (${now?.dataset?.nav ?? now?.tagName ?? 'lost'})`,
          inPanel() && !!now?.matches(p.rebuild));
      }

      // ── Escape inside the panel ──
      press(sr.activeElement, 'Escape');
      check(`${p.tag}: Escape in the panel collapses it`, expanded() === 'false');
      check(`${p.tag}: ...and returns focus to the trigger`, sr.activeElement === trigger);
      await settle();

      // ── Pick from the keyboard ──
      check(`${p.tag}: the trigger is still the same attached element before picking`,
        trigger.isConnected && sr.querySelector(p.trigger) === trigger);
      await focusable(sr, trigger);
      press(trigger, 'Enter');
      p.pick(sr);
      check(`${p.tag}: picking sets a value`, !!trigger.value);
      check(`${p.tag}: ...collapses the popup`, expanded() === 'false');
      check(`${p.tag}: ...and puts focus back on the trigger (${(sr.activeElement as HTMLElement | null)?.className || 'body'})`,
        sr.activeElement === trigger);
      await settle();
    } catch (e) {
      check(`${p.tag}: unexpected throw: ${(e as Error).message}`, false);
    }
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  // gallery-smoke opens a modal (which light-dismisses popovers and makes the page inert); it waits for this.
  (window as unknown as { __pickerPopupSmokeDone?: boolean }).__pickerPopupSmokeDone = true;
  console.log(`[playground] picker-popup-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] picker-popup-smoke ${r}`);
})();
