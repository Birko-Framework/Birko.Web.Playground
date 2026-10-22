// TASK-747 — every size in b-ribbon's stylesheet is a design token. Asked by the user after a run of ribbon work had
// left about 90 literal lengths in it (1px borders, 0.125rem gaps, the gallery tile, the toolbar button, key tips …).
// Reads the live stylesheet, drops comments and every var(…) (a literal fallback inside one is the token's default,
// not a hard-coded size), and fails on any length left. The allowlist is what CSS cannot or should not tokenise.
import 'birko-web-components/nav';

// A media query cannot read a custom property; `em` sizes scale with their own text by design; 92vw keeps a flyout
// on a phone screen whatever the token says.
const ALLOWED = [/^@media\b/, /^\d*\.?\d+em$/, /^92vw$/];

const stripVars = (css: string): string => {
  let out = '';
  for (let i = 0; i < css.length;) {
    if (css.startsWith('var(', i)) {
      let depth = 0;
      for (; i < css.length; i++) {
        if (css[i] === '(') depth++;
        else if (css[i] === ')' && --depth === 0) { i++; break; }
      }
      out += 'VAR';
    } else {
      out += css[i++];
    }
  }
  return out;
};

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  try {
    await customElements.whenDefined('b-ribbon');
    const css = String((customElements.get('b-ribbon') as unknown as { styles: string }).styles ?? '');
    check(`the stylesheet is readable (${css.length} chars)`, css.length > 1000);
    const literals: string[] = [];
    for (const raw of css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')) {
      const line = raw.trim();
      if (ALLOWED[0].test(line)) continue;
      for (const m of stripVars(line).matchAll(/(?<![\w#.-])(-?\d*\.?\d+)(px|rem|em|vw|vh|pt|ch)(?![\w-])/g)) {
        if (m[2] === 'ch' && line.includes('1ch')) continue; // an input's width counts characters: `n * 1ch`
        if (!ALLOWED.some((a) => a.test(m[0]))) literals.push(`${m[0]} in "${line.slice(0, 70)}"`);
      }
    }
    check(`every length is a token (${literals.length} literal: ${literals.slice(0, 6).join('; ') || 'none'})`, literals.length === 0);
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] ribbon-tokens-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] ribbon-tokens-smoke ${r}`);
})();
