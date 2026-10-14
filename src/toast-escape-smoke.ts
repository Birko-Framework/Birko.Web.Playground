// TASK-597 — b-toast rendered its `message` and `icon` as HTML, and pages pass it text other people wrote: server
// error details, tenant names, module labels. Both are text now. Each payload goes through show() and notify(); the
// text must be visible as written, nothing in it may be parsed into an element, and no handler in it may run.
import { toast, type BToastItem } from 'birko-web-components/feedback';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAYLOADS = [
  '<img src=x onerror="window.__toastPwned=1">',
  '<script>window.__toastPwned=1<\/script>',
  '<b>bold</b> & "quoted"',
];

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const w = window as unknown as { __toastPwned?: number };
  w.__toastPwned = 0;
  const shown: BToastItem[] = [];

  try {
    for (const payload of PAYLOADS) {
      for (const [path, item] of [
        ['show', toast.show(payload, 'error', 60_000)],
        ['notify', toast.notify(payload, { icon: payload, durationMs: 60_000 })],
      ] as const) {
        shown.push(item);
        const root = item.shadowRoot!;
        const msg = root.querySelector('.msg');
        check(`${path}: the message is shown as written (${JSON.stringify(payload)})`, msg?.textContent === payload);
        check(`${path}: nothing in the message is parsed (${JSON.stringify(payload)})`, msg?.children.length === 0);
        if (path === 'notify') {
          const icon = root.querySelector('.icon');
          check(`notify: the icon is shown as written (${JSON.stringify(payload)})`, icon?.textContent === payload);
          check(`notify: nothing in the icon is parsed (${JSON.stringify(payload)})`, icon?.children.length === 0);
        }
        check(`${path}: no img or script reached the toast (${JSON.stringify(payload)})`, !root.querySelector('img, script, b'));
      }
    }
    {
      const item = toast.notify('Plain', { icon: '🔔', durationMs: 60_000 });
      shown.push(item);
      check('a glyph icon still renders', item.shadowRoot!.querySelector('.icon')?.textContent === '🔔');
    }
    await sleep(200); // an onerror would have fired by now
    check(`no payload ran (__toastPwned = ${w.__toastPwned})`, w.__toastPwned === 0);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  shown.forEach((t) => t.remove());

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] toast-escape-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] toast-escape-smoke ${r}`);
})();
