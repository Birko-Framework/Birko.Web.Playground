// Launches the browser every check drives, so a page keeps rendering and keeps focus whatever the desktop is doing.
//
// Two things the machine can take away from a headless page, and both break checks that are not wrong:
//  - Focus. A page whose window is not the focused one gets no `focus` / `focusin` events and
//    `document.hasFocus()` is false (`el.focus()` still moves `activeElement`). Sortable and tree-sort
//    keyboard moves, a modal returning focus to its opener, a toolbar's arrow keys and the ribbon's key tips
//    all follow focus by those events. Chrome's focus emulation makes every page the focused one.
//  - Rendering. A page Chrome treats as hidden draws no animation frames and runs no resize observers:
//    auto-scroll, carousel drags and the ribbon's overflow chevrons stop. On Windows, Chrome computes whether a
//    window is covered (`CalculateNativeWinOcclusion`) and hides a covered one; that computation is turned off.
// Measured 2026-11-02 21:34: verify.mjs failed 26 such checks on an unchanged main, keyboard-check and
// sortable-drag-check failed beside it, and the next morning all of them passed on the same code. Nothing else of
// ours ran at the time; the screen was probably locked (the user). NOT reproduced: another tab, another window, a
// headed browser and a probe across 2026-11-03 09:00-09:05 left a plain headless page focused and drawing. So the
// cause is unconfirmed; both guards stay because they make the checks independent of the desktop either way.
//
// Firefox has no CDP session and no such feature, so it is launched as it is.
import puppeteer from 'puppeteer';

export async function focusPage(page) {
  const session = await page.createCDPSession();
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
}

export async function launchBrowser(options = {}) {
  if (options.browser === 'firefox') return puppeteer.launch(options);
  // Chrome honours only the last --disable-features, so the feature joins puppeteer's own list. defaultArgs()
  // already carries options.args.
  const defaults = await puppeteer.defaultArgs(options);
  const args = defaults.map(a => a.startsWith('--disable-features=') ? `${a},CalculateNativeWinOcclusion` : a);
  if (!args.some(a => a.startsWith('--disable-features='))) args.push('--disable-features=CalculateNativeWinOcclusion');
  const browser = await puppeteer.launch({ ...options, ignoreDefaultArgs: true, args });
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await focusPage(page);
    return page;
  };
  return browser;
}
