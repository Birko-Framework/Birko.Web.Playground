// Resolves the Birko\Web checkout, once, for everything in this project that needs it.
//
// `build.js` owned this and was the only caller, until `theme-roundtrip-check.mjs` needed to bundle a
// throwaway consumer against the same framework sources. Copying six lines of walk-up into the second
// caller is how two resolvers end up disagreeing about which checkout is being tested — the exact
// shape this family keeps recording — so it lives here and both import it.
//
// Order: the BIRKO_SRC env var first (CI, Docker, the Pages workflow), then a walk up from this file
// looking for a `Birko/Web` bucket. Never a machine-specific path: this file is committed.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveBirkoWeb() {
  const env = process.env.BIRKO_SRC;
  if (env) return env.replace(/[\\/]+$/, '').replaceAll('\\', '/');
  for (let d = __dirname; d !== dirname(d); d = dirname(d)) {
    const c = resolve(d, 'Birko/Web');
    if (existsSync(resolve(c, 'Birko.Web.Core'))) return c.replaceAll('\\', '/');
  }
  throw new Error('Cannot locate Birko\\Web. Set the BIRKO_SRC env var to its path.');
}

/**
 * The full alias map the playground bundles with.
 *
 * A real consumer imports a subset, which is why `theme-roundtrip-check.mjs` passes the whole map and
 * lets esbuild bundle only what its entry reaches — the same thing that happens in a consumer's own
 * build, rather than a hand-trimmed map that could drift from the one under test.
 */
export function birkoAliases(src = resolveBirkoWeb()) {
  return {
    'birko-web-core':          `${src}/Birko.Web.Core/src/index.ts`,
    'birko-web-core/base':     `${src}/Birko.Web.Core/src/base/index.ts`,
    'birko-web-core/state':    `${src}/Birko.Web.Core/src/state/index.ts`,
    'birko-web-core/http':     `${src}/Birko.Web.Core/src/http/index.ts`,
    'birko-web-core/router':   `${src}/Birko.Web.Core/src/router/index.ts`,
    'birko-web-core/i18n':     `${src}/Birko.Web.Core/src/i18n/index.ts`,
    'birko-web-core/offline':  `${src}/Birko.Web.Core/src/offline/index.ts`,
    'birko-web-components':            `${src}/Birko.Web.Components/src/index.ts`,
    'birko-web-components/inputs':     `${src}/Birko.Web.Components/src/inputs/index.ts`,
    'birko-web-components/layout':     `${src}/Birko.Web.Components/src/layout/index.ts`,
    'birko-web-components/data':       `${src}/Birko.Web.Components/src/data/index.ts`,
    'birko-web-components/feedback':   `${src}/Birko.Web.Components/src/feedback/index.ts`,
    'birko-web-components/dialogs':    `${src}/Birko.Web.Components/src/dialogs/index.ts`,
    'birko-web-components/nav':        `${src}/Birko.Web.Components/src/nav/index.ts`,
    'birko-web-components/command':    `${src}/Birko.Web.Components/src/command/index.ts`,
    'birko-web-components/form-utils': `${src}/Birko.Web.Components/src/form-utils/index.ts`,
    'birko-web-shell':       `${src}/Birko.Web.Shell/src/index.ts`,
  };
}
