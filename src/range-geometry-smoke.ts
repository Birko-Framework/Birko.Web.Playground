// TASK-497 — every b-range thumb sits on its track. The shared form-control sheet gives each input a
// min-height taller than the slider box; single mode centres it with flex, but range mode positioned its
// two inputs at `top: 0`, so both thumbs hung ~6px below the line. The thumb is a pseudo-element with no
// box of its own, so the input's box centre stands in for it: a range thumb is centred in its input.
import 'birko-web-components/inputs';

const settle = () => new Promise((r) => setTimeout(r, 60));

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // On-screen (a fixed, top-layer host): layout must actually run for the boxes to mean anything.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:24rem;padding:1rem;background:#fff;z-index:99999';
  document.body.prepend(host);

  try {
    const CASES: Array<[string, string]> = [
      ['single', ''],
      ['single sm', 'size="sm"'],
      ['single lg', 'size="lg"'],
      ['range sm', 'mode="range" size="sm"'],
      ['range md', 'mode="range"'],
      ['range lg', 'mode="range" size="lg"'],
    ];
    for (const [name, attrs] of CASES) {
      host.innerHTML = `<b-range label="G" min="0" max="100" display="slider" ${attrs}></b-range>`;
      await settle();
      const sr = host.querySelector('b-range')!.shadowRoot!;
      const track = sr.querySelector('.range-track')!.getBoundingClientRect();
      const inputs = [...sr.querySelectorAll<HTMLInputElement>('input[type="range"]')];
      const trackMid = track.top + track.height / 2;
      const offsets = inputs.map((i) => { const b = i.getBoundingClientRect(); return +(b.top + b.height / 2 - trackMid).toFixed(1); });
      // Precondition: a zero-size layout would pass vacuously.
      check(`${name}: laid out (track ${track.width.toFixed(0)}px wide, ${inputs.length} input(s))`, track.width > 100 && inputs.length > 0);
      check(`${name}: every thumb is centred on the track (offsets ${offsets.join(', ')}px)`, offsets.every((o) => Math.abs(o) <= 1));
      // The fix must centre, not shrink: the shared min-height is the touch-target floor.
      const minH = parseFloat(getComputedStyle(inputs[0]).minHeight);
      check(`${name}: the input keeps its min-height (${minH}px)`, minH > 20);
      // Horizontally, the thumb travels the input's CONTENT box while the track and fill are drawn across
      // the full width. The shared size variants padded it (7px sm, 14px lg), so the thumbs stopped short
      // of both ends and drifted off the fill.
      const travel = inputs.map((i) => {
        const cs = getComputedStyle(i);
        return +(i.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - track.width).toFixed(1);
      });
      check(`${name}: the thumb travels the whole track (content width − track width: ${travel.join(', ')}px)`,
        travel.every((d) => Math.abs(d) <= 1));
    }

    // Vertical range mode: the same rule, across the column.
    host.innerHTML = '<div style="height:10rem"><b-range label="V" min="0" max="100" mode="range" orientation="vertical"></b-range></div>';
    await settle();
    const vsr = host.querySelector('b-range')!.shadowRoot!;
    const vt = vsr.querySelector('.range-track')!.getBoundingClientRect();
    const vOff = [...vsr.querySelectorAll('input[type="range"]')].map((i) => {
      const b = i.getBoundingClientRect(); return +(b.left + b.width / 2 - (vt.left + vt.width / 2)).toFixed(1);
    });
    check(`vertical range: laid out (track ${vt.height.toFixed(0)}px tall)`, vt.height > 50);
    check(`vertical range: every thumb is centred on the track (offsets ${vOff.join(', ')}px)`, vOff.length === 2 && vOff.every((o) => Math.abs(o) <= 1));
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] range-geometry-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] range-geometry-smoke ${r}`);
})();
