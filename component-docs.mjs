// The gallery's ⓘ tooltips: a per-tag reference parsed from Birko.Web.Components' own README.md and API.md.
//
// Parsed at build time and served to the bundle as the virtual module `pg:component-docs`, so the reference shown next
// to each live component is the library's documentation, not a second copy of it in this repo that drifts. A heading
// or table the parser does not recognise yields fewer facts for that tag, never a build failure: the card still shows
// its curated `ABOUT` line.
import { readFileSync } from 'node:fs';

// The first cell of a markdown table row, without the surrounding backticks: "`variant`" -> "variant".
function firstCell(row) {
  const cell = row.split('|')[1]?.trim() ?? '';
  return cell.replace(/`/g, '').trim();
}

// `label-*` rows are i18n text overrides; listing a dozen of them buries the attributes that change behaviour.
function namesOf(rows) {
  const names = [];
  let labels = false;
  for (const r of rows) {
    const n = firstCell(r);
    if (!n || /^-+$/.test(n)) continue;
    if (n.startsWith('label-') || n.startsWith('label-*')) { labels = true; continue; }
    for (const part of n.split(/\s*\/\s*|,\s*/)) if (part && !names.includes(part)) names.push(part);
  }
  if (labels) names.push('label-* (text overrides)');
  return names;
}

/** API.md: `### \`<b-x>\`` sections with Attribute / Method / Event tables and a `Slot:` line. */
export function parseApi(md) {
  const out = {};
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^### `<(b-[a-z0-9-]+)>`/.exec(lines[i]);
    if (!m) continue;
    const doc = {};
    let j = i + 1;
    let table = null;
    let seenTable = false;
    let rows = [];
    const flush = () => {
      if (!table) return;
      const key = { attribute: 'attributes', method: 'methods', event: 'events' }[table];
      if (key) doc[key] = [...(doc[key] ?? []), ...namesOf(rows)];
      table = null;
      rows = [];
    };
    for (; j < lines.length && !/^#{2,3} /.test(lines[j]); j++) {
      const line = lines[j];
      if (line.startsWith('|')) {
        if (!table) {
          const head = firstCell(line).toLowerCase();
          table = head.startsWith('attribute') ? 'attribute' : head.startsWith('method') ? 'method' : head.startsWith('event') ? 'event' : 'other';
          continue;
        }
        rows.push(line);
        continue;
      }
      if (table) seenTable = true;
      flush();
      const slot = /^Slots?:\s*(.+)$/.exec(line.trim());
      if (slot && !doc.slots) doc.slots = slot[1].replace(/`/g, '').replace(/\.$/, '');
      // Only prose ABOVE the first table introduces the component; what follows a table is a usage note.
      else if (!seenTable && !doc.summary && line.trim() && !/^(```|\*\*|>)/.test(line.trim())) {
        doc.summary = line.trim().replace(/`/g, '');
      }
    }
    flush();
    out[m[1]] = doc;
    i = j - 1;
  }
  return out;
}

/** README.md: the first paragraph line under each `### b-x` heading, which is that component's one-line summary. */
export function parseReadme(md) {
  const out = {};
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^### (b-[a-z0-9-]+)\s*$/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (!lines[j] || /^(```|\||#)/.test(lines[j])) continue;
    // The whole paragraph, not its first line: README wraps at ~120 columns, so a summary's first sentence often
    // continues on the next line ("…a tree of changes … or both bodies" / "side by side").
    const para = [];
    for (; j < lines.length && lines[j].trim() && !/^(```|\||#)/.test(lines[j]); j++) para.push(lines[j].trim());
    out[m[1]] = para.join(' ').replace(/`/g, '').replace(/\*\*/g, '');
  }
  return out;
}

// A tooltip lead is one sentence: "A form-associated whole-star rating input (TASK-579). Keyboard: …" -> the first part,
// without the task reference that means something to the library's maintainers and nothing to a visitor.
function firstSentence(s) {
  const clean = s.replace(/\s*\((?:TASK|STORY|EPIC|FEATURE)-\d+[^)]*\)/g, '');
  const end = clean.search(/\.(\s|$)/);
  return (end >= 0 ? clean.slice(0, end + 1) : clean).trim();
}

export function componentDocs(birkoSrc) {
  const dir = `${birkoSrc}/Birko.Web.Components`;
  const api = parseApi(readFileSync(`${dir}/API.md`, 'utf8'));
  const readme = parseReadme(readFileSync(`${dir}/README.md`, 'utf8'));
  const docs = {};
  for (const tag of new Set([...Object.keys(api), ...Object.keys(readme)])) {
    const doc = { ...(api[tag] ?? {}) };
    // Only README's line is written as a summary. API.md's first prose line is as often a usage note ("Slides are the
    // element's light-DOM children"), which reads as nonsense where a summary is expected.
    delete doc.summary;
    if (readme[tag]) doc.summary = firstSentence(readme[tag]);
    docs[tag] = doc;
  }
  return docs;
}

/** esbuild plugin: `import docs from 'pg:component-docs'`. Re-read on every (watch) rebuild. */
export function componentDocsPlugin(birkoSrc) {
  return {
    name: 'pg-component-docs',
    setup(build) {
      build.onResolve({ filter: /^pg:component-docs$/ }, () => ({ path: 'component-docs', namespace: 'pg-docs' }));
      build.onLoad({ filter: /.*/, namespace: 'pg-docs' }, () => ({
        contents: JSON.stringify(componentDocs(birkoSrc)),
        loader: 'json',
        watchFiles: [`${birkoSrc}/Birko.Web.Components/API.md`, `${birkoSrc}/Birko.Web.Components/README.md`],
      }));
    },
  };
}
