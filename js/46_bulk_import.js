// js/46_bulk_import.js
// Import many photos / videos at once. Each file becomes one cut.
//
// Entry points
//   - IMPORT MEDIA button  -> multi-select file picker (phones: the photo library picker)
//   - drop files anywhere on the page -> same import
//   - drop several files on one cut's visual box -> the first fills that cut, the rest are
//     inserted as new cuts right after it
//
// Placement: empty cuts (no visual and no caption) are filled from the top first, the remaining
// files are appended as new cuts. Files keep the order the picker / drop provides. After an import
// the status line offers "撮影日時順に並べる" (see 45_capture_sort.js).
//
// classifyFile() is a pure function so it can be tested in Node (scripts/bulk_import_smoke.js).
//
// Importing is cheap and instant: every file is registered (name, badge, source duration from the file header)
// without decoding it. Thumbnails are created lazily, only for cuts that are on screen (js/47_lazy_thumbs.js),
// so hundreds of clips cost no decoder memory and no waiting.
//
// Depends on globals in the browser: addRow, renumberCuts, registerVisualLazy, applySourceDuration,
// CutsMediaMeta, CutsLazyThumbs, CutsCaptureSort.

(function (root) {
  'use strict';

  const IMAGE_EXT = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  };
  const VIDEO_EXT = {
    mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm',
    '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
  };
  const META_POOL = 8;          // header reads are cheap, so many can run at once

  // -> { file, kind: 'image' | 'video' } or null (not a photo / video).
  // Files with an empty MIME type (common for HEIC / MOV on desktop browsers) get one from the extension,
  // keeping the same bytes and lastModified.
  function classifyFile(file) {
    if (!file) return null;
    const type = String(file.type || '').toLowerCase();
    if (type.startsWith('image/')) return { file, kind: 'image' };
    if (type.startsWith('video/')) return { file, kind: 'video' };
    const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
    const ext = m ? m[1].toLowerCase() : '';
    const mime = IMAGE_EXT[ext] || VIDEO_EXT[ext];
    if (!mime) return null;
    const typed = new File([file], file.name, { type: mime, lastModified: file.lastModified });
    return { file: typed, kind: mime.startsWith('video/') ? 'video' : 'image' };
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  let importing = false;

  const $ = (id) => document.getElementById(id);

  function setStatus(text, actionLabel, onAction) {
    const el = $('import-status');
    if (!el) return;
    el.textContent = text || '';
    if (actionLabel && onAction) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'status-action';
      b.textContent = actionLabel;
      b.addEventListener('click', onAction);
      el.appendChild(document.createTextNode(' '));
      el.appendChild(b);
    }
  }

  function isEmptyRow(row) {
    const box = row.querySelector('.visual-box');
    const cap = row.querySelector('.input-audio');
    const hasVisual = !!(box && box.dataset && box.dataset.assetId);
    const hasCaption = !!(cap && cap.textContent.trim());
    return !hasVisual && !hasCaption;
  }

  // Append a new cut (via addRow) and move it right after `ref` when given.
  function newRowAfter(ref) {
    const tbody = $('storyboard-body');
    addRow();
    const row = tbody.lastElementChild;
    if (ref) {
      const next = ref.nextElementSibling;
      if (next !== row) tbody.insertBefore(row, next);
    }
    return row;
  }

  async function runPool(tasks, limit, onStep) {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const i = next++;
        await tasks[i]();
        done += 1;
        onStep(done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  }

  async function bulkImportFiles(fileList, opts) {
    const options = opts || {};
    if (importing) {
      setStatus('取り込み中です。完了までお待ちください');
      return;
    }
    const media = [];
    let skipped = 0;
    Array.from(fileList || []).forEach((f) => {
      const c = classifyFile(f);
      if (c) media.push(c);
      else skipped += 1;
    });
    if (!media.length) {
      setStatus(skipped ? `画像・動画が見つかりませんでした（${skipped} 件をスキップ）` : '');
      return;
    }

    importing = true;
    const btns = ['btn-import-media', 'btn-import-hero'].map($).filter(Boolean);
    btns.forEach((b) => { b.disabled = true; });
    try {
      const tbody = $('storyboard-body');
      const targets = []; // { file, row }
      const queue = media.slice();
      let ref = null;

      if (options.intoBox) {
        const row = options.intoBox.closest('tr');
        const first = queue.shift();
        targets.push({ file: first.file, kind: first.kind, row });
        ref = row;
      } else {
        const empties = Array.from(tbody.children).filter(isEmptyRow);
        while (queue.length && empties.length) {
          const m = queue.shift();
          targets.push({ file: m.file, kind: m.kind, row: empties.shift() });
        }
      }
      queue.forEach((m) => {
        const row = newRowAfter(ref);
        if (ref) ref = row;
        targets.push({ file: m.file, kind: m.kind, row });
      });
      renumberCuts();

      const total = targets.length;
      // 1) register every file right away (no decoding)
      targets.forEach((t) => {
        const box = t.row.querySelector('.visual-box');
        registerVisualLazy(t.file, t.kind, box);
        t.box = box;
        if (root.CutsLazyThumbs) root.CutsLazyThumbs.observe(box);
      });

      // 2) read each video's length from its file header (a few small reads per file)
      const videos = targets.filter((t) => t.kind === 'video');
      if (videos.length && root.CutsMediaMeta) {
        setStatus(`取り込み中… 0 / ${videos.length}`);
        const tasks = videos.map((t) => async () => {
          const m = await root.CutsMediaMeta.readVideoMeta(t.file);
          if (m && m.durationSec) applySourceDuration(t.box, m.durationSec, { skipRecalc: true });
        });
        await runPool(tasks, META_POOL, (done) => setStatus(`取り込み中… ${done} / ${videos.length}`));
      }
      if (typeof recalcStartTimes === 'function') recalcStartTimes();
      renumberCuts();

      const first = targets[0].row;
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'start', behavior: 'smooth' });

      let msg = `${total} 件を取り込みました（サムネイルは表示される範囲から順に作成します）`;
      if (skipped) msg += `（画像・動画以外 ${skipped} 件をスキップ）`;
      const sorter = root.CutsCaptureSort;
      if (total >= 2 && sorter && typeof sorter.sortRowsByCaptureTime === 'function') {
        setStatus(msg, '撮影日時順に並べる', () => sorter.sortRowsByCaptureTime());
      } else {
        setStatus(msg);
      }
    } catch (err) {
      console.error(err);
      setStatus('取り込みに失敗しました');
    } finally {
      importing = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  // The big IMPORT MEDIA call to action is only for the empty start screen: hidden as soon as any cut has media.
  function setupImportHero() {
    const hero = $('import-hero');
    if (!hero) return;
    const update = () => { hero.hidden = !!document.querySelector('#storyboard-body .visual-box[data-asset-id]'); };
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; update(); });
    };
    const body = $('storyboard-body');
    if (body && typeof MutationObserver !== 'undefined') {
      new MutationObserver(schedule).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-asset-id'] });
    }
    update();
  }

  function setupBulkImport() {
    const btn = $('btn-import-media');
    const hero = $('btn-import-hero');
    const input = $('bulk-media-input');
    setupImportHero();
    if (input) {
      [btn, hero].filter(Boolean).forEach((b) => b.addEventListener('click', () => input.click()));
    }
    if (btn && input) {
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = ''; // allow picking the same files again
        if (files.length) bulkImportFiles(files);
      });
    }

    // Drop files anywhere on the page. Handlers on a visual box / BGM box run first and call
    // preventDefault, so those drops are skipped here (e.defaultPrevented).
    const banner = document.createElement('div');
    banner.className = 'drop-banner';
    banner.textContent = 'Drop photos / videos to import';
    document.body.appendChild(banner);

    const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
    let depth = 0;
    document.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth += 1;
      banner.classList.add('is-visible');
    });
    document.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // otherwise the browser would open the file
    });
    document.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) banner.classList.remove('is-visible');
    });
    document.addEventListener('drop', (e) => {
      depth = 0;
      banner.classList.remove('is-visible');
      if (!hasFiles(e)) return;
      const alreadyHandled = e.defaultPrevented; // a visual box / BGM box drop handler ran first
      e.preventDefault(); // never navigate away to the dropped file
      if (alreadyHandled) return;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) bulkImportFiles(files);
    });
  }

  const api = { classifyFile, bulkImportFiles, setupBulkImport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CutsBulkImport = api;
  root.bulkImportFiles = bulkImportFiles;
  root.setupBulkImport = setupBulkImport;
})(typeof window !== 'undefined' ? window : globalThis);
