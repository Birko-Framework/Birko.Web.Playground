// Does every key the framework reads exist in its locale bundle, at the path it reads?
//
//   node locale-keys-check.mjs        (exit 1 on any FAIL; no build needed — it reads the sources)
//
// Birko TASK-765 (for Symbio TASK-953). `Birko.Web.Components/locales/en.json` had b-json-diff's whole block pasted
// inside `bwc.daterange`'s braces, so it shipped as `bwc.daterange.jsonDiff.*` while the component reads
// `bwc.jsonDiff.*`. Nothing reported it: `label()` falls back to its built-in English default, so the screen looked
// right in English and every translation of those keys — the framework's and each consumer's copy — was dead.
//
// Two directions, each naming the key:
//   missing — a literal `bwc.*` / `common.*` key in Core / Components / Shell `src/` that en.json does not have;
//   unused  — an en.json key no source reads (literally, or under a `${…}` template prefix), unless KEPT below.
// `bws.*` is out of scope: Birko.Web.Shell ships no bundle, its keys are defaults a consumer translates.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBirkoWeb } from './birko-src.mjs';

const WEB = resolveBirkoWeb();
const BUNDLE = `${WEB}/Birko.Web.Components/locales/en.json`;
const PACKAGES = ['Birko.Web.Core', 'Birko.Web.Components', 'Birko.Web.Shell'];

// Keys no framework source reads that stay in the bundle, each with why. Exact keys, so a new dead key still fails.
const KEPT = {
  'bwc.common.confirm': 'a generic label consumers read through t()',
  'bwc.common.search': 'a generic label consumers read through t()',
  'bwc.ribbon.expand': 'Symbio reads it through t() (its cell-renderers ribbon labels); b-ribbon dropped it in FEATURE-019 D6',
  'bwc.ribbon.unpin': 'Symbio reads it through t() (its cell-renderers ribbon labels); b-ribbon dropped it in FEATURE-019 D6',
  'bwc.daterange.presets': 'b-date-range-picker takes preset labels from its presets attribute; kept for consumers',
  'bwc.daterange.nightsCount': 'no source reads it; kept for consumers until removed as a key change',
  'bwc.daterange.daysCount': 'no source reads it; kept for consumers until removed as a key change',
  ...Object.fromEntries(['today', 'yesterday', 'last7days', 'last30days', 'thisWeek', 'thisMonth', 'lastMonth', 'thisYear']
    .map((p) => [`bwc.daterange.preset.${p}`, 'preset labels come from the presets attribute; kept for consumers'])),
};

const results = [];
const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); return ok; };

// ── The bundle's keys ──────────────────────────────────────────────────────────────────────────────────────
// An object whose every key is a plural category is one key (t() resolves `x` with a count to `x.one` / `x.other`).
const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const leaves = (obj, prefix = '', out = []) => {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const isObj = v !== null && typeof v === 'object';
    if (isObj && !Object.keys(v).every((c) => PLURAL.has(c))) leaves(v, path, out);
    else out.push(path);
  }
  return out;
};
const bundleKeys = leaves(JSON.parse(readFileSync(BUNDLE, 'utf8')));
const inBundle = new Set(bundleKeys);
check(`bundle: en.json has keys (${bundleKeys.length})`, bundleKeys.length >= 100);

// ── The keys the sources read ──────────────────────────────────────────────────────────────────────────────
// Same comment strip as entry-points-check.mjs, so a key named in a doc comment is not counted as read.
const stripComments = (s) => s.replace(/(^|[\s;{}(),=])\/\*[\s\S]*?\*\//g, '$1').replace(/^\s*\/\/.*$/gm, '');
const sources = [];
const walk = (dir) => {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, d.name);
    if (d.isDirectory()) walk(f);
    else if (d.name.endsWith('.ts')) sources.push(f);
  }
};
for (const p of PACKAGES) walk(`${WEB}/${p}/src`);

const read = new Map(); // key → first file reading it
const prefixes = new Map(); // `bwc.stat.` from `bwc.stat.${trend}` → file
for (const f of sources) {
  const rel = f.slice(WEB.length + 1).replaceAll('\\', '/');
  const s = stripComments(readFileSync(f, 'utf8'));
  for (const m of s.matchAll(/(['"`])((?:bwc|common)\.[A-Za-z0-9_.]+)(\1|\$\{)/g)) {
    const into = m[3] === '${' ? prefixes : read;
    if (!into.has(m[2])) into.set(m[2], rel);
  }
}
check(`sources: found the keys the framework reads (${read.size} in ${sources.length} files)`, read.size >= 100);

// ── 1. missing ─────────────────────────────────────────────────────────────────────────────────────────────
const missing = [...read].filter(([k]) => !inBundle.has(k));
for (const [k, f] of missing) check(`missing: ${k} is read by ${f} but en.json has no such key`, false);
check(`missing: every key the sources read is in en.json (${read.size - missing.length}/${read.size})`, missing.length === 0);

// ── 2. unused ──────────────────────────────────────────────────────────────────────────────────────────────
for (const [p, f] of prefixes) {
  check(`template: ${p}\${…} (${f}) matches keys in en.json`, bundleKeys.some((k) => k.startsWith(p)));
}
const isRead = (k) => read.has(k) || [...prefixes.keys()].some((p) => k.startsWith(p));
const unused = bundleKeys.filter((k) => !isRead(k) && !(k in KEPT));
for (const k of unused) check(`unused: en.json has ${k} but no source reads it`, false);
check(`unused: every en.json key is read or kept (${bundleKeys.length - unused.length}/${bundleKeys.length})`, unused.length === 0);
for (const k of Object.keys(KEPT)) {
  check(`kept: ${k} is still in en.json and still unread (else drop it from KEPT)`, inBundle.has(k) && !isRead(k));
}

const failed = results.filter((r) => r.startsWith('FAIL'));
for (const r of results) console.log(r);
console.log(`locale-keys-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
