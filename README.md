# Birko.Web Playground

A runnable **component gallery + live design-token editor** for the `Birko.Web.*` libraries, with
**theme-CSS export**. The visual counterpart to `Birko.Sandbox` (which smoke-tests the backend):
this is where you view every `b-*` component and tune the `--b-*` design system.

Consumes `birko-web-core` / `birko-web-components` / `birko-web-shell` via the `BIRKO_SRC` esbuild
alias convention — sources resolve from the **`Birko\Web`** bucket (walk-up, or `BIRKO_SRC` override;
no machine-specific path committed).

## Two surfaces

1. **Component gallery** — renders the `b-*` catalogue with interactive controls to flip common
   attributes (variant, size, disabled, …) and watch the live instance update.
2. **Live token editor** — edits the `--b-*` token set (parsed from `tokens.css`) and restyles the
   gallery live via a `[data-theme="playground"]` block. Exports a paste-ready CSS file:
   a `[data-theme="my-brand"] { … }` block or a `:root` `tokens.css`-style override (changed tokens
   only), wired the same way as the framework's modular `css/themes/*.css` + `registerThemes()` system.

## Published

**<https://birko-framework.github.io/Birko.Web.Playground/>** — deployed from `main` by
`.github/workflows/pages.yml`, which runs all three harnesses first and only publishes if they pass.
A broken deploy is worse than a stale one here: a visitor who opens an empty gallery concludes the
*framework* is broken, not the page.

## Running

```bash
npm install          # once
npm run build        # bundle -> wwwroot/app.js + copy css/
# then serve wwwroot/ (any static server) or open index.html
npm run watch        # rebuild on save
node build.js --release   # what CI publishes: minified, no source map (1.0mb -> 672kb)
```

`BIRKO_SRC` defaults to the sibling `Birko\Web` bucket; override for non-standard layouts.

## Checks

```bash
node verify.mjs           # 667 — the gallery, every component, the token editor and the export
node device-fix-check.mjs #  68 — device/viewport behaviour
node subpath-check.mjs    #       serves under /Birko.Web.Playground/ and drives the app there
```

`subpath-check.mjs` is the one that looks redundant and is not. The other two serve `wwwroot/` at the
**web root**, which is exactly the configuration that hides a subpath defect — all 667 checks passed
against a build whose service worker could not register at all on the published URL. It fails on any
404, any console error, or a precache list that did not resolve.

## License

Part of the Birko Framework. See `License.md`.
