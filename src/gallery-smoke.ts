// TASK-550 — b-gallery. FlowerFurStudio's product page slots its server-rendered images (primary first) and
// switches image when a variant is picked. What has to hold: one image renders no navigation; thumbnails are
// named by alt and agree with arrows, swipe and show(); the `index` attribute is a start, not a leash; the zoom
// is a modal dialog showing the large source, it closes with focus back on its trigger; a narrow container
// shows dots instead of thumbnails. Scrolling is b-carousel's SlideTrack, so drag is covered there.
import 'birko-web-components/layout';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (cond()) return true; await sleep(20); }
  return cond();
};
const svg = (fill: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${fill}"/><text x="20" y="60" font-size="48">${label}</text></svg>`)}`;

type Gallery = HTMLElement & { index: number; show(i: number): void; openZoom(): void; closeZoom(): void };

void (async () => {
  const results: string[] = [];
  const check = (name: string, ok: boolean) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);

  // SERIALISATION: the zoom is a modal dialog — opening one makes the rest of the page inert, moves focus and
  // light-dismisses any open popover — and the images add decode work. Run concurrently it failed other suites'
  // checks (input-adornment geometry; ribbon-scaling's flyout "in the top layer while open") and its own focus
  // checks. Every suite that opens a dialog / popover or measures geometry it would disturb raises a flag when done.
  {
    const flags = ['__inputAdornmentSmokeDone', '__backportSmokeDone', '__ribbonScalingSmokeDone', '__bareSmokeDone', '__pickerPopupSmokeDone'];
    const w = window as unknown as Record<string, boolean | undefined>;
    const pending = () => flags.filter((f) => w[f] !== true);
    const deadline = Date.now() + 90_000;
    while (pending().length && Date.now() < deadline) await sleep(50);
    check(`the suites a modal would disturb finished first (still running: ${pending().join(', ') || 'none'})`, pending().length === 0);
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;width:36rem;padding:1rem;background:#fff;z-index:99995';
  document.body.prepend(host);

  const imgs = `
    <img src="${svg('#fca', 'A')}" alt="Linen, natural" data-thumb="${svg('#fca', 'a')}" data-full="${svg('#fca', 'A-full')}">
    <img src="${svg('#acf', 'B')}" alt="Linen, blue">
    <img src="${svg('#afc', 'C')}">`;
  const mount = async (html: string) => {
    host.innerHTML = html;
    await sleep(80);
    const el = host.querySelector('b-gallery') as Gallery;
    const sr = el.shadowRoot!;
    // Record announcements: components call ariaNotify where the browser has it (Chrome/Edge do), else a live region.
    const said: string[] = [];
    (el as unknown as { ariaNotify: (t: string) => void }).ariaNotify = (t: string) => { said.push(t); };
    const events: string[] = [];
    for (const n of ['image-change', 'zoom-open', 'zoom-close']) {
      el.addEventListener(n, (e) => events.push(`${n}:${(e as CustomEvent<{ index: number }>).detail.index}`));
    }
    const slides = Array.from(el.children) as HTMLElement[];
    const vp = sr.querySelector<HTMLElement>('.viewport')!;
    return {
      el, sr, events, slides, vp, said,
      thumbs: () => Array.from(sr.querySelectorAll<HTMLButtonElement>('.thumb')),
      prev: () => sr.querySelector<HTMLButtonElement>('.prev.main'),
      next: () => sr.querySelector<HTMLButtonElement>('.next.main'),
      dialog: () => sr.querySelector<HTMLDialogElement>('dialog.zoom')!,
      aligned: (i: number) => Math.abs(slides[i].getBoundingClientRect().left - vp.getBoundingClientRect().left) < 2,
    };
  };
  const inertMap = (slides: HTMLElement[]) => slides.map((s) => (s.inert ? 'i' : 'v')).join('');

  try {
    // ── a shrink-to-fit parent (centred flex column — the Playground card) must not collapse it ──
    {
      host.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;width:30rem"><b-gallery>${imgs}</b-gallery></div>`;
      await sleep(80);
      const g = host.querySelector('b-gallery') as HTMLElement;
      const w = g.getBoundingClientRect().width;
      const iw = (g.children[0] as HTMLElement).getBoundingClientRect().width;
      check(`in a centred flex column the gallery fills its parent (${w.toFixed(0)}px, image ${iw.toFixed(0)}px)`, w > 400 && iw > 400);
    }

    // ── one image ──
    let p = await mount(`<b-gallery><img src="${svg('#ddd', 'only')}" alt="Only"></b-gallery>`);
    check('one image: no arrows and no thumbnails', !p.sr.querySelector('.arrow.main') && p.thumbs().length === 0);
    check('one image: still zoomable, not inert', !!p.sr.querySelector('.zoom-btn') && !p.slides[0].inert);
    check('images stay light DOM', p.slides[0].parentElement === p.el);

    // ── thumbnails ──
    p = await mount(`<b-gallery label="Product images">${imgs}</b-gallery>`);
    check(`three images: three thumbnails (${p.thumbs().length})`, p.thumbs().length === 3);
    check(`thumbnails are named by alt ("${p.thumbs()[1].getAttribute('aria-label')}")`, p.thumbs()[1].getAttribute('aria-label') === 'Linen, blue');
    check(`an image without alt still names its thumbnail ("${p.thumbs()[2].getAttribute('aria-label')}")`, p.thumbs()[2].getAttribute('aria-label') === 'Image 3');
    check('data-thumb is the thumbnail source', decodeURIComponent(p.thumbs()[0].querySelector('img')?.getAttribute('src') ?? '').includes('>a<'));
    check('the first thumbnail is current; others visible-but-not-current', p.thumbs()[0].getAttribute('aria-current') === 'true' && p.thumbs()[1].getAttribute('aria-current') === 'false');
    check(`only the shown image is reachable (${inertMap(p.slides)})`, inertMap(p.slides) === 'vii');
    p.thumbs()[2].click();
    check(`a thumbnail shows its image (index ${p.el.index}) ${JSON.stringify(p.events)}`, p.el.index === 2 && p.events.join() === 'image-change:2');
    check('…and scrolls to it', await waitFor(() => p.aligned(2)));
    check(`…announced ("${p.said.at(-1)}")`, p.said.at(-1) === 'Image 3 of 3: Image 3');
    check('at the end: next disabled', p.next()!.disabled && !p.prev()!.disabled);
    p.prev()!.click();
    check(`previous (${p.el.index})`, p.el.index === 1 && p.thumbs()[1].getAttribute('aria-current') === 'true');
    p.el.show(0);
    check(`show(0) — the variant switch (${p.el.index})`, p.el.index === 0 && await waitFor(() => p.aligned(0)));
    p.el.show(99);
    check(`show past the end clamps (${p.el.index})`, p.el.index === 2);

    // ── index attribute: a start, then a command, never a leash ──
    p = await mount(`<b-gallery index="2">${imgs}</b-gallery>`);
    check(`index="2" starts on image 3 without animating (${p.el.index})`, p.el.index === 2 && p.aligned(2));
    p.el.setAttribute('index', '1');
    check(`setting index moves to it (${p.el.index})`, p.el.index === 1);
    p.thumbs()[0].click();
    p.el.setAttribute('label', 'Changed');
    await sleep(30);
    check(`an unrelated re-render does not snap back to the attribute (${p.el.index})`, p.el.index === 0);

    // ── swipe ──
    p = await mount(`<b-gallery>${imgs}</b-gallery>`);
    p.vp.scrollLeft = p.slides[1].getBoundingClientRect().left - p.vp.getBoundingClientRect().left;
    check('a swipe that settles on image 2 sets the index', await waitFor(() => p.el.index === 1));
    check(`…and the thumbnail follows (${inertMap(p.slides)})`, p.thumbs()[1].getAttribute('aria-current') === 'true' && inertMap(p.slides) === 'ivi');

    // ── zoom ──
    p = await mount(`<b-gallery>${imgs}</b-gallery>`);
    const zoomBtn = p.sr.querySelector<HTMLButtonElement>('.zoom-btn')!;
    check('the zoom button announces a dialog', zoomBtn.getAttribute('aria-haspopup') === 'dialog' && zoomBtn.getAttribute('aria-label') === 'Enlarge image');
    zoomBtn.click();
    const d = p.dialog();
    const zimg = p.sr.querySelector<HTMLImageElement>('.zoom-img')!;
    check('zoom opens as a modal dialog', d.open && d.matches(':modal'));
    check('zoom shows data-full', decodeURIComponent(zimg.getAttribute('src')!).includes('A-full'));
    check(`the dialog is named by the image ("${d.getAttribute('aria-label')}")`, d.getAttribute('aria-label') === 'Linen, natural' && zimg.alt === 'Linen, natural');
    check(`the counter reads "${p.sr.querySelector('.zoom-count')?.textContent}"`, p.sr.querySelector('.zoom-count')?.textContent === '1 / 3');
    p.sr.querySelector<HTMLButtonElement>('.next.in-zoom')!.click();
    check('next inside the zoom moves both', p.el.index === 1 && decodeURIComponent(zimg.getAttribute('src')!).includes('>B<') && d.getAttribute('aria-label') === 'Linen, blue');
    zimg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    check('a click on the large image magnifies it', p.sr.querySelector('.zoom-pane')!.classList.contains('magnified'));
    // Read focus inside the close event, right after the gallery's own handler: other suites move focus too,
    // and nothing can run between two listeners of one dispatch.
    let focusOnClose: Element | null = null;
    d.addEventListener('close', () => { focusOnClose = p.sr.activeElement; }, { once: true });
    p.sr.querySelector<HTMLButtonElement>('.close-btn')!.click();
    await sleep(30);
    check('close closes it, and resets the magnifier', !d.open && !p.sr.querySelector('.zoom-pane')!.classList.contains('magnified'));
    check(`focus returns to the zoom button (${(focusOnClose as Element | null)?.className ?? 'nothing focused'})`, focusOnClose === zoomBtn);
    check(`zoom events ${JSON.stringify(p.events)}`, p.events.includes('zoom-open:0') && p.events.includes('zoom-close:1'));
    p.slides[1].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    check('a click on the main image opens the zoom too', d.open);
    d.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('a click on the backdrop closes it', !d.open);
    // zoom-close-outside: off by default, then opt-in.
    const pane = () => p.sr.querySelector<HTMLElement>('.zoom-pane')!;
    zoomBtn.click();
    pane().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('by default a click beside the image keeps the zoom open', d.open);
    p.el.setAttribute('zoom-close-outside', '');
    pane().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    check('with zoom-close-outside a click beside the image closes it', !d.open);
    zoomBtn.click();
    zimg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    check('…while a click on the image itself still magnifies, not closes', d.open && pane().classList.contains('magnified'));
    p.el.closeZoom();
    p.el.removeAttribute('zoom-close-outside');

    // ── srcset: the zoom takes the largest candidate, not the one picked for the small main image ──
    {
      const blob = (label: string) => URL.createObjectURL(new Blob([decodeURIComponent(svg('#eee', label).split(',')[1])], { type: 'image/svg+xml' }));
      const small = blob('small');
      const big = blob('big');
      const q = await mount(`<b-gallery><img src="${small}" srcset="${small} 300w, ${big} 1200w" sizes="300px" alt="Set"></b-gallery>`);
      q.el.openZoom();
      const src = q.sr.querySelector<HTMLImageElement>('.zoom-img')!.getAttribute('src');
      q.el.closeZoom();
      check('without data-full the zoom takes the largest srcset candidate', src === big);
      URL.revokeObjectURL(small);
      URL.revokeObjectURL(big);
      p = await mount(`<b-gallery>${imgs}</b-gallery>`);
    }

    // ── narrow container: dots instead of thumbnails ──
    host.style.width = '18rem';
    await sleep(60);
    const t0 = p.thumbs()[0];
    check('narrow: thumbnail images hidden, dots shown',
      getComputedStyle(t0.querySelector('img')!).display === 'none' && getComputedStyle(t0.querySelector('.pip')!).display === 'block');
    check(`narrow: the dot keeps a 24px target (${t0.getBoundingClientRect().width.toFixed(0)}px)`, t0.getBoundingClientRect().width >= 24);
    host.style.width = '36rem';
    await sleep(60);
    check('wide: thumbnails are back', getComputedStyle(t0.querySelector('img')!).display !== 'none');
    // A ~400px desktop product column (the Playground card) keeps thumbnails; only a phone column gets dots.
    host.style.width = '31rem'; // ~406px of gallery under the 14px root — the card's width
    await sleep(60);
    check(`a ~400px column keeps thumbnails (gallery ${p.el.getBoundingClientRect().width.toFixed(0)}px)`, getComputedStyle(t0.querySelector('img')!).display !== 'none');
    host.style.width = '36rem';
    await sleep(60);

    // ── slotchange ──
    const extra = document.createElement('img');
    extra.src = svg('#ccc', 'D');
    extra.alt = 'Linen, grey';
    p.el.append(extra);
    await sleep(60);
    check(`an added image adds a thumbnail (${p.thumbs().length})`, p.thumbs().length === 4 && p.thumbs()[3].getAttribute('aria-label') === 'Linen, grey');
  } catch (e) {
    check(`unexpected throw: ${(e as Error).message}`, false);
  }
  host.querySelector<HTMLElement & { closeZoom?(): void }>('b-gallery')?.closeZoom?.();
  host.remove();
  // modal-focus-smoke opens a modal too, so it waits for this one.
  (window as unknown as Record<string, boolean>).__gallerySmokeDone = true;

  const passed = results.filter((r) => r.startsWith('PASS')).length;
  console.log(`[playground] gallery-smoke: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`[playground] gallery-smoke ${r}`);
})();
