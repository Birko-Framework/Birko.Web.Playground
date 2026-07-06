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

## Running

```bash
npm install          # once
npm run build        # bundle -> wwwroot/app.js + copy css/
# then serve wwwroot/ (any static server) or open index.html
npm run watch        # rebuild on save
```

`BIRKO_SRC` defaults to the sibling `Birko\Web` bucket; override for non-standard layouts.

## License

Part of the Birko Framework. See `License.md`.
