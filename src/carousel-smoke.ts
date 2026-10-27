// TASK-549 — b-carousel. FlowerFurStudio's hero, category tiles and product rows are server-rendered slides,
// so the component may only enhance light-DOM content. What has to hold: one page of slides renders no
// controls; arrows, dots, native swipe and a mouse drag all land on a slide and agree on the index; off-screen
// slides are inert; per-view comes from CSS so breakpoints are the consumer's; autoplay pauses on hover, stops
// for good on focus, has a visible stop/start control and never starts under prefers-reduced-motion.
import 'birko-web-components/layout';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};

type Carousel = HTMLElement & { index: number; next(): void; prev(): void; goTo(i: number): void };

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:24rem;padding:1rem;background:#fff;z-index:99996';
  document.body.prepend(host);

  const slidesHtml = (n: number, extra = '') =>
    Array.from({ length: n }, (_, i) => `<div style="height:4rem;background:#eee" ${extra}>S${i + 1}</div>`).join('');
  const mount = async (attrs: string, n: number) => {
    host.innerHTML = `<b-carousel ${attrs}>${slidesHtml(n)}</b-carousel>`;
    await sleep(60);
    const el = host.querySelector('b-carousel') as Carousel;
    const sr = el.shadowRoot!;
    // Record announcements: components call ariaNotify where the browser has it (Chrome/Edge do), else a live region.
    const said: string[] = [];
    (el as unknown as { ariaNotify: (t: string) => void }).ariaNotify = (t: string) => { said.push(t); };
    const events: number[] = [];
    el.addEventListener('slide-change', (e) => events.push((e as CustomEvent<{ index: number }>).detail.index));
    const slides = Array.from(el.children) as HTMLElement[];
    const vp = sr.querySelector<HTMLElement>('.viewport')!;
    return {
      el, sr, events, slides, vp,
      prevBtn: () => sr.querySelector<HTMLButtonElement>('.prev'),
      nextBtn: () => sr.querySelector<HTMLButtonElement>('.next'),
      dots: () => Array.from(sr.querySelectorAll<HTMLButtonElement>('.dot')),
      /** Slide i's start sits at the viewport's start (the scroll has landed there). */
      aligned: (i: number) => Math.abs(slides[i].getBoundingClientRect().left - vp.getBoundingClientRect().left) < 2,
      status: () => said.at(-1) ?? '',
    };
  };
  const inertMap = (slides: HTMLElement[]) => slides.map((s) => (s.inert ? 'i' : 'v')).join('');

  try {
    // ── a shrink-to-fit parent must not shrink it to one slide's content ──
    {
      host.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;width:20rem"><b-carousel>${slidesHtml(3)}</b-carousel></div>`;
      await sleep(60);
      const w = (host.querySelector('b-carousel') as HTMLElement).getBoundingClientRect().width;
      check(`in a centred flex column the carousel fills its parent (${w.toFixed(0)}px)`, w > 250);
    }

    // ── one slide ──
    let p = await mount('autoplay="100"', 1);
    check('one slide: no arrows, dots or rotation control',
      !p.sr.querySelector('.arrow') && !p.sr.querySelector('.dot') && !p.sr.querySelector('.rotation'));
    check('one slide: not inert, visible', !p.slides[0].inert && p.slides[0].getBoundingClientRect().width > 0);
    check('slides stay light DOM (server-rendered content is never moved)', p.slides[0].parentElement === p.el);

    // ── three slides: arrows, dots, inert ──
    p = await mount('label="Hero"', 3);
    check(`three slides: two arrows and three dots (${p.dots().length})`, !!p.prevBtn() && !!p.nextBtn() && p.dots().length === 3);
    check('at the start: previous disabled, next enabled', p.prevBtn()!.disabled && !p.nextBtn()!.disabled);
    check(`only the visible slide is reachable (${inertMap(p.slides)})`, inertMap(p.slides) === 'vii');
    p.nextBtn()!.click();
    check(`next: index 1 at once (${p.el.index}), one slide-change ${JSON.stringify(p.events)}`, p.el.index === 1 && p.events.join() === '1');
    check('next: lands on slide 2', await waitFor(() => p.aligned(1)));
    check(`next: inert follows (${inertMap(p.slides)})`, inertMap(p.slides) === 'ivi');
    check(`next: announced ("${p.status()}")`, p.status() === 'Slide 2 of 3');
    check('next: the second dot is current', p.dots()[1].getAttribute('aria-current') === 'true' && p.dots()[0].getAttribute('aria-current') === 'false');
    await sleep(250);
    check(`the settled scroll does not re-emit ${JSON.stringify(p.events)}`, p.events.join() === '1');
    p.nextBtn()!.click();
    check('at the end: next disabled', p.el.index === 2 && p.nextBtn()!.disabled);
    p.el.next();
    check('next() at the end without loop stays', p.el.index === 2);
    p.dots()[0].click();
    check('a dot goes to its slide', p.el.index === 0 && await waitFor(() => p.aligned(0)));

    // ── ARIA ──
    const section = p.sr.querySelector('section')!;
    check('the region is a named carousel', section.getAttribute('aria-roledescription') === 'carousel' && section.getAttribute('aria-label') === 'Hero');
    check(`slides are named groups ("${p.slides[1].getAttribute('aria-label')}")`,
      p.slides[1].getAttribute('role') === 'group' && p.slides[1].getAttribute('aria-roledescription') === 'slide' && p.slides[1].getAttribute('aria-label') === '2 of 3');
    check('arrows and dots are named', p.prevBtn()!.getAttribute('aria-label') === 'Previous slide' && p.dots()[2].getAttribute('aria-label') === 'Slide 3');

    // a consumer's own label is kept; slotchange re-counts; a removed slide is cleaned up
    host.innerHTML = '<b-carousel><div aria-label="Summer sale">A</div><div>B</div></b-carousel>';
    await sleep(60);
    const c2 = host.querySelector('b-carousel') as Carousel;
    const [a, b] = Array.from(c2.children) as HTMLElement[];
    check(`a slide's own aria-label is kept ("${a.getAttribute('aria-label')}")`, a.getAttribute('aria-label') === 'Summer sale' && b.getAttribute('aria-label') === '2 of 2');
    const extra = document.createElement('div');
    extra.textContent = 'C';
    c2.append(extra);
    await sleep(60);
    check(`slotchange: a third slide adds a dot (${c2.shadowRoot!.querySelectorAll('.dot').length}) and is named`,
      c2.shadowRoot!.querySelectorAll('.dot').length === 3 && extra.getAttribute('aria-label') === '3 of 3');
    b.remove();
    await sleep(60);
    check('a removed slide loses what the carousel put on it',
      !b.hasAttribute('aria-roledescription') && !b.hasAttribute('role') && !b.hasAttribute('aria-label') && !b.inert);
    check(`…and the rest are renumbered ("${extra.getAttribute('aria-label')}")`, extra.getAttribute('aria-label') === '2 of 2');

    // ── a busy page (TASK-745) ──
    // A main-thread stall in the middle of a smooth scroll: the 150ms scroll debounce used to fire then and settle on
    // the slide the scroll had reached, so the index jumped back and slide-change fired for a slide nobody chose. Where
    // the engine has scrollend, only scrollend settles.
    if ('onscrollend' in window) {
      p = await mount('', 5);
      p.el.goTo(4);
      await new Promise<void>((res) => p.vp.addEventListener('scroll', () => res(), { once: true }));
      const until = performance.now() + 250;
      while (performance.now() < until) { /* stall, as a busy page does */ }
      const landed = await waitFor(() => p.aligned(4) || p.vp.scrollLeft >= p.vp.scrollWidth - p.vp.clientWidth - 1);
      await sleep(250);
      check(`a stall mid-scroll settles once, on the chosen slide (${p.el.index}, ${JSON.stringify(p.events)}, landed ${landed})`,
        landed && p.el.index === 4 && p.events.join() === '4');
      // But a user who takes over mid-scroll wins: the slide their scroll rests on is the answer, not the old target.
      p = await mount('', 5);
      p.el.goTo(4);
      await new Promise<void>((res) => p.vp.addEventListener('scroll', () => res(), { once: true }));
      p.vp.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      p.vp.scrollTo({ left: p.slides[1].getBoundingClientRect().left - p.vp.getBoundingClientRect().left + p.vp.scrollLeft, behavior: 'auto' });
      await waitFor(() => p.el.index === 1, 1500);
      await sleep(250);
      check(`a user scroll during a programmatic one settles where the user left it (${p.el.index}, ${JSON.stringify(p.events)})`,
        p.el.index === 1 && p.events.at(-1) === 1 && p.aligned(1));
    }

    // ── loop ──
    p = await mount('loop', 3);
    check('loop: previous is enabled at the start', !p.prevBtn()!.disabled);
    p.prevBtn()!.click();
    check(`loop: previous from the first goes to the last (${p.el.index})`, p.el.index === 2);
    p.nextBtn()!.click();
    check(`loop: next from the last goes to the first (${p.el.index})`, p.el.index === 0);

    // ── per-view ──
    p = await mount('per-view="2"', 5);
    check(`per-view 2 of 5: four positions (${p.dots().length})`, p.dots().length === 4);
    const w0 = p.slides[0].getBoundingClientRect().width;
    const vw = p.vp.clientWidth;
    check(`per-view 2: a slide is half the viewport less half a gap (${w0.toFixed(1)} of ${vw})`, w0 > vw * 0.4 && w0 < vw * 0.5);
    check(`per-view 2: two slides reachable (${inertMap(p.slides)})`, inertMap(p.slides) === 'vviii');
    p.el.goTo(10);
    check(`goTo past the end clamps to the last page (${p.el.index})`, p.el.index === 3 && inertMap(p.slides) === 'iiivv');
    check('…and lands at the end', await waitFor(() => p.aligned(3)));
    // A consumer breakpoint: their CSS sets the property, and the resize that comes with it re-pages.
    p.el.style.setProperty('--b-carousel-per-view', '3');
    host.style.width = '30rem';
    check('a consumer --b-carousel-per-view wins and re-pages on resize', await waitFor(() => p.dots().length === 3));
    check(`…the index is clamped to the new last page (${p.el.index})`, p.el.index === 2);
    host.style.width = '24rem';

    // ── native swipe (the viewport scrolls) ──
    p = await mount('', 3);
    p.vp.scrollLeft = p.slides[2].getBoundingClientRect().left - p.vp.getBoundingClientRect().left;
    check('a swipe that settles on slide 3 sets the index', await waitFor(() => p.el.index === 2));
    check(`…emits slide-change ${JSON.stringify(p.events)}`, p.events.join() === '2');
    check(`…and moves inert (${inertMap(p.slides)})`, inertMap(p.slides) === 'iiv');

    // ── mouse drag ──
    p = await mount('', 3);
    let slideClicks = 0;
    p.slides[0].addEventListener('click', () => slideClicks++);
    const r = p.vp.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const ptr = (type: string, x: number) => p.vp.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse', pointerId: 7, button: 0, clientX: x, clientY: y, bubbles: true, composed: true }));
    ptr('pointerdown', r.left + 300);
    ptr('pointermove', r.left + 280);
    ptr('pointermove', r.left + 240);
    check('dragging: snap is off while the mouse holds the track', p.vp.classList.contains('dragging'));
    ptr('pointerup', r.left + 240);
    p.slides[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    check('the click that ends a drag does not reach the slide', slideClicks === 0);
    check('a 60px mouse drag moves one slide', await waitFor(() => p.el.index === 1 && p.aligned(1)));
    check('the drag class is gone', !p.vp.classList.contains('dragging'));
    p.slides[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    check('a later click reaches the slide', slideClicks === 1);

    // ── autoplay ──
    p = await mount('autoplay="150"', 3);
    const rot = () => p.sr.querySelector<HTMLButtonElement>('.rotation');
    check(`autoplay: a stop control is visible ("${rot()?.getAttribute('aria-label')}")`, rot()?.getAttribute('aria-label') === 'Stop automatic slide show' && rot()!.getBoundingClientRect().width > 0);
    check('autoplay: advances on its own', await waitFor(() => p.el.index === 1, 2000));
    check(`autoplay: an automatic step is not announced ("${p.status()}")`, p.status() === '');
    p.el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    let at = p.el.index;
    await sleep(450);
    check(`autoplay: hover pauses (${at} → ${p.el.index})`, p.el.index === at);
    p.el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    check('autoplay: leaving resumes', await waitFor(() => p.el.index !== at, 2000));
    p.el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    at = p.el.index;
    await sleep(450);
    check(`autoplay: focus entering stops it (${at} → ${p.el.index})`, p.el.index === at);
    check(`…and the control now offers start ("${rot()?.getAttribute('aria-label')}")`, rot()?.getAttribute('aria-label') === 'Start automatic slide show');
    rot()!.click();
    check('autoplay: start resumes it', await waitFor(() => p.el.index !== at, 2000));
    rot()!.click();
    at = p.el.index;
    await sleep(450);
    check('autoplay: stop stops it', p.el.index === at);

    // Focus that came BEFORE autoplay existed must not stop it (owner's test: Tab through, then switch autoplay on).
    p = await mount('', 3);
    p.el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    p.el.setAttribute('autoplay', '150');
    await sleep(30);
    check(`autoplay switched on after a focus starts playing ("${rot()?.getAttribute('aria-label')}")`,
      rot()?.getAttribute('aria-label') === 'Stop automatic slide show');
    check('…and advances', await waitFor(() => p.el.index === 1, 2000));

    // ── rotation-control="hover" (TASK-777): hidden at rest, still a tab stop. Shown by hover and focus within is
    // keyboard-check.mjs's: verify.mjs's page never holds document focus (document.hasFocus() is false), so a
    // programmatic focus here does not match :focus-within ──
    const look = () => { const cs = getComputedStyle(rot()!); return `${cs.opacity}/${cs.pointerEvents}/${cs.display === 'none' ? 'gone' : 'laid-out'}`; };
    p = await mount('autoplay="5000"', 3);
    check(`default: the control is shown at rest (${look()})`, look() === '1/auto/laid-out');
    p = await mount('autoplay="5000" rotation-control="hover"', 3);
    check(`hover mode: hidden at rest, takes no pointer input, still laid out (${look()})`, look() === '0/none/laid-out');
    check('hover mode: still named and a tab stop', rot()!.getAttribute('aria-label') === 'Stop automatic slide show' && rot()!.tabIndex === 0);
    host.innerHTML = '';

    // ── reduced motion: autoplay never starts ──
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => (q.includes('prefers-reduced-motion')
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList
      : realMatchMedia.call(window, q))) as typeof window.matchMedia;
    try {
      p = await mount('autoplay="100"', 3);
      await sleep(400);
      check(`reduced motion: no autoplay and no rotation control (index ${p.el.index})`, p.el.index === 0 && !p.sr.querySelector('.rotation'));
      p.nextBtn()!.click();
      check('reduced motion: arrows jump without animation', p.aligned(1));
    } finally {
      window.matchMedia = realMatchMedia;
    }
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.remove();

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  // Its drag and autoplay checks are timing-sensitive; sync-retry-smoke's IndexedDB churn waits for this flag.
  (window as unknown as { __carouselSmokeDone?: boolean }).__carouselSmokeDone = true;
  console.log(`[playground] carousel-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] carousel-smoke ${r}`);
})();
