// Headless driver for the grid benchmark — verify.mjs surfaces the `[playground]` lines.
import { runGridBench } from './grid-bench.js';

void (async () => {
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(stage);
  try {
    // 500 rows = the unpaged worst case the task names; 30 = what a paged or virtualised grid actually
    // renders. The recommendation depends on which regime the table is in, so measure both.
    await runGridBench(stage, 3, 500);
    await runGridBench(stage, 3, 30);
  } catch (e) {
    console.log(`[playground] grid-bench FAILED: ${(e as Error).message}`);
  }
  stage.remove();
})();
