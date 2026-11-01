// js/48_media_link.js
// "LINK MEDIA": keep media out of ZIPs. Each save / export otherwise copies every clip (a 300-clip project is
// ~2 GB per SAVE ZIP, and every save bumps the version, so downloads pile up).
//
//   LINK MEDIA on  -> SAVE ZIP writes a lite project (manifest + thumbnails + each file's name / size / length)
//                  -> EXPORT NLE writes the XML only and points it at the original files
//                     (MEDIA FOLDER + original file name; blank MEDIA FOLDER = relative, Premiere relinks once)
//   LOAD ZIP of a lite project -> cuts come back with thumbnails and are flagged "未リンク"; RELINK MEDIA matches
//                     the originals again by name + size (pick the folder that holds them).
//
// matchRelink() and uniqueNames() are pure so they can be tested in Node (scripts/media_link_smoke.js).
//
// Depends on globals in the browser: assetStore, registerAssetWithId, CutsLazyThumbs, CutsMediaMeta,
// applySourceDuration, setBusyStatus.

(function (root) {
  'use strict';

  const LINK_KEY = 'cuts.linkMedia';
  const FOLDER_KEY = 'cuts.mediaFolder';

  // ---------------------------------------------------------------------------
  // pure helpers
  // ---------------------------------------------------------------------------
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase();

  // wanted: [{ assetId, name, size|null }]; files: File[] (anywhere in the chosen folder tree)
  // -> { matched: [{ assetId, file }], missing: [assetId] }
  // Names are compared after Unicode normalization (macOS stores Japanese names decomposed) and size must
  // match when it is known, so two different clips that share a name are not mixed up.
  function matchRelink(wanted, files) {
    const byName = new Map();
    for (const f of files || []) {
      const k = norm(f.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(f);
    }
    const used = new Set();
    const matched = [];
    const missing = [];
    for (const w of wanted) {
      const cands = byName.get(norm(w.name)) || [];
      const hit = cands.find((f) => !used.has(f) && (w.size == null || Number.isNaN(Number(w.size)) || f.size === Number(w.size)));
      if (hit) {
        used.add(hit);
        matched.push({ assetId: w.assetId, file: hit });
      } else {
        missing.push(w.assetId);
      }
    }
    return { matched, missing };
  }

  // names that occur once can be linked by name; duplicates would be ambiguous and are bundled instead
  function uniqueNames(names) {
    const count = new Map();
    names.forEach((n) => count.set(norm(n), (count.get(norm(n)) || 0) + 1));
    return (n) => count.get(norm(n)) === 1;
  }

  // ---------------------------------------------------------------------------
  // browser glue
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  function isLinkMode() {
    const el = $('opt-link-media');
    return !!(el && el.checked);
  }
  function mediaFolder() {
    const el = $('media-folder');
    return el ? String(el.value || '').trim() : '';
  }

  function missingBoxes() {
    return Array.from(document.querySelectorAll('.visual-box.is-missing, .bgm-box.is-missing'));
  }

  function updateMissingUi() {
    const n = missingBoxes().length;
    const btn = $('btn-relink-media');
    if (btn) {
      btn.hidden = n === 0;
      btn.textContent = n ? `RELINK MEDIA (${n})` : 'RELINK MEDIA';
    }
    return n;
  }

  function markMissing(box) {
    if (box) box.classList.add('is-missing');
  }

  // Re-attach original files to cuts that came back "未リンク" from a lite project.
  async function relinkFromFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.size >= 0);
    const boxes = missingBoxes();
    if (!boxes.length) return { matched: 0, missing: 0 };
    const wanted = boxes.map((b) => ({
      assetId: b.dataset.assetId,
      name: b.dataset.assetName || b.dataset.filename,
      size: b.dataset.assetSize ? Number(b.dataset.assetSize) : null,
    }));
    const { matched, missing } = matchRelink(wanted, files);
    for (const m of matched) {
      const box = boxes.find((b) => b.dataset.assetId === m.assetId);
      if (!box) continue;
      registerAssetWithId(m.assetId, m.file);
      box.classList.remove('is-missing');
      if (box.classList.contains('visual-box') && !box.querySelector('img') && root.CutsLazyThumbs) {
        box.dataset.thumbState = '';
        root.CutsLazyThumbs.observe(box);
      }
    }
    updateMissingUi();
    return { matched: matched.length, missing: missing.length };
  }

  async function onRelinkPicked(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    setBusyStatus('再リンク中…');
    const r = await relinkFromFiles(files);
    setBusyStatus(r.missing
      ? `${r.matched} 件を再リンクしました（見つからなかった素材 ${r.missing} 件。名前とサイズが同じファイルが必要です）`
      : `${r.matched} 件をすべて再リンクしました`);
  }

  function setupMediaLink() {
    const chk = $('opt-link-media');
    const folderWrap = $('media-folder-wrap');
    const folder = $('media-folder');
    const sync = () => { if (folderWrap) folderWrap.hidden = !(chk && chk.checked); };
    if (chk) {
      chk.checked = lsGet(LINK_KEY) === '1';
      chk.addEventListener('change', () => { lsSet(LINK_KEY, chk.checked ? '1' : '0'); sync(); });
    }
    if (folder) {
      folder.value = lsGet(FOLDER_KEY) || '';
      folder.addEventListener('change', () => lsSet(FOLDER_KEY, String(folder.value || '').trim()));
    }
    sync();

    const btn = $('btn-relink-media');
    const input = $('relink-input');
    if (btn && input) {
      // folders on desktop (the whole media folder is matched by name + size), plain file picker on touch devices
      input.webkitdirectory = typeof canHover === 'function' ? canHover() : true;
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', () => onRelinkPicked(input));
    }
    updateMissingUi();
  }

  const api = {
    matchRelink, uniqueNames, isLinkMode, mediaFolder, markMissing, missingBoxes, updateMissingUi,
    relinkFromFiles, setupMediaLink,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CutsMediaLink = api;
  root.setupMediaLink = setupMediaLink;
})(typeof window !== 'undefined' ? window : globalThis);
