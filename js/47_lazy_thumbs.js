// js/47_lazy_thumbs.js
// Create thumbnails only for the cuts that are on screen (or about to be).
//
// Decoding a video for its thumbnail costs ~0.4 s of CPU and a few hundred MB of decoder memory per
// clip, which is what made large batches slow and heavy. Importing now registers every file
// instantly (name + badge + duration from the file header) and this queue builds thumbnails lazily:
//   - an IntersectionObserver (700 px margin) enqueues cuts as they approach the viewport;
//   - at most 3 thumbnails run at once (2 on touch devices);
//   - the cut closest to the middle of the screen goes first, so fast scrolling stays responsive;
//   - cuts that leave the viewport before their turn are dropped from the queue (and re-queued if they return);
//   - a thumbnail that fails or times out is left as a name-only cut (never retried in a loop).
//
// Depends on globals in the browser: assetStore, renderImageToBox, makeVideoThumbDataUrl, renderThumbToVisualBox,
// escapeHtml, canHover.

(function (root) {
  'use strict';

  const TIMEOUT_MS = 15000;
  const queue = [];
  const waiting = new Set();
  const dist = new WeakMap(); // box -> distance to the screen centre, taken from the last IntersectionObserver entry
  let active = 0;
  let io = null;

  const limit = () => (typeof canHover === 'function' && !canHover() ? 2 : 3);

  function needsThumb(box) {
    return !!(box && box.isConnected && box.dataset && box.dataset.assetId && box.dataset.thumbState !== 'done' && !box.querySelector('img'));
  }

  function dequeue(box) {
    if (waiting.delete(box)) {
      const i = queue.indexOf(box);
      if (i >= 0) queue.splice(i, 1);
    }
  }

  function enqueue(box) {
    if (waiting.has(box) || box.dataset.thumbState === 'busy' || !needsThumb(box)) return;
    waiting.add(box);
    queue.push(box);
  }

  function forget(box) {
    dequeue(box);
    if (io) { try { io.unobserve(box); } catch (_) {} }
  }

  // Never read layout here: while an import is updating hundreds of rows, a getBoundingClientRect() per
  // queued cut forced a full table layout each time (about a second of freezing). The distances come from
  // the IntersectionObserver entries instead.
  function pickNext() {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const d = dist.has(queue[i]) ? dist.get(queue[i]) : Infinity;
      if (d < bestDist || best < 0) { bestDist = d; best = i; }
    }
    return best < 0 ? null : queue.splice(best, 1)[0];
  }

  function pump() {
    while (active < limit() && queue.length) {
      const box = pickNext();
      if (!box) break;
      waiting.delete(box);
      if (!needsThumb(box)) { forget(box); continue; }
      run(box);
    }
  }

  async function run(box) {
    active += 1;
    box.dataset.thumbState = 'busy';
    const file = assetStore.get(box.dataset.assetId);
    try {
      if (file && box.dataset.kind === 'video') {
        const id = box.dataset.assetId;
        const url = await makeVideoThumbDataUrl(file);
        // the cut may have been cleared or given another file while we decoded
        if (url && box.dataset.assetId === id && !box.querySelector('img')) {
          const name = escapeHtml(box.dataset.filename || file.name || '');
          renderThumbToVisualBox(box, 'video', name, url);
          const badge = box.querySelector('.kind-badge');
          if (badge && box.dataset.sourceDuration) badge.textContent = `VID ${box.dataset.sourceDuration}s`;
        }
      } else if (file) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, TIMEOUT_MS);
          renderImageToBox(file, box, () => { clearTimeout(t); resolve(); }, { keepAsset: true });
        });
      }
    } catch (_) { /* leave it as a name-only cut */ }
    box.dataset.thumbState = 'done';
    forget(box);
    active -= 1;
    pump();
  }

  function ensureObserver() {
    if (io || typeof IntersectionObserver === 'undefined') return io;
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const root = e.rootBounds;
        if (root) dist.set(e.target, Math.abs(e.boundingClientRect.top + e.boundingClientRect.height / 2 - (root.top + root.height / 2)));
        if (e.isIntersecting) enqueue(e.target); else dequeue(e.target);
      });
      pump();
    }, { rootMargin: '700px 0px', threshold: [0, 0.5, 1] });
    return io;
  }

  // Start watching a cut's visual box; its thumbnail is built when it gets close to the viewport.
  function observe(box) {
    if (!needsThumb(box)) return;
    if (!box.dataset.thumbState) box.dataset.thumbState = 'pending';
    if (ensureObserver()) {
      io.observe(box);
    } else {
      enqueue(box); // no IntersectionObserver: build them all, a few at a time
      pump();
    }
  }

  function observeAll() {
    document.querySelectorAll('.visual-box[data-asset-id]').forEach(observe);
  }

  root.CutsLazyThumbs = { observe, observeAll, forget, pump };
})(typeof window !== 'undefined' ? window : globalThis);
