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
- `wwwroot/` — build output (`app.js` + copied `css/`); git-ignored.

## Conventions
- The gallery is driven by a manifest (`src/catalogue.ts` when split out) so new `b-*` components don't silently go missing; keep it in sync with the `Birko.Web.Components` catalogue.
- The token editor parses `wwwroot/css/tokens.css` at runtime so the editable token list stays in sync with the framework automatically.
- **One setter owns `data-theme`.** The header switcher, the description-card switcher and anything else
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
```

`verify.mjs` loads **one** 800x600 light-theme page, which is blind to a whole class of defect — the
2026-08-01 device pass found three at once that it could not have seen. `device-fix-check.mjs` covers that
gap by driving the same bundle at a **390px phone viewport** (overlay widths only misbehave *below* the
`max-width` cap), under **`data-theme="dark"`** (tint-vs-text contrast), and with **touch emulation** for
`pointer: coarse` rules. Add a case here whenever a fix depends on viewport, theme, or input modality.

Two things that make its results trustworthy, worth preserving in anything added to it:
- **Assert the precondition, not just the outcome.** A `<dialog>` that never opened measures 0x0 and every
  geometry assertion passes vacuously; an emulation API that silently no-ops reports a desktop value as a
  broken fix. Both happened while writing it, so each group asserts it is really in the state it claims.
- **Put the measured number in the check NAME** (as `backport-smoke` does), so a failure reports what it saw.
