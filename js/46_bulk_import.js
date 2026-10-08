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
// Depends on globals in the browser: addRow, renumberCuts, renderImageToBox, CutsCaptureSort.

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
  const POOL_IMAGES = 3;        // thumbnails generated at the same time (desktop, or photos only)
  const POOL_WITH_VIDEO = 2;    // touch devices decode only a few videos at once
  const PER_FILE_TIMEOUT = 12000; // ms; a stuck decode must not block the rest

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
      b.className = 'sort-undo';
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

  function loadOne(file, box) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, PER_FILE_TIMEOUT);
      renderImageToBox(file, box, () => {
        clearTimeout(t);
        resolve();
      });
    });
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
    const btn = $('btn-import-media');
    if (btn) btn.disabled = true;
    try {
      const tbody = $('storyboard-body');
      const targets = []; // { file, row }
      const queue = media.slice();
      let ref = null;

      if (options.intoBox) {
        const row = options.intoBox.closest('tr');
        targets.push({ file: queue.shift().file, row });
        ref = row;
      } else {
        const empties = Array.from(tbody.children).filter(isEmptyRow);
        while (queue.length && empties.length) targets.push({ file: queue.shift().file, row: empties.shift() });
      }
      queue.forEach((m) => {
        const row = newRowAfter(ref);
        if (ref) ref = row;
        targets.push({ file: m.file, row });
      });
      renumberCuts();

      const total = targets.length;
      setStatus(`取り込み中… 0 / ${total}`);
      const tasks = targets.map((t) => () => loadOne(t.file, t.row.querySelector('.visual-box')));
      const touch = typeof canHover === 'function' && !canHover();
      const pool = media.some((m) => m.kind === 'video') && touch ? POOL_WITH_VIDEO : POOL_IMAGES;
      await runPool(tasks, pool, (done) => setStatus(`取り込み中… ${done} / ${total}`));
      renumberCuts();

      const first = targets[0].row;
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'start', behavior: 'smooth' });

      let msg = `${total} 件を取り込みました`;
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
      if (btn) btn.disabled = false;
    }
  }

  function setupBulkImport() {
    const btn = $('btn-import-media');
    const input = $('bulk-media-input');
    if (btn && input) {
      btn.addEventListener('click', () => input.click());
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
