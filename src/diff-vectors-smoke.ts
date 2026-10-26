// Birko TASK-769 — the shared diff vectors (Birko.Web.Core/src/diff/diff-vectors.json, copied by build.js) run against
// the web engine. The same file is run by the C# port in Birko.Xaml.Core, so a vector failing here is a web engine bug
// (file it), never a reason to bend the vector. Function-valued options are named ops in the file; see its `about`.
import {
  diffJson, formatJsonPath, matchJsonPath, xmlToLines, xmlToTree,
  type JsonDiffNode, type JsonDiffOptions, type JsonPathSegment, type XmlTreeOptions,
} from 'birko-web-core';

interface VectorNormalizer { path: string; op: 'trim' | 'lower' | 'replace' | 'round'; pattern?: string; with?: string; digits?: number }
interface VectorOptions { ignore?: string[]; normalize?: VectorNormalizer[]; arrays?: { path: string; match?: 'index' | 'unordered'; key?: string }[] }
interface Vectors {
  paths: {
    format: { segments: JsonPathSegment[]; expect: string }[];
    match: { pattern: string; segments: JsonPathSegment[]; expect: boolean }[];
    malformed: string[];
  };
  json: { name: string; a: unknown; b: unknown; options?: VectorOptions; expect: { equal: boolean; summary: unknown; changes: unknown[]; tree: [string, string][] } }[];
  xmlTree: { name: string; xml: string; options?: XmlTreeOptions; expect: unknown }[];
  xmlLines: { name: string; xml: string; options?: XmlTreeOptions; expect: unknown }[];
}

const op = (n: VectorNormalizer) => (v: unknown): unknown => {
  switch (n.op) {
    case 'trim': return typeof v === 'string' ? v.trim() : v;
    case 'lower': return typeof v === 'string' ? v.toLowerCase() : v;
    // A function replacer, so `with` is literal (no `$&` substitutions), as the C# runner reads it.
    case 'replace': return typeof v === 'string' ? v.replace(new RegExp(n.pattern ?? '', 'g'), () => n.with ?? '') : v;
    case 'round': { const f = 10 ** (n.digits ?? 0); return typeof v === 'number' ? Math.round(v * f) / f : v; }
    default: throw new Error(`unknown normalizer op: ${String(n.op)}`);
  }
};

const options = (o: VectorOptions | undefined): JsonDiffOptions => ({
  ignore: o?.ignore,
  normalize: o?.normalize?.map((n) => ({ path: n.path, normalize: op(n) })),
  arrays: o?.arrays,
});

const flatten = (node: JsonDiffNode, out: [string, string][] = []) => {
  out.push([node.status, node.path]);
  node.children?.forEach((c) => flatten(c, out));
  return out;
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const eq = (name: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    check(ok ? name : `${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, ok);
  };

  try {
    const v = await (await fetch('__diff-vectors.json')).json() as Vectors;
    check(`vectors loaded (${v.json.length} json, ${v.xmlTree.length} xmlTree, ${v.xmlLines.length} xmlLines)`,
      v.json.length > 0 && v.xmlTree.length > 0 && v.xmlLines.length > 0);

    for (const f of v.paths.format) eq(`format ${JSON.stringify(f.segments)}`, formatJsonPath(f.segments), f.expect);
    for (const m of v.paths.match) eq(`match ${JSON.stringify(m.pattern)} ${JSON.stringify(m.segments)}`, matchJsonPath(m.pattern, m.segments), m.expect);
    for (const p of v.paths.malformed) {
      let threw = false;
      try { diffJson({}, {}, { ignore: [p] }); } catch { threw = true; }
      check(`malformed pattern throws: ${p}`, threw);
    }

    for (const c of v.json) {
      try {
        const r = diffJson(c.a, c.b, options(c.options));
        // Only the keys the vector names: segments are derivable from the path, and JSON drops undefined.
        const changes = r.changes.map((x) => {
          const o: Record<string, unknown> = { kind: x.kind, path: x.path };
          if (x.oldPath !== undefined) o.oldPath = x.oldPath;
          if ('oldValue' in x) o.oldValue = x.oldValue;
          if ('newValue' in x) o.newValue = x.newValue;
          return o;
        });
        eq(`json "${c.name}"`, { equal: r.equal, summary: r.summary, changes, tree: flatten(r.tree) }, c.expect);
      } catch (e) {
        check(`json "${c.name}" threw: ${(e as Error).message}`, false);
      }
    }

    for (const c of v.xmlTree) eq(`xmlTree "${c.name}"`, xmlToTree(c.xml, c.options), c.expect);
    for (const c of v.xmlLines) eq(`xmlLines "${c.name}"`, xmlToLines(c.xml, c.options), c.expect);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] diff-vectors-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] diff-vectors-smoke ${r}`);
})();
