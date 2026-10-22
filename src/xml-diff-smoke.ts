// TASK-727 — xmlToTree / xmlToLines (birko-web-core) and b-json-diff format="xml": the FinStat-shaped sample converts to
// the tree the tester verified, options replace the .NET defaults, text beside attributes is kept, lines carry the
// tree paths, and the side-by-side view shows the original XML with the changed lines marked.
import { diffJson, xmlToLines, xmlToTree } from 'birko-web-core';
import type { BJsonDiff } from 'birko-web-components';

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) =>
    check(`${name} (${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
  const tick = () => new Promise((r) => setTimeout(r, 20));

  const SAMPLE = '<EliteCZResult xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Ico>00177041</Ico><UnReliability xsi:nil="true"/>'
    + '<VatGroupMember>false</VatGroupMember><Contacts><Contact><Contact>326817192</Contact><Type>Phone</Type></Contact></Contacts>'
    + '<OtherCzNaces><CzNace><Code>29</Code><Text>Výroba</Text></CzNace><CzNace><Code>30</Code><Text>Jiné</Text></CzNace></OtherCzNaces>'
    + '<Offices><Count>3</Count></Offices><TurnoverCategory><Year>2024</Year></TurnoverCategory><Subjects><string>A</string></Subjects><Empty/></EliteCZResult>';

  try {
    // ── 1. xmlToTree: the tester's sample and its verified output ──
    eq('FinStat-shaped sample', xmlToTree(SAMPLE), {
      Ico: '00177041', UnReliability: null, VatGroupMember: 'false', Contacts: [{ Contact: '326817192', Type: 'Phone' }],
      OtherCzNaces: [{ Code: '29', Text: 'Výroba' }, { Code: '30', Text: 'Jiné' }], Offices: { Count: '3' },
      TurnoverCategory: { Year: '2024' }, Subjects: ['A'], Empty: '',
    });
    eq('HTML is not XML', xmlToTree('<!DOCTYPE html><html><body>x'), null);
    eq('plain text is not XML', xmlToTree('not xml at all'), null);
    eq('a repeated name among other fields keeps every occurrence', xmlToTree('<r><A>1</A><B>x</B><A>2</A></r>'), { A: ['1', '2'], B: 'x' });
    eq('attributes as @name, xmlns dropped', xmlToTree('<r xmlns="urn:x" xmlns:p="urn:p"><i id="7" p:k="v"><n>a</n></i><z>0</z></r>'), { i: { '@id': '7', '@k': 'v', n: 'a' }, z: '0' });
    eq('text beside an attribute is kept', xmlToTree('<r><Price currency="EUR">10</Price></r>'), { Price: { '@currency': 'EUR', '#text': '10' } });
    eq('mixed text and elements keep the text', xmlToTree('<r><p>Hello <b>x</b></p><z>0</z></r>'), { p: { '#text': 'Hello', b: 'x' }, z: '0' });
    eq('CDATA is text', xmlToTree('<r><c><![CDATA[a<b]]></c></r>'), { c: 'a<b' });
    eq('an attribute on a list keeps it an object', xmlToTree('<r><L n="2"><I>1</I><I>2</I></L><z>0</z></r>'), { L: { '@n': '2', I: ['1', '2'] }, z: '0' });
    eq('a root with one complex child is a list, as any element', xmlToTree('<r><i><n>a</n></i></r>'), [{ n: 'a' }]);

    // ── 2. Options ──
    eq('simpleItemNames: [] keeps <string> a field', xmlToTree('<r><S><string>A</string></S><z>0</z></r>', { simpleItemNames: [] }), { S: { string: 'A' }, z: '0' });
    eq('simpleItemNames adds a name', xmlToTree('<r><S><Item>A</Item></S><z>0</z></r>', { simpleItemNames: ['Item'] }), { S: ['A'], z: '0' });
    eq('nilAsNull: false', xmlToTree(SAMPLE, { nilAsNull: false }) && (xmlToTree(SAMPLE, { nilAsNull: false }) as Record<string, unknown>).UnReliability, '');
    eq('attributePrefix and textKey', xmlToTree('<r><P c="E">1</P></r>', { attributePrefix: '$', textKey: '_' }), { P: { $c: 'E', _: '1' } });

    // ── 3. xmlToLines ──
    {
      const lines = xmlToLines(`<?xml version="1.0" encoding="utf-8"?>${SAMPLE}`)!;
      const find = (t: string) => lines.find((l) => l.text.trim() === t);
      eq('declaration kept as the first line', lines[0].text, '<?xml version="1.0" encoding="utf-8"?>');
      eq('root opens at column 0', lines[1].text.startsWith('<EliteCZResult'), true);
      eq('a text element is one line with its path', find('<Ico>00177041</Ico>')?.paths, [['Ico']]);
      eq('a list item child has its index in the path', lines.filter((l) => l.text.trim() === '<Code>30</Code>')[0]?.paths, [['OtherCzNaces', 1, 'Code']]);
      eq('indent is two spaces per level (Code is three below the root)', lines.find((l) => l.text.trim() === '<Code>29</Code>')!.text.indexOf('<'), 6);
      eq('lines are not XML returns null', xmlToLines('<a><b></a>'), null);
      const rep = xmlToLines('<r><A>1</A><B>x</B><A>2</A></r>')!;
      eq('a repeated name has its occurrence index', rep.map((l) => l.paths), [[[]], [['A', 0]], [['B']], [['A', 1]], [[]]]);
      const attr = xmlToLines('<r><P c="E &amp; &quot;">1</P><!-- note --></r>')!;
      eq('attributes and text get their own paths', attr[1].paths, [['P'], ['P', '@c'], ['P', '#text']]);
      eq('attribute values are re-escaped', attr[1].text.trim(), '<P c="E &amp; &quot;">1</P>');
      eq('comments are kept and belong to no path', [attr[2].text.trim(), attr[2].paths], ['<!-- note -->', []]);
    }

    // ── 4. Diff of two XML bodies ──
    {
      const b = SAMPLE.replace('<Count>3</Count>', '<Count>4</Count>').replace('<Empty/>', '<Empty/><New>1</New>');
      const r = diffJson(xmlToTree(SAMPLE), xmlToTree(b));
      eq('XML vs XML diff by path', r.changes.map((c) => `${c.kind} ${c.path}`), ['changed Offices.Count', 'added New']);
    }

    // ── 5. b-json-diff format="xml" ──
    {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:900px;opacity:0;pointer-events:none;';
      document.body.appendChild(host);
      const el = document.createElement('b-json-diff') as BJsonDiff;
      el.setAttribute('format', 'xml');
      el.setAttribute('label-a', 'production');
      el.setAttribute('label-b', 'localhost');
      host.appendChild(el);
      await tick();
      const root = el.shadowRoot!;
      const b = SAMPLE.replace('<Count>3</Count>', '<Count>4</Count>').replace('<Empty/>', '<Empty/><New><X>1</X></New>');
      el.setData(SAMPLE, b);
      await tick();
      eq('the default title follows the format', root.querySelector('.title')?.textContent, 'XML diff');
      eq('format="xml" diffs the trees', el.getResult()?.changes.map((c) => `${c.kind} ${c.path}`), ['changed Offices.Count', 'added New']);
      check('tree view renders the changes', root.querySelectorAll('.node.st-changed').length === 1 && root.querySelectorAll('.node.st-added').length === 1);
      el.setAttribute('view', 'split');
      await tick();
      const panes = [...root.querySelectorAll('.pane')];
      const lineTexts = (p: Element, sel = '.line') => [...p.querySelectorAll(sel)].map((l) => l.textContent!.trim());
      check(`split shows the original XML (${lineTexts(panes[0])[0]})`, lineTexts(panes[0])[0]?.startsWith('<EliteCZResult') === true);
      eq('A marks the changed value', lineTexts(panes[0], '.line.mk-changed'), ['<Count>3</Count>']);
      eq('B marks the changed value', lineTexts(panes[1], '.line.mk-changed'), ['<Count>4</Count>']);
      eq('B marks the whole added element', lineTexts(panes[1], '.line.mk-added'), ['<New>', '<X>1</X>', '</New>']);
      check('pane ids are distinct', panes[0].querySelector('h3')!.id !== panes[1].querySelector('h3')!.id);
      el.setData('<r><a>1</a><z>0</z></r>', '<r><a><x>1</x><y>2</y></a><z>0</z></r>');
      await tick();
      const p2 = [...root.querySelectorAll('.pane')];
      eq('a value replaced by an element marks the lines inside it', lineTexts(p2[1], '.line.mk-changed'), ['<a>', '<x>1</x>', '<y>2</y>', '</a>']);

      el.setData(SAMPLE, b);
      el.setOptions({ ignore: ['Offices'], xml: { simpleItemNames: [] } });
      await tick();
      eq('setOptions passes xml options and diff options', el.getResult()?.changes.map((c) => `${c.kind} ${c.path}`), ['added New']);
      el.setOptions({});

      el.setData('{"a":1}', '<!DOCTYPE html><html><body>x');
      await tick();
      const errs = [...root.querySelectorAll('.error')].map((e) => e.textContent);
      eq('a non-XML side says so, per side', errs, ['production: not XML', 'localhost: not XML']);
      check('the raw text of a non-XML side is shown', lineTexts(panes[0]).length === 0 && !!root.querySelector('.pane pre')?.textContent?.includes('{"a":1}'));
      el.setAttribute('format', 'json');
      await tick();
      eq('switching format re-reads the bodies', [...root.querySelectorAll('.error')].map((e) => e.textContent?.split(':')[0]), ['localhost']);
      el.removeAttribute('format');
      el.setData('<r><a>1</a></r>', '<r><a>2</a></r>');
      await tick();
      check('without format a string is JSON', root.querySelectorAll('.error').length === 2);
      el.setAttribute('format', 'xml');
      el.setData('<r><a>&lt;img src=x onerror="window.__xmlDiffXss=1"&gt;</a></r>', '<r><a>2</a></r>');
      await tick();
      check('XML text is shown as text', !root.querySelector('img') && !(globalThis as { __xmlDiffXss?: number }).__xmlDiffXss);
      host.remove();
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] xml-diff-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] xml-diff-smoke ${r}`);
})();
