// Birko TASK-784 — the tree views keep a value's spaces: b-object-tree (and b-json-viewer through it), b-xml-viewer and
// b-json-diff's tree render values in spans, where the browser would fold "a     b" into "a b". Measured by width, so
// the check fails if the spaces are folded whatever the CSS says.
export {};

type Data = HTMLElement & { setData(...v: unknown[]): void };
type Source = HTMLElement & { setSource(xml: string): void };

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const SPACED = 'a     b';
  const SINGLE = 'a b';

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:900px;opacity:0;pointer-events:none;';
  document.body.appendChild(host);
  const mount = (tag: string) => host.appendChild(document.createElement(tag));
  const width = (root: ShadowRoot | null | undefined, sel: string) =>
    Math.round(root?.querySelector(sel)?.getBoundingClientRect().width ?? 0);
  // Five spaces against one: four more space widths, in a monospace or proportional font alike.
  const wider = (name: string, spaced: number, single: number) =>
    check(`${name} keeps its spaces (${spaced}px vs ${single}px)`, single > 0 && spaced > single);

  try {
    // ── b-object-tree: a string value ──
    {
      const a = mount('b-object-tree') as Data;
      const b = mount('b-object-tree') as Data;
      a.setData({ v: SPACED });
      b.setData({ v: SINGLE });
      await tick();
      wider('b-object-tree string', width(a.shadowRoot, '.val-string'), width(b.shadowRoot, '.val-string'));
      check('b-object-tree text is unchanged', a.shadowRoot?.querySelector('.val-string')?.textContent === `"${SPACED}"`);
    }

    // ── b-xml-viewer: element text, attribute value, comment ──
    {
      const xml = (t: string) => `<r k="${t}"><x>${t}</x><y>${t}<z/></y><!--${t}--></r>`;
      const a = mount('b-xml-viewer') as Source;
      const b = mount('b-xml-viewer') as Source;
      a.setSource(xml(SPACED));
      b.setSource(xml(SINGLE));
      await tick();
      wider('b-xml-viewer inline text', width(a.shadowRoot, '.row .text'), width(b.shadowRoot, '.row .text'));
      wider('b-xml-viewer attribute value', width(a.shadowRoot, '.attr-value'), width(b.shadowRoot, '.attr-value'));
      wider('b-xml-viewer comment', width(a.shadowRoot, '.comment'), width(b.shadowRoot, '.comment'));
      const c = mount('b-xml-viewer') as Source;
      c.setSource('<r>\n    pretty\n  </r>');
      await tick();
      const text = c.shadowRoot?.querySelector('.text');
      check(`pretty-printed text is trimmed, one line (${JSON.stringify(text?.textContent)})`,
        text?.textContent === 'pretty' && (text?.getClientRects().length ?? 0) === 1);
    }

    // ── b-json-diff tree: equal, changed and added values ──
    {
      const a = mount('b-json-diff') as Data;
      const b = mount('b-json-diff') as Data;
      a.setData({ e: SPACED, c: 'x', gone: 1 }, { e: SPACED, c: SPACED, add: SPACED });
      b.setData({ e: SINGLE, c: 'x', gone: 1 }, { e: SINGLE, c: SINGLE, add: SINGLE });
      await tick();
      wider('b-json-diff equal value', width(a.shadowRoot, '.st-equal .val'), width(b.shadowRoot, '.st-equal .val'));
      wider('b-json-diff changed value', width(a.shadowRoot, '.st-changed ins'), width(b.shadowRoot, '.st-changed ins'));
      wider('b-json-diff added value', width(a.shadowRoot, '.st-added ins'), width(b.shadowRoot, '.st-added ins'));
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] whitespace-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] whitespace-smoke ${r}`);
})();
