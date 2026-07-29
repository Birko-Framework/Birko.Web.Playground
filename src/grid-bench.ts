// STORY-002 / TASK-002 — the benchmark that gates migrating `b-editable-table` cells onto the bare
// components. The table renders raw <input>/<select>/<input type=checkbox> today, deliberately: one
// delegated listener on <tbody>, no re-render-on-keystroke, and no Shadow DOM per cell. The question is
// what `<b-input bare size="sm">` per cell actually costs.
//
// What this measures: the CELL COST of each approach at grid scale, in isolation — build, re-render, edit
// latency, caret survival and node/shadow-root count. It is not a full b-editable-table (no sort, no
// validation, no virtualisation), because the decision hinges on the per-cell primitive, not the features
// wrapped around it.
//
// Logged with the `[playground]` prefix so verify.mjs captures it headlessly; also runnable by hand from
// the gallery card.
import 'birko-web-components/inputs';

export interface BenchRow { name: string; code: string; qty: number; due: string; status: string; ok: boolean }

const ROWS_DEFAULT = 500;
const COLS = 6;               // 2 text, 1 number, 1 date, 1 select, 1 checkbox — b-editable-table's mix
const STATUS = [{ value: 'draft', label: 'Draft' }, { value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }];

function data(n: number): BenchRow[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Item ${i}`, code: `SKU-${1000 + i}`, qty: i % 97, due: '2026-07-29',
    status: STATUS[i % 3].value, ok: i % 2 === 0,
  }));
}

/** Force layout + a frame, so we measure work the browser actually did rather than queued. */
async function settle(host: HTMLElement): Promise<void> {
  void host.offsetHeight;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

// ── Variant A: raw controls, mirroring what b-editable-table emits today ──
function rawRows(rows: BenchRow[]): string {
  return rows.map((row, idx) => `
    <tr>
      <td><input type="text" class="cell-input" data-key="name" data-idx="${idx}" value="${row.name}"></td>
      <td><input type="text" class="cell-input" data-key="code" data-idx="${idx}" value="${row.code}"></td>
      <td><input type="number" class="cell-input" data-key="qty" data-idx="${idx}" value="${row.qty}"></td>
      <td><input type="date" class="cell-input" data-key="due" data-idx="${idx}" value="${row.due}"></td>
      <td><select class="cell-input" data-key="status" data-idx="${idx}">${
        STATUS.map((o) => `<option value="${o.value}"${row.status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')
      }</select></td>
      <td><input type="checkbox" class="cell-input" data-key="ok" data-idx="${idx}"${row.ok ? ' checked' : ''}></td>
    </tr>`).join('');
}

// ── Variant B: bare components per cell ──
function bareRows(rows: BenchRow[]): string {
  return rows.map((row, idx) => `
    <tr>
      <td><b-input bare size="sm" data-key="name" data-idx="${idx}" value="${row.name}"></b-input></td>
      <td><b-input bare size="sm" data-key="code" data-idx="${idx}" value="${row.code}"></b-input></td>
      <td><b-input bare size="sm" type="number" data-key="qty" data-idx="${idx}" value="${row.qty}"></b-input></td>
      <td><b-input bare size="sm" type="date" data-key="due" data-idx="${idx}" value="${row.due}"></b-input></td>
      <td><b-select bare size="sm" data-key="status" data-idx="${idx}" value="${row.status}"></b-select></td>
      <td><b-checkbox data-key="ok" data-idx="${idx}"${row.ok ? ' checked' : ''}></b-checkbox></td>
    </tr>`).join('');
}

/** b-select's options are data, soeach cell needs a JS call — part of the cost, not an aside. */
function populateSelects(host: HTMLElement): void {
  host.querySelectorAll<HTMLElement & { setOptions(o: unknown[]): void }>('b-select')
    .forEach((el) => el.setOptions(STATUS));
}

function countNodes(host: HTMLElement): { elements: number; shadowRoots: number } {
  let elements = 0, shadowRoots = 0;
  const walk = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      elements++;
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) { shadowRoots++; walk(sr); }
    }
  };
  walk(host);
  return { elements, shadowRoots };
}

export interface Result {
  variant: string;
  buildMs: number;
  rerenderMs: number;
  editMs: number;         // 50 keystrokes on one cell
  caretKept: boolean;
  /** Caret after the control's OWN re-render — the naive per-cell wiring. `true` for raw (nothing re-renders). */
  caretKeptOnParentRerender: boolean;
  elements: number;
  shadowRoots: number;
}

