// Lab card for Birko TASK-797: a b-form relabels on a locale switch, in both of its ways. Left, a schema built in
// code with t() and passed as a factory; right, a schema kept as data whose text is i18n keys. Switch the locale
// from the ribbon (Locale → SK) with a value typed, an error shown and a field focused: the text changes, the rest
// stays. The Slovak text is in locales/sk.json under pg.form (and common.required).
import { t } from 'birko-web-core';
import type { BForm, FormSchema } from 'birko-web-components';

const codeSchema = (): FormSchema => ({
  name: 'root', children: [{
    name: 'person', label: t('pg.form.group', {}, 'Personal'), children: [
      { name: 'name', type: 'text', required: true, label: t('pg.form.name', {}, 'Name'),
        placeholder: t('pg.form.namePh', {}, 'Enter a name'), description: t('pg.form.nameHelp', {}, 'Full name') },
      { name: 'nick', type: 'text', label: 'Nick (a literal string)',
        rules: [{ type: 'minLength', value: 5, message: t('pg.form.short', {}, 'Too short') }] },
      { name: 'colour', type: 'select', label: t('pg.form.colour', {}, 'Colour'),
        options: [{ value: 'r', label: t('pg.form.red', {}, 'Red') }] },
    ],
  }],
});

const dataSchema: FormSchema = {
  name: 'root', children: [
    { name: 'name', type: 'text', required: true, label: { key: 'pg.form.name', fallback: 'Name' },
      placeholder: { key: 'pg.form.namePh', fallback: 'Enter a name' } },
    { name: 'colour', type: 'select', label: { key: 'pg.form.colour', fallback: 'Colour' },
      options: [{ value: 'r', label: { key: 'pg.form.red', fallback: 'Red' } }] },
  ],
};

class PgFormLocale extends HTMLElement {
  connectedCallback(): void {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    this.innerHTML = `
      <style>
        .pgfl-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
        .pgfl-q { font-size: var(--b-text-xs); color: var(--b-text-secondary); margin: 0 0 .4rem; }
        .pgfl-row { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .5rem; }
      </style>
      <div class="pgfl-grid">
        <div>
          <p class="pgfl-q">Built in code with t(), passed as setSchema(() =&gt; schema)</p>
          <b-form id="pgfl-code"></b-form>
          <div class="pgfl-row">
            <b-button size="sm" variant="secondary" data-act="validate" data-form="pgfl-code">Validate</b-button>
            <b-button size="sm" variant="ghost" data-act="server" data-form="pgfl-code">Set a server error</b-button>
          </div>
        </div>
        <div>
          <p class="pgfl-q">Kept as data: text given as i18n keys</p>
          <b-form id="pgfl-data"></b-form>
          <div class="pgfl-row">
            <b-button size="sm" variant="secondary" data-act="validate" data-form="pgfl-data">Validate</b-button>
          </div>
        </div>
      </div>`;
    requestAnimationFrame(() => {
      this.querySelector<BForm>('#pgfl-code')?.setSchema(codeSchema);
      this.querySelector<BForm>('#pgfl-data')?.setSchema(dataSchema);
    });
    this.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      const form = btn && this.querySelector<BForm>(`#${btn.dataset.form}`);
      if (!btn || !form) return;
      if (btn.dataset.act === 'validate') form.validate();
      else form.setFieldError('person.colour', 'Server says no (stays as given)');
    });
  }
}

if (!customElements.get('pg-form-locale')) customElements.define('pg-form-locale', PgFormLocale);
