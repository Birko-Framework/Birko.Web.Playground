// TASK-725 — diffJson (birko-web-core): changes by path, ignore patterns, normalizers, array matching by index / key /
// unordered, summary and tree; b-json-diff: tree with statuses, only-changes, side-by-side marks, labels, events.
import { diffJson, formatJsonPath, matchJsonPath, type JsonDiffNode } from 'birko-web-core';
import type { BJsonDiff } from 'birko-web-components';
import { focusable } from './smoke-focus.js';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) =>
    check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const brief = (r: ReturnType<typeof diffJson>) => r.changes.map((c) => `${c.kind} ${c.path}`);

  try {
    // ── 1. Paths and patterns ──
    eq('formatJsonPath', formatJsonPath(['Items', 2, 'Ref', 'a.b', 0]), 'Items[2].Ref["a.b"][0]');
    eq('root path is empty', formatJsonPath([]), '');
    check('* is one segment', matchJsonPath('*.Url', ['A', 'Url']) && !matchJsonPath('*.Url', ['A', 'B', 'Url']) && !matchJsonPath('*.Url', ['Url']));
    check('** is any depth, including none', matchJsonPath('**.Url', ['Url']) && matchJsonPath('**.Url', ['A', 0, 'Url']));
    check('[*] is an index only', matchJsonPath('Items[*].Ref', ['Items', 3, 'Ref']) && !matchJsonPath('Items[*].Ref', ['Items', 'x', 'Ref']));
    check('[n] and quoted keys', matchJsonPath('a[1]["x.y"]', ['a', 1, 'x.y']) && !matchJsonPath('a[1]', ['a', 2]));
    let threw = false;
    try { diffJson({}, {}, { ignore: ['Items[x'] }); } catch { threw = true; }
    check('a malformed pattern throws', threw);

    // ── 2. Basic kinds ──
    {
      const r = diffJson({ a: 1, b: 'x', c: { d: true }, gone: 1 }, { a: 1, b: 'y', c: { d: true, e: null }, new: [1] });
      eq('changed / added / removed by path', brief(r), ['changed b', 'added c.e', 'added new', 'removed gone']);
      eq('summary', r.summary, { added: 2, removed: 1, changed: 1, total: 4 });
      const b = r.changes.find((c) => c.path === 'b')!;
      check('a change carries old and new value', b.oldValue === 'x' && b.newValue === 'y');
      const gone = r.changes.find((c) => c.path === 'gone')!;
      check('a removal has no newValue key', !('newValue' in gone) && gone.oldValue === 1);
      check('equal is false', !r.equal);
      check('identical values are equal', diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }).equal);
      eq('type change is one change', brief(diffJson({ a: { x: 1 } }, { a: [1] })), ['changed a']);
      eq('null vs missing differs', brief(diffJson({ a: null }, {})), ['removed a']);
      eq('a root primitive', brief(diffJson(1, 2)), ['changed ']);
      eq('an added object counts once', diffJson({}, { o: { a: 1, b: { c: 2 } } }).summary.total, 1);
    }

    // ── 3. Arrays by index (default) ──
    {
      const r = diffJson({ l: [1, 2, 3] }, { l: [1, 3] });
      eq('by index: a removal shifts', brief(r), ['changed l[1]', 'removed l[2]']);
    }

    // ── 4. Arrays by key ──
    {
      const a = { Items: [{ Id: 1, v: 1 }, { Id: 2, v: 2 }, { Id: 4, v: 4 }] };
      const b = { Items: [{ Id: 2, v: 2 }, { Id: 1, v: 9 }, { Id: 3, v: 3 }] };
      const r = diffJson(a, b, { arrays: [{ path: 'Items', key: 'Id' }] });
      eq('by key: reorder is not a change', brief(r), ['changed Items[1].v', 'added Items[2]', 'removed Items[2]']);
      eq('by key: side A path of a moved item', r.changes[0].oldPath, 'Items[0].v');
      const fn = diffJson(a, b, { arrays: [{ path: 'Items', key: (x) => (x as { Id: number }).Id }] });
      eq('by key function', brief(fn), brief(r));
      const dup = diffJson({ l: [{ k: 1, v: 'a' }, { k: 1, v: 'b' }] }, { l: [{ k: 1, v: 'a' }, { k: 1, v: 'c' }] }, { arrays: [{ path: 'l', key: 'k' }] });
      eq('duplicate keys pair in order', brief(dup), ['changed l[1].v']);
      const keyless = diffJson({ l: [{ k: 1 }, 'x'] }, { l: ['x', { k: 1 }] }, { arrays: [{ path: 'l', key: 'k' }] });
      check('keyless items pair unordered', keyless.equal);
    }

    // ── 5. Arrays unordered ──
    {
      const r = diffJson({ t: ['a', 'b', 'c'] }, { t: ['c', 'a', 'd'] }, { arrays: [{ path: 't', match: 'unordered' }] });
      eq('unordered: only the real difference', brief(r), ['added t[2]', 'removed t[1]']);
      const nested = diffJson({ x: { t: [{ a: 1 }, { a: 2 }] } }, { x: { t: [{ a: 2 }, { a: 1 }] } }, { arrays: [{ path: '**.t', match: 'unordered' }] });
      check('unordered objects by deep equality, pattern at depth', nested.equal);
      const idx = diffJson({ t: ['a', 'b'] }, { t: ['b', 'a'] }, { arrays: [{ path: 't', match: 'index' }] });
      eq('match: index is the default behaviour', idx.summary.changed, 2);
    }

    // ── 6. Ignore ──
    {
      const a = { Url: 'u1', Items: [{ Ref: 'r1', v: 1 }], Deep: { X: { Url: 'u' } } };
      const b = { Url: 'u2', Items: [{ Ref: 'r2', v: 1 }], Deep: { X: { Url: 'v' } } };
      const r = diffJson(a, b, { ignore: ['Url', 'Items[*].Ref', '**.Url'] });
      check('ignored paths are not changes', r.equal);
      const url = r.tree.children!.find((c) => c.path === 'Url')!;
      eq('ignored node status in the tree', url.status, 'ignored');
      eq('an ignored added key is not counted', diffJson({}, { Url: 1 }, { ignore: ['Url'] }).summary.total, 0);
      eq('ignore leaves the rest', brief(diffJson({ a: 1, Url: 1 }, { a: 2, Url: 2 }, { ignore: ['Url'] })), ['changed a']);
      // Ignore wins inside unordered matching, so items differing only in an ignored field pair up.
      const u = diffJson({ l: [{ id: 1, ts: 1 }, { id: 2, ts: 1 }] }, { l: [{ id: 2, ts: 9 }, { id: 1, ts: 8 }] },
        { ignore: ['l[*].ts'], arrays: [{ path: 'l', match: 'unordered' }] });
      check('unordered pairing honours ignore', u.equal);
    }

    // ── 7. Normalize ──
    {
      const stripRef = (v: unknown) => typeof v === 'string' ? v.replace(/[?&]ref=[^&]*/, '') : v;
      const a = { Link: 'https://x/a?ref=1', L: [{ Link: 'https://x/b?ref=2' }] };
      const b = { Link: 'https://x/a?ref=9', L: [{ Link: 'https://x/c?ref=2' }] };
      const r = diffJson(a, b, { normalize: [{ path: '**.Link', normalize: stripRef }] });
      eq('normalized values compare', brief(r), ['changed L[0].Link']);
      eq('the change reports the values as received', [r.changes[0].oldValue, r.changes[0].newValue], ['https://x/b?ref=2', 'https://x/c?ref=2']);
      const paths: string[] = [];
      diffJson({ a: 1 }, { a: 1 }, { normalize: [{ path: 'a', normalize: (v, p) => { paths.push(p); return v; } }] });
      eq('normalizer gets the path, once per side', paths, ['a', 'a']);
      const chain = diffJson({ n: ' A ' }, { n: 'a' }, { normalize: [{ path: 'n', normalize: (v) => String(v).trim() }, { path: 'n', normalize: (v) => String(v).toLowerCase() }] });
      check('normalizers chain in order', chain.equal);
      const num = diffJson({ p: 1.0001 }, { p: 1.0002 }, { normalize: [{ path: 'p', normalize: (v) => Math.round((v as number) * 100) / 100 }] });
      check('a numeric tolerance via normalize', num.equal);
    }

    // ── 8. Tree shape ──
    {
      const r = diffJson({ o: { a: 1, b: 2 }, s: 1 }, { o: { a: 1, b: 3 }, s: 1 });
      const o = r.tree.children!.find((c) => c.path === 'o')!;
      eq('container with a change is modified', o.status, 'modified');
      eq('modified counts below', o.summary.changed, 1);
      eq('unchanged sibling is equal', r.tree.children!.find((c) => c.path === 's')!.status, 'equal');
      const added = diffJson({}, { n: { x: 1 } }).tree.children![0];
      eq('an added container has added children', added.children!.map((c: JsonDiffNode) => c.status), ['added']);
    }

    // ── 9. b-json-diff ──
    {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:900px;opacity:0;pointer-events:none;';
      document.body.appendChild(host);
      const el = document.createElement('b-json-diff') as BJsonDiff;
      el.setAttribute('label-a', 'production');
      el.setAttribute('label-b', 'localhost');
      host.appendChild(el);
      await tick();
      const root = el.shadowRoot!;
      check('empty state before data', !!root.querySelector('.message'));
      const events: { equal: boolean; summary: { total: number } }[] = [];
      el.addEventListener('diff-computed', (e) => events.push((e as CustomEvent).detail));
      el.setOptions({ ignore: ['Url'], arrays: [{ path: 'Items', key: 'Id' }] });
      el.setData(
        '{"Name":"x","Url":"a","Same":{"k":1},"Items":[{"Id":1,"v":1},{"Id":2,"v":2}],"gone":true}',
        { Name: 'y', Url: 'b', Same: { k: 1 }, Items: [{ Id: 2, v: 2 }, { Id: 1, v: 5 }], extra: 1 },
      );
      await tick();
      eq('diff-computed fires with the summary', events.at(-1)?.summary.total, 4);
      eq('getResult()', el.getResult()?.summary, { added: 1, removed: 1, changed: 2, total: 4 });
      const summaryText = root.querySelector('.summary')?.textContent ?? '';
      check(`summary text (${summaryText})`, summaryText.includes('1 added') && summaryText.includes('2 changed'));
      const legend = root.querySelector('.legend')?.textContent ?? '';
      check(`legend names both sides (${legend.trim()})`, legend.includes('production') && legend.includes('localhost'));
      const status = (cls: string) => root.querySelectorAll(`.node.${cls}`).length;
      check('changed / added / removed rows', status('st-changed') >= 1 && status('st-added') === 1 && status('st-removed') === 1);
      check('modified container starts open', !!root.querySelector('.node.st-modified[aria-expanded="true"]'));
      check('unchanged container starts closed', !!root.querySelector('.node.st-equal[aria-expanded="false"]'));
      const nameRow = [...root.querySelectorAll('.node.st-changed')].find((n) => n.querySelector('.key')?.textContent === 'Name');
      check('a changed value shows old and new', nameRow?.querySelector('del')?.textContent === '"x"' && nameRow?.querySelector('ins')?.textContent === '"y"');
      check('status announced as text', !!nameRow?.querySelector('.sr-only')?.textContent?.includes('changed'));
      check('ignored row is shown in the full tree', status('st-ignored') === 1);

      // only-changes
      const only = root.querySelector<HTMLButtonElement>('.only-changes')!;
      let onlyEvent: unknown = null;
      el.addEventListener('only-changes-change', (e) => { onlyEvent = (e as CustomEvent).detail; });
      only.click();
      await tick();
      check('only-changes reflects to the attribute', el.hasAttribute('only-changes'));
      eq('only-changes-change event', onlyEvent, { onlyChanges: true });
      check('only-changes hides equal and ignored rows', status('st-equal') === 0 && status('st-ignored') === 0 && status('st-changed') >= 1);
      check('only-changes button pressed', root.querySelector('.only-changes')?.getAttribute('aria-pressed') === 'true');

      // toggle by keyboard
      const t = root.querySelector<HTMLElement>('.node.st-modified > .row .toggle')!;
      check('precondition: the toggle can take focus', await focusable(root, t));
      // No await between the key and the checks: a modal another suite opens would make the page inert.
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      check('Enter collapses a node', !!root.querySelector('.node.st-modified[aria-expanded="false"]'));
      check(`focus stays on the toggle (${root.activeElement?.className})`, root.activeElement?.classList.contains('toggle') === true);
      el.expandAll();
      await tick();
      check('expandAll opens every container', !root.querySelector('.node[aria-expanded="false"]'));

      // side by side
      let viewEvent: unknown = null;
      el.addEventListener('view-change', (e) => { viewEvent = (e as CustomEvent).detail; });
      root.querySelector<HTMLButtonElement>('.view-split')!.click();
      await tick();
      eq('view-change event', viewEvent, { view: 'split' });
      check('view reflects to the attribute', el.getAttribute('view') === 'split');
      const panes = [...root.querySelectorAll('.pane')];
      eq('two panes, labelled', panes.map((p) => p.querySelector('h3')?.textContent), ['production', 'localhost']);
      const marked = (p: Element, mk: string) => [...p.querySelectorAll(`.line.mk-${mk}`)].map((l) => l.textContent!.trim());
      check(`A marks the removed key (${marked(panes[0], 'removed')})`, marked(panes[0], 'removed').includes('"gone": true'));
      check(`B marks the added key (${marked(panes[1], 'added')})`, marked(panes[1], 'added').includes('"extra": 1'));
      // Items[1] on B pairs with Items[0] on A (by Id): A's changed line is v: 1 in the first item.
      check(`A marks a moved item at its own index (${marked(panes[0], 'changed')})`, marked(panes[0], 'changed').includes('"v": 1,') || marked(panes[0], 'changed').includes('"v": 1'));
      check(`B marks the changed value (${marked(panes[1], 'changed')})`, marked(panes[1], 'changed').some((l) => l.startsWith('"v": 5')));
      check('ignored lines are dimmed on both sides', marked(panes[0], 'ignored').length === 1 && marked(panes[1], 'ignored').length === 1);

      // parse error and escaping
      el.setData('{"a":', { a: '<img src=x onerror="window.__jsonDiffXss=1">' });
      await tick();
      const err = root.querySelector('.error')?.textContent ?? '';
      check(`a parse error names its side (${err})`, err.startsWith('production'));
      check('the raw text of a broken side is shown', !!root.querySelector('.pane pre')?.textContent?.includes('{"a":'));
      check('getResult() is null on a parse error', el.getResult() === null);
      el.setAttribute('view', 'tree');
      el.setData({ a: 1 }, { a: '<img src=x onerror="window.__jsonDiffXss=1">' });
      await tick();
      check('values are text, not markup', !root.querySelector('img') && !(globalThis as { __jsonDiffXss?: number }).__jsonDiffXss);
      el.setAttribute('label-a', '<b>A</b>');
      await tick();
      check('labels are text', !root.querySelector('.legend b'));
      el.setOptions({ ignore: ['['] });
      await tick();
      check('a bad option pattern is shown, not thrown', !!root.querySelector('.error') && el.getResult() === null);
      el.setOptions({});
      el.setData({ a: 1 }, { a: 1 });
      await tick();
      check(`equal bodies say so (${root.querySelector('.summary')?.textContent})`, root.querySelector('.summary')?.textContent === 'No differences');
      host.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] json-diff-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] json-diff-smoke ${r}`);
})();
