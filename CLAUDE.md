# Birko.Web.Playground

## Overview
Frontend reference consumer (TypeScript + esbuild) — a **component gallery + live design-token
editor + theme-CSS export** for `Birko.Web.*`. Visual counterpart to `Birko.Sandbox` (backend smoke
harness). Created in TASK-038 (EPIC-013 reference consumers).

## Location
`C:\Source\Birko\Consumers\Birko.Web.Playground` — a Birko.Web consumer under `Birko\Consumers`.

## How it consumes the framework
- `build.js` resolves the **`Birko\Web`** bucket (the TS frontend libs) without a committed absolute
  path: `BIRKO_SRC` env var, else walk up to find `Birko/Web/Birko.Web.Core`. The esbuild `alias`
  map points `birko-web-*` imports at `${BIRKO_SRC}/Birko.Web.X/src/...`.
- `tsconfig.json` `paths` mirror the aliases (`../../Web/Birko.Web.*`) for editor type-checking.
- Base CSS (`tokens.css`, `reset.css`, `themes/*.css`) is copied into `wwwroot/css/` at build.

## Structure
- `src/app.ts` — the playground app: imports `birko-web-components` (registers all `b-*`), builds the
  gallery + token editor + export UI.
- `index.html` — links `css/*`, hosts `<style id="playground-theme">` (live edits applied here) + `app.js`.
- `build.js` / `package.json` / `tsconfig.json` — esbuild build + aliases.
- `component-docs.mjs` — parses `Birko.Web.Components/README.md` (one-line summaries) and `API.md` (attribute /
  method / event tables, `Slot:` lines) at build time and serves them as the virtual module `pg:component-docs`
  (typed in `src/pg-modules.d.ts`). It feeds each card's ⓘ tooltip, so the reference shown beside a live component is
  the library's own documentation, not a copy here.
- `locales/` — partial `cs.json` / `sk.json` for the ribbon's **Locale** set; `build.js` copies them plus the library's
  `Birko.Web.Components/locales/en.json` into `wwwroot/locales/`, which is where `getI18n().setLocale()` fetches from.
- `wwwroot/` — build output (`app.js` + copied `css/`); git-ignored.

## Conventions
- The gallery is driven by a manifest (`src/catalogue.ts` when split out) so new `b-*` components don't silently go missing; keep it in sync with the `Birko.Web.Components` catalogue.
- **The header is a `b-ribbon` (`#pg-ribbon`), grouped by task** (decided 2026-10-28): Gallery (category one-of set +
  Find filter), Appearance (theme set, locale set, Design tokens, Generate CSS), Lab, Help (About, Tour, docs links).
  The app acts on the ribbon's own `item-click` / `item-change` / `tab-change`, and the checks dispatch those same
  events on `#pg-ribbon` (`item-click` `{ itemId: 'cat:<category>' }` builds a section, `itemId: 'tokens'` opens the
  token drawer) — never a hidden side door. Its `collapse-shortcut` and `keytip-shortcut` are `none`: both keys are
  page-wide, and the gallery's Ribbon card is the one demonstrating them (keyboard-check fails otherwise).
- **Every card says what it is.** A visible line from `ABOUT` in `app.ts` (curated copy, keyed by catalogue `label`)
  and an ⓘ tooltip from `pg:component-docs`. A new catalogue entry needs an `ABOUT` line; `reportMissing()` warns
  without one.
- **Test harnesses go in `category: 'lab'`**, not among the components: the grid benchmark, device probes and wiring
  checks (help-text row, page tour). The Lab grid opens with a banner saying they are not components, and still is a
  `.pg-grid`, so verify.mjs renders and counts it like any section.
- **The introduction is Help → About** (`#pg-about`, a `b-modal`), not a panel above the gallery. A first visit gets
  one dismissible line (`#pg-hint`); its dismissal keeps the old `pg-intro-dismissed` key.
- **The locale pick persists under `pg-locale`**, written only by the ribbon's Locale click (`pickLocale`) and
  re-applied at boot — except under `?smoke` / `?kb`, whose suites assert English. Not via I18n's own `storageKey`:
  the smoke suites switch the shared I18n's locale, so Lab → Run smoke suites would change a visitor's language.
- The token editor parses `wwwroot/css/tokens.css` at runtime so the editable token list stays in sync with the framework automatically.
- **One setter owns `data-theme`.** The ribbon's theme set, the description-card switcher and anything else
  added later bind via `bindThemeSwitcher()` / `onThemeChange()` in `app.ts` — never by reading or writing
  the attribute directly. Two controls writing it independently is how they silently drift apart. The pick
  persists under the `pg-theme` localStorage key and is re-applied by a blocking inline script in
  `index.html` (before first paint — a deferred module would flash the light gallery first).
