// Shared by the smoke suites that assert where focus goes (TASK-489, TASK-496).
//
// Focus is page-global and every suite runs concurrently in one page. Other suites open modal <dialog>s,
// and while one is open everything outside it is inert, so focus() silently does nothing. A focus check
// that lands in that window fails as though the component were broken: measured on picker-popup-smoke,
// failing on a different picker from run to run.
//
// So: wait until the element really takes focus (a precondition the caller asserts), then run the
// keyboard sequence with no await, because nothing can open a modal in the middle of a synchronous one.

/** Resolve true once `el` holds focus within `root`, or false after the deadline. */
export async function focusable(root: ShadowRoot, el: HTMLElement, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    el.focus();
    if (root.activeElement === el) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}
