// TASK-137 control-side validation-message i18n smoke — asserts that the messages a control produces
// itself (`b-input`'s decimal constraints, `FormControlComponent.requiredMessage()`) go through the same
// attribute > global-i18n > English-fallback path as everything else in the library, and that the English
// path is byte-identical to what shipped before.
//
// Two halves, and both are load-bearing:
//   A. NO translations registered — every message must equal today's string exactly. This is the
//      observable behaviour for a consumer with no i18n configured, and it is what downstream asserts.
//   B. A translation registered — it must WIN. Half B is the reason this file exists: without it the
//      change is indistinguishable from "call a helper that always returns the fallback".
//
// `requiredMessage()` lives in **Birko.Web.Core**, not in the component library, so it is the one that
// gets forgotten. It is exercised here through `b-tag-input`, whose `validationSource()` is `undefined` —
// the div-based-control case that message exists for.
//
// SERIALISATION: half B registers messages on the GLOBAL i18n singleton, which changes strings that
// backport-smoke asserts in English (`res.errors['rate'] === 'Enter a number.'`, `'Rate is required'`).
// `addMessages` is not undoable, so this suite waits for backport-smoke to finish before touching it.
import 'birko-web-components/inputs';
import 'birko-web-components/data';
import { getI18n } from 'birko-web-core';
import { BAppShell, BUILTIN_THEMES } from 'birko-web-shell';

// Birko TASK-952 (reported by Symbio): the app shell's command-palette label, its theme-menu label and the built-in
// theme names were hard-coded English, so a Czech or Slovak app showed them in English. A concrete shell to render.
class I18nShell extends BAppShell {
  protected get brandName() { return 'T'; }
  protected get storagePrefix() { return 'i18n-shell'; }
  protected getUserName() { return 'tester'; }
  protected t(key: string) { return key; }
  protected onSignOut() {}
  protected getRibbonTabs() { return []; }
  protected getActiveTabId() { return ''; }
  protected onTabChange() {}
  protected onItemClick() {}
  protected get showStatusBar() { return false; }
  protected getAvailableThemes() { return [BUILTIN_THEMES.light, BUILTIN_THEMES.dark]; }
}
if (!customElements.get('pg-i18n-shell')) customElements.define('pg-i18n-shell', I18nShell);

/** Birko TASK-953 (reported by Symbio): b-data-table's select-all, select-row and row-action labels, read off a table. */
async function tableLabels(labels?: Record<string, string>): Promise<{ all: string; row: string; actions: string; quotedId: boolean }> {
  const dt = document.createElement('b-data-table') as HTMLElement & { setConfig(c: unknown): void; load(): Promise<void> };
  dt.style.position = 'absolute';
  dt.style.left = '-9999px';
  document.body.appendChild(dt);
  const client = { get: async () => ({ ok: true, status: 200, headers: new Headers(), data: [{ id: 'a"b', name: 'Row' }] }) };
  dt.setConfig({ endpoint: 'items', columns: [{ key: 'name', label: 'Name' }], apiClient: client, selectable: true,
    rowActions: [{ id: 'edit', label: 'Edit' }], ...(labels ? { labels } : {}) });
  await dt.load();
  await new Promise((r) => setTimeout(r, 60));
  const tbl = dt.shadowRoot?.querySelector('b-table')?.shadowRoot;
  const out = {
    all: tbl?.querySelector('.select-all')?.getAttribute('aria-label') ?? '(none)',
    row: tbl?.querySelector('.row-select')?.getAttribute('aria-label') ?? '(none)',
    actions: tbl?.querySelector('.row-action-trigger')?.getAttribute('aria-label') ?? '(none)',
    quotedId: tbl?.querySelector('.row-action-trigger')?.getAttribute('data-id') === 'a"b',
  };
  dt.remove();
  return out;
}