- **Live token edits are a layer, not a theme.** They write to the `#playground-theme` block under
  `:root[data-pg-edits]` — a *separate* attribute from `data-theme`, because an element has only one
  `data-theme` and the editor claiming it dropped the page back to light the moment a token was touched.
  Specificity works out: `:root[data-pg-edits]` is (0,2,0) vs the themes' `[data-theme="x"]` (0,1,0).
- The editor's "base" for a token is **the active theme's value**, not always light's — each theme file is
  a diff over `:root`, so `baseValue()` falls back to `tokens.css` for anything the theme doesn't override.
  Export emits only tokens that differ from that base (clean diff, like `dark.css`/`neon.css`).
- No live network calls; this is a pure static frontend.

## Building / running
```bash
npm install && npm run build   # -> wwwroot/app.js (+ css/), resolves Birko\Web
npm run watch                  # rebuild on save
# serve wwwroot/ or open index.html in a browser
```

## Verifying a Birko.Web.* change
`Birko.Web.*` has no unit-test runner, so this playground is the verification vehicle. Build first —
both scripts read `wwwroot/`, so an unbuilt edit silently verifies the previous bundle.

```bash
node build.js
node verify.mjs             # every section renders, no EMPTY component, no page error, all *-smoke suites
node device-fix-check.mjs   # geometry + contrast at viewports/themes verify.mjs never visits (exit 1 on FAIL)
node entry-points-check.mjs # each Birko.Web.Components file imported alone registers all it renders (no build needed)
node keyboard-check.mjs     # trusted key presses: tab stops, native radio arrows (an in-page KeyboardEvent has no default action)
node ribbon-a11y-check.mjs  # what a screen reader gets from b-ribbon, read from Chromium's accessibility tree
node locale-keys-check.mjs  # every bwc.* / common.* key src/ reads is in en.json at that path, and every en.json key is read (no build needed)
node sortable-drag-check.mjs # b-sortable-list dragged by a real mouse and touchscreen, per layout (in-page code cannot capture a pointer)
node locale-switch-check.mjs # a locale switch re-localizes components at every shadow depth, innermost first; an open dialog survives a re-render
node rerender-leak-check.mjs # re-renders every gallery component and fails on any that gains event listeners per render
```

**A flaky suite: run it alone before blaming it.** `verify.mjs` loads `/?smoke=1`, which runs every `*-smoke` suite
at once in one page. `/?smoke=1&only=carousel-smoke,gallery-smoke` runs just those, so a suite's own flake can be told
from one another suite causes. TASK-745 found the carousel clean alone (0/20) and failing beside the grid benchmark
and the locale switches, whose main-thread stalls exposed a real `SlideTrack` defect.

`verify.mjs` loads **one** 800x600 light-theme page, which is blind to a whole class of defect — the
2026-08-01 device pass found three at once that it could not have seen. `device-fix-check.mjs` covers that
gap by driving the same bundle at a **390px phone viewport** (overlay widths only misbehave *below* the
`max-width` cap), under **`data-theme="dark"`** (tint-vs-text contrast), and with **touch emulation** for
`pointer: coarse` rules. Add a case here whenever a fix depends on viewport, theme, or input modality.

It also owns the **shadow-depth** group (added 2026-08-02), which measures `--b-shadow-*` off rendered
pixels in all five themes. Shadows have no DOM, no ARIA and no geometry, so `verify.mjs` and every in-page
smoke suite are blind to them *by construction* — which is how `dark`/`neon`/`inverse` shipped without ever
overriding `--b-shadow-xl`, leaving the level every overlay uses weaker than `--b-shadow`. Two rules for
anything added there:
- **Screenshot, then hand the PNG back into the page** and read it off a canvas. Real CSS rendering, and no
  PNG decoder needed on the node side.
- **Measure ink (delta summed down the column), not the deepest pixel.** Peak punishes a wide soft shadow:
  finstat's `xl` is deliberately broad (`0 20px 70px -25px`) and reads as its deepest level while measuring
  a *lower* peak than its `md`. Judging on peak would have "fixed" a token that was correct. And assert the
  **ordering**, not absolute numbers — the scale being monotonic is the contract; the depth is decoration.

Two things that make its results trustworthy, worth preserving in anything added to it:
- **Assert the precondition, not just the outcome.** A `<dialog>` that never opened measures 0x0 and every
  geometry assertion passes vacuously; an emulation API that silently no-ops reports a desktop value as a
  broken fix. Both happened while writing it, so each group asserts it is really in the state it claims.
- **Put the measured number in the check NAME** (as `backport-smoke` does), so a failure reports what it saw.
