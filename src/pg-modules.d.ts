// Virtual modules resolved by build.js's esbuild plugins.

/** Per-tag reference for the gallery's ⓘ tooltips, parsed from Birko.Web.Components' README.md and API.md. */
declare module 'pg:component-docs' {
  const docs: Record<string, { summary?: string; attributes?: string[]; methods?: string[]; events?: string[]; slots?: string }>;
  export default docs;
}