async function run(variant: 'raw' | 'bare', host: HTMLElement, ROWS: number): Promise<Result> {
  const rows = data(ROWS);
  host.innerHTML = '';
  const table = document.createElement('table');
  host.appendChild(table);

  // ── build ──
  const t0 = performance.now();
  table.innerHTML = `<tbody>${variant === 'raw' ? rawRows(rows) : bareRows(rows)}</tbody>`;
  if (variant === 'bare') { customElements.upgrade(table); populateSelects(table); }
  await settle(host);
  const buildMs = performance.now() - t0;

  // ── re-render (a data change rebuilds tbody — what the table does today) ──
  const t1 = performance.now();
  table.innerHTML = `<tbody>${variant === 'raw' ? rawRows(rows) : bareRows(rows)}</tbody>`;
  if (variant === 'bare') { customElements.upgrade(table); populateSelects(table); }
  await settle(host);
  const rerenderMs = performance.now() - t1;

  // ── edit latency: 50 keystrokes into a middle cell ──
  const cell = variant === 'raw'
    ? table.querySelector<HTMLInputElement>(`input[data-key="name"][data-idx="${Math.floor(ROWS / 2)}"]`)!
    : (table.querySelector(`b-input[data-key="name"][data-idx="${Math.floor(ROWS / 2)}"]`) as HTMLElement)
        .shadowRoot!.querySelector('input')!;
  const t2 = performance.now();
  for (let i = 0; i < 50; i++) {
    cell.value = `typing ${i}`;
    cell.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  await settle(host);
  const editMs = performance.now() - t2;

  // ── caret survival: the core risk of the migration ──
  // Order matters. Assigning `.value` moves the caret to the end by itself, so it must happen BEFORE the
  // caret is placed — otherwise the test destroys the very thing it measures (it did, at first: both
  // variants reported LOST). What we want is: caret placed mid-string, then the keystroke event the
  // component reacts to, then check the component did not move it.
  cell.focus();
  cell.value = 'abcdef';
  cell.setSelectionRange(3, 3);
  cell.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(host);
  const caretKept = cell.selectionStart === 3;

  // And the naive migration: a parent that re-renders on every `change` (the obvious way to wire cells,
  // and what the AC means by "event handling redesigned"). Measured separately so the cost of getting it
  // wrong is visible rather than assumed.
  let caretKeptOnParentRerender = caretKept;
  {
    const host2 = cell.getRootNode() as ShadowRoot | Document;
    const owner = (host2 as ShadowRoot).host as (HTMLElement & { update?: () => void }) | undefined;
    if (owner && typeof (owner as unknown as { update?: unknown }).update === 'function') {
      cell.focus();
      cell.value = 'abcdef';
      cell.setSelectionRange(3, 3);
      (owner as unknown as { update(): void }).update();
      await settle(host);
      const again = owner.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      caretKeptOnParentRerender = again?.selectionStart === 3;
    }
  }

  const { elements, shadowRoots } = countNodes(table);
  host.innerHTML = '';
  return { variant, buildMs, rerenderMs, editMs, caretKept, caretKeptOnParentRerender, elements, shadowRoots };
}

export async function runGridBench(host: HTMLElement, passes = 3, ROWS = ROWS_DEFAULT): Promise<Result[]> {
  const out: Result[] = [];
  for (const variant of ['raw', 'bare'] as const) {
    const runs: Result[] = [];
    for (let p = 0; p < passes; p++) runs.push(await run(variant, host, ROWS));
    const med = (pick: (r: Result) => number): number => {
      const v = runs.map(pick).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    out.push({
      variant,
      buildMs: +med((r) => r.buildMs).toFixed(1),
      rerenderMs: +med((r) => r.rerenderMs).toFixed(1),
      editMs: +med((r) => r.editMs).toFixed(1),
      caretKept: runs.every((r) => r.caretKept),
      caretKeptOnParentRerender: runs.every((r) => r.caretKeptOnParentRerender),
      elements: runs[0].elements,
      shadowRoots: runs[0].shadowRoots,
    });
  }
  const [raw, bare] = out;
  const x = (a: number, b: number): string => (a === 0 ? 'n/a' : `${(b / a).toFixed(1)}×`);
  console.log(`[playground] grid-bench: ${ROWS} rows × ${COLS} cols (${ROWS * COLS} cells), median of ${passes}`);
  for (const r of out) {
    console.log(`[playground] grid-bench ${r.variant.padEnd(4)} build=${String(r.buildMs).padStart(7)}ms  ` +
      `rerender=${String(r.rerenderMs).padStart(7)}ms  edit50=${String(r.editMs).padStart(6)}ms  ` +
      `caret=${r.caretKept ? 'kept' : 'LOST'}  caretOnRerender=${r.caretKeptOnParentRerender ? 'kept' : 'LOST'}  ` +
      `elements=${r.elements}  shadowRoots=${r.shadowRoots}`);
  }
  console.log(`[playground] grid-bench ratio bare/raw: build ${x(raw.buildMs, bare.buildMs)}  ` +
    `rerender ${x(raw.rerenderMs, bare.rerenderMs)}  edit ${x(raw.editMs, bare.editMs)}  ` +
    `elements ${x(raw.elements, bare.elements)}`);
  return out;
}