/** The shell's three Birko-owned strings, read off a freshly rendered shell. */
async function shellStrings(attrs: Record<string, string> = {}): Promise<{ palette: string; theme: string; themes: string[] }> {
  const el = document.createElement('pg-i18n-shell');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 80));
  const root = el.shadowRoot!;
  const dd = root.querySelector('#theme-dropdown') as (HTMLElement & { _items?: { label: string }[] }) | null;
  const out = {
    palette: root.querySelector('#search-btn')?.getAttribute('aria-label') ?? '(no button)',
    theme: root.querySelector('.theme-trigger')?.getAttribute('aria-label') ?? '(no trigger)',
    themes: (dd?._items ?? []).map((i) => i.label.replace(/^&#10003; /, '')),
  };
  el.remove();
  return out;
}

/** A real <form> in the document with the given controls inside. */
function form(...html: string[]): HTMLFormElement {
  const f = document.createElement('form');
  f.innerHTML = html.join('');
  f.style.position = 'absolute';
  f.style.left = '-9999px';
  document.body.appendChild(f);
  return f;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The `validationMessage` of the single control inside a freshly built form. */
async function messageOf(html: string): Promise<string> {
  const f = form(html);
  await settle();
  const el = f.firstElementChild as HTMLElement & { validationMessage: string };
  const msg = el.validationMessage;
  f.remove();
  return msg;
}

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  /** Report the actual string on failure — a wrong message is far more useful than a bare FAIL. */
  const eq = (name: string, actual: string, expected: string) =>
    check(actual === expected ? name : `${name} (got "${actual}", want "${expected}")`, actual === expected);

  try {
    // ── A. No translations registered: byte-identical to the strings that shipped ──
    {
      eq('EN badDecimal unchanged',
        await messageOf('<b-input name="a" type="decimal" value="abc"></b-input>'),
        'Enter a number.');
      eq('EN rangeUnderflow unchanged',
        await messageOf('<b-input name="a" type="decimal" min="5" value="1"></b-input>'),
        'Value must be 5 or more.');
      eq('EN rangeOverflow unchanged',
        await messageOf('<b-input name="a" type="decimal" max="10" value="20"></b-input>'),
        'Value must be 10 or less.');
      eq('EN stepMismatch unchanged',
        await messageOf('<b-input name="a" type="decimal" step="0.5" value="0.3"></b-input>'),
        'Value must be a multiple of 0.5.');
      // FormControlComponent.requiredMessage() — both branches. The labelled one keeps its trailing
      // period; the divergence from b-form's `{label} is required` is untranslated-path-only and
      // deliberate (see the method's doc comment).
      eq('EN requiredMessage with a label unchanged',
        await messageOf('<b-tag-input name="t" label="Tags" required></b-tag-input>'),
        'Tags is required.');
      eq('EN requiredMessage without a label unchanged',
        await messageOf('<b-tag-input name="t" required></b-tag-input>'),
        'Please fill out this field.');
    }

    // ── A2. A per-instance attribute override wins over the fallback (works before i18n too) ──
    {
      eq('label-bad-decimal attribute overrides the fallback',
        await messageOf('<b-input name="a" type="decimal" value="abc" label-bad-decimal="Zadajte cislo."></b-input>'),
        'Zadajte cislo.');
      eq('label-required attribute overrides the fallback, interpolating {label}',
        await messageOf('<b-tag-input name="t" label="Stitky" required label-required="Pole {label} je povinne."></b-tag-input>'),
        'Pole Stitky je povinne.');
    }

    // ── A3. TASK-952: the shell's own strings, untranslated, are the English that shipped ──
    {
      const en = await shellStrings();
      eq('TASK-952: shell command-palette label in English unchanged', en.palette, 'Command palette (Ctrl+K)');
      eq('TASK-952: shell theme-menu label in English unchanged', en.theme, 'Theme');
      eq('TASK-952: built-in theme names in English unchanged', en.themes.join(' | '), 'Auto | Light | Dark'); // Auto first where dark is offered (Birko TASK-971)
      const tl = await tableLabels();
      eq('TASK-953: data-table select-all label in English unchanged', tl.all, 'Select all rows');
      eq('TASK-953: data-table select-row label in English unchanged', tl.row, 'Select row');
      eq('TASK-953: data-table row-action label in English unchanged', tl.actions, 'Actions');
      check(`TASK-953: a row id with a quote stays one data-id value (${tl.quotedId})`, tl.quotedId);
    }

    // ── Wait for backport-smoke: half B mutates the global singleton it asserts English against ──
    {
      const done = () => (window as unknown as { __backportSmokeDone?: boolean }).__backportSmokeDone === true;
      const deadline = Date.now() + 45_000;
      while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      check('backport-smoke finished before global translations were registered', done());
    }

    // ── B. A registered translation WINS ──
    {
      getI18n().addMessages('en', {
        common: {
          required: 'Pole {label} je povinne',
          requiredNoLabel: 'Vyplnte toto pole.',
          badDecimal: 'Zadajte cislo.',
          rangeUnderflow: 'Hodnota musi byt {min} alebo viac.',
          rangeOverflow: 'Hodnota musi byt {max} alebo menej.',
          stepMismatch: 'Hodnota musi byt nasobkom {step}.',
        },
      });

      eq('i18n wins for b-input badDecimal',
        await messageOf('<b-input name="a" type="decimal" value="abc"></b-input>'),
        'Zadajte cislo.');
      eq('i18n wins for b-input rangeUnderflow, with {min} interpolated',
        await messageOf('<b-input name="a" type="decimal" min="5" value="1"></b-input>'),
        'Hodnota musi byt 5 alebo viac.');
      eq('i18n wins for b-input rangeOverflow, with {max} interpolated',
        await messageOf('<b-input name="a" type="decimal" max="10" value="20"></b-input>'),
        'Hodnota musi byt 10 alebo menej.');
      eq('i18n wins for b-input stepMismatch, with {step} interpolated',
        await messageOf('<b-input name="a" type="decimal" step="0.5" value="0.3"></b-input>'),
        'Hodnota musi byt nasobkom 0.5.');
      // The one that would otherwise be forgotten — it is implemented in Birko.Web.Core.
      eq('i18n wins for FormControlComponent.requiredMessage (Birko.Web.Core), with {label} interpolated',
        await messageOf('<b-tag-input name="t" label="Stitky" required></b-tag-input>'),
        'Pole Stitky je povinne');
      eq('i18n wins for the unlabelled requiredMessage branch',
        await messageOf('<b-tag-input name="t" required></b-tag-input>'),
        'Vyplnte toto pole.');

      // A per-instance attribute still beats a registered translation — the documented priority order.
      eq('attribute still beats a registered translation',
        await messageOf('<b-input name="a" type="decimal" value="abc" label-bad-decimal="Instance wins."></b-input>'),
        'Instance wins.');

      // The point of reusing `common.required` rather than minting a second key: one registration
      // translates BOTH layers, and they can no longer say different things about the same condition.
      {
        const host = document.createElement('b-form') as HTMLElement & {
          setSchema(s: unknown): void; validate(): { errors: Record<string, string> };
        };
        host.style.position = 'absolute';
        host.style.left = '-9999px';
        document.body.appendChild(host);
        host.setSchema({ name: 'root', children: [{ name: 'rate', type: 'text', label: 'Stitky', required: true }] });
        await new Promise((r) => setTimeout(r, 30));
        eq('one common.required registration also translates b-form\'s rule message',
          host.validate().errors['rate'] ?? '',
          'Pole Stitky je povinne');
        host.remove();
      }

      // TASK-952: the shell's strings take bws.shell.* keys; a consumer's locale bundle translates them.
      getI18n().addMessages('en', {
        bws: { shell: {
          commandPalette: 'Paleta prikazov (Ctrl+K)',
          theme: 'Vzhlad',
          themes: { auto: 'Automaticky', light: 'Svetly', dark: 'Tmavy' },
        } },
      });
      const sk = await shellStrings();
      eq('TASK-952: i18n wins for the shell command-palette label', sk.palette, 'Paleta prikazov (Ctrl+K)');
      eq('TASK-952: i18n wins for the shell theme-menu label', sk.theme, 'Vzhlad');
      eq('TASK-952: i18n wins for the built-in theme names', sk.themes.join(' | '), 'Automaticky | Svetly | Tmavy');
      const own = await shellStrings({ 'label-command-palette': 'Hladat', 'label-theme': 'Tema' });
      eq('TASK-952: a label-command-palette attribute still beats the translation', own.palette, 'Hladat');
      eq('TASK-952: a label-theme attribute still beats the translation', own.theme, 'Tema');

      // TASK-953: b-data-table's selection and row-action labels take bwc.dataTable.* keys like its other labels.
      getI18n().addMessages('en', { bwc: { dataTable: { selectAll: 'Vybrat vsetky riadky', selectRow: 'Vybrat riadok', actions: 'Akcie' } } });
      const tsk = await tableLabels();
      eq('TASK-953: i18n wins for the data-table select-all label', tsk.all, 'Vybrat vsetky riadky');
      eq('TASK-953: i18n wins for the data-table select-row label', tsk.row, 'Vybrat riadok');
      eq('TASK-953: i18n wins for the data-table row-action label', tsk.actions, 'Akcie');
      const town = await tableLabels({ selectAll: 'All', selectRow: 'One', actions: 'Do' });
      eq('TASK-953: config labels still beat the translation', `${town.all} | ${town.row} | ${town.actions}`, 'All | One | Do');
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] i18n-message-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] i18n-message-smoke ${r}`);
})();
