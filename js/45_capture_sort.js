// js/45_capture_sort.js
// Sort cuts by the capture time of their visual (image / video).
//
// Capture time sources, in order:
//   1. Photos: EXIF DateTimeOriginal (then DateTimeDigitized, then DateTime), with
//      SubSecTimeOriginal / OffsetTimeOriginal when present. JPEG is parsed segment by
//      segment; HEIC / WebP / PNG(eXIf) / TIFF are found by signature scan.
//   2. Videos (MP4 / MOV / M4V / 3GP): `mvhd` creation_time (UTC) from the moov atom.
//      Only atom headers are read, so large files are not loaded into memory.
//   3. File modified time, only for files that existed before this page was opened
//      (files rebuilt from a loaded ZIP get "now" as their modified time, so they are skipped).
// Cuts without a capture time keep their relative order and go to the end.
//
// The parsers are pure functions of a File/Blob so they can be tested in Node
// (see scripts/capture_sort_smoke.js). DOM code is at the bottom.
//
// Depends on globals in the browser: assetStore, renumberCuts.

(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // EXIF / TIFF
  // ---------------------------------------------------------------------------
  const TIFF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const EXIF_IFD_POINTER = 0x8769;
  const TAG_DATETIME = 0x0132;
  const TAG_DATETIME_ORIGINAL = 0x9003;
  const TAG_DATETIME_DIGITIZED = 0x9004;
  const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
  const TAG_SUBSEC_TIME_ORIGINAL = 0x9291;

  // "2026:10:07 14:03:11" (+ optional subsec "123", offset "+09:00") -> epoch ms
  function exifDateToMs(str, subsec, offset) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(str || ''));
    if (!m) return null;
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
    let ms = 0;
    if (subsec && /^\d+$/.test(subsec)) ms = Math.round(Number('0.' + subsec) * 1000);
    const om = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset || '').trim());
    if (om) {
      const minutes = (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3]));
      return Date.UTC(y, mo - 1, d, h, mi, s) - minutes * 60000 + ms;
    }
    // No offset recorded: interpret as wall-clock time in this device's time zone.
    return new Date(y, mo - 1, d, h, mi, s).getTime() + ms;
  }

  // Parse a TIFF structure starting at `base` inside `u8`. Returns epoch ms or null.
  function parseTiffCaptureTime(u8, base) {
    if (base < 0 || base + 8 > u8.length) return null;
    let le;
    if (u8[base] === 0x49 && u8[base + 1] === 0x49) le = true;
    else if (u8[base] === 0x4d && u8[base + 1] === 0x4d) le = false;
    else return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    if (u16(base + 2) !== 42) return null;

    const readIfd = (off) => {
      const start = base + off;
      if (off <= 0 || start + 2 > u8.length) return new Map();
      const n = u16(start);
      const out = new Map();
      for (let i = 0; i < n; i++) {
        const e = start + 2 + i * 12;
        if (e + 12 > u8.length) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        const size = (TIFF_TYPE_SIZE[type] || 1) * count;
        const pos = size <= 4 ? e + 8 : base + u32(e + 8);
        out.set(tag, { type, count, size, pos, entry: e });
      }
      return out;
    };
    const ascii = (ent) => {
      if (!ent || ent.type !== 2 || ent.pos < 0 || ent.pos + ent.size > u8.length) return null;
      let s = '';
      for (let i = 0; i < ent.size; i++) {
        const c = u8[ent.pos + i];
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };

    const ifd0 = readIfd(u32(base + 4));
    const exifPtr = ifd0.get(EXIF_IFD_POINTER);
    const exif = exifPtr ? readIfd(u32(exifPtr.entry + 8)) : new Map();

    const offset = ascii(exif.get(TAG_OFFSET_TIME_ORIGINAL));
    const subsec = ascii(exif.get(TAG_SUBSEC_TIME_ORIGINAL));
    const candidates = [
      ascii(exif.get(TAG_DATETIME_ORIGINAL)),
      ascii(exif.get(TAG_DATETIME_DIGITIZED)),
      ascii(ifd0.get(TAG_DATETIME)),
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      // Offset / subsec describe DateTimeOriginal only
      const ms = exifDateToMs(candidates[i], i === 0 ? subsec : null, i === 0 ? offset : null);
      if (ms != null) return ms;
    }
    return null;
  }

  // JPEG: walk segments to the APP1 "Exif\0\0" and return the TIFF header index, or -1.
  function findExifTiffInJpeg(u8) {
    if (u8.length < 4 || u8[0] !== 0xff || u8[1] !== 0xd8) return -1;
    let p = 2;
    while (p + 4 <= u8.length) {
      if (u8[p] !== 0xff) { p++; continue; }
      const marker = u8[p + 1];
      if (marker === 0xff) { p++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
      const len = (u8[p + 2] << 8) | u8[p + 3];
      if (marker === 0xe1 && len >= 8 &&
          u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66 &&
          u8[p + 8] === 0 && u8[p + 9] === 0) {
        return p + 10;
      }
      if (len < 2) break;
      p += 2 + len;
    }
    return -1;
  }

  function indexOfAscii(u8, text, from) {
    const n = text.length;
    const first = text.charCodeAt(0);
    const last = u8.length - n;
    for (let i = from || 0; i <= last; i++) {
      if (u8[i] !== first) continue;
      let ok = true;
      for (let j = 1; j < n; j++) {
        if (u8[i + j] !== text.charCodeAt(j)) { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  }

  // Non-JPEG images (HEIC, WebP, PNG, TIFF): find an embedded TIFF/EXIF block by signature.
  function exifCaptureTimeBySignature(u8) {
    const tries = [];
    // "Exif\0\0" + TIFF header (HEIC, WebP with prefix, ...)
    let from = 0;
    for (let k = 0; k < 4; k++) {
      const i = indexOfAscii(u8, 'Exif\u0000\u0000', from);
      if (i < 0) break;
      tries.push(i + 6);
      from = i + 6;
    }
    // PNG eXIf chunk and WebP EXIF chunk hold the TIFF header directly
    const png = indexOfAscii(u8, 'eXIf', 0);
    if (png >= 0) tries.push(png + 4);
    const webp = indexOfAscii(u8, 'EXIF', 0);
    if (webp >= 0) tries.push(webp + 8);
    // Bare TIFF files
    tries.push(0);
    for (const base of tries) {
      const ms = parseTiffCaptureTime(u8, base);
      if (ms != null) return ms;
    }
    return null;
  }

  async function readImageCaptureTime(file) {
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    if (head[0] === 0xff && head[1] === 0xd8) {
      const base = findExifTiffInJpeg(head);
      return base >= 0 ? parseTiffCaptureTime(head, base) : null;
    }
    const big = file.size > head.length
      ? new Uint8Array(await file.slice(0, 4 * 1024 * 1024).arrayBuffer())
      : head;
    return exifCaptureTimeBySignature(big);
  }

  // ---------------------------------------------------------------------------
  // MP4 / MOV: moov > mvhd creation_time
  // ---------------------------------------------------------------------------
  const MAC_EPOCH_OFFSET_SEC = 2082844800; // 1904-01-01 -> 1970-01-01

  function fourcc(dv, o) {
    return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  }

  function findMvhdCreationSec(buf, start) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = start;
    while (p + 8 <= buf.length) {
      const size = dv.getUint32(p);
      const type = fourcc(dv, p + 4);
      if (size < 8) break;
      if (type === 'mvhd') {
        const version = dv.getUint8(p + 8);
        if (version === 1) {
          if (p + 20 > buf.length) return null;
          return dv.getUint32(p + 12) * 4294967296 + dv.getUint32(p + 16);
        }
        if (p + 16 > buf.length) return null;
        return dv.getUint32(p + 12);
      }
      p += size;
    }
    return null;
  }

  async function readVideoCaptureTime(file) {
    const total = file.size;
    let pos = 0;
    let guard = 0;
    while (pos + 8 <= total && guard++ < 10000) {
      const hdr = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      if (hdr.byteLength < 8) break;
      let size = hdr.getUint32(0);
      const type = fourcc(hdr, 4);
      let headerLen = 8;
      if (size === 1 && hdr.byteLength >= 16) {
        size = hdr.getUint32(8) * 4294967296 + hdr.getUint32(12);
        headerLen = 16;
      } else if (size === 0) {
        size = total - pos;
      }
      if (size < headerLen) break;
      if (type === 'moov') {
        const len = Math.min(size, 32 * 1024 * 1024);
        const buf = new Uint8Array(await file.slice(pos, pos + len).arrayBuffer());
        const sec = findMvhdCreationSec(buf, headerLen);
        if (!sec || sec <= MAC_EPOCH_OFFSET_SEC) return null; // 0 / unset
        return (sec - MAC_EPOCH_OFFSET_SEC) * 1000;
      }
      pos += size;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Public: capture time of a File
  // ---------------------------------------------------------------------------
  const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|avif|tiff?)$/i;
  const ISO_VIDEO_EXT = /\.(mp4|m4v|mov|3gp|3g2)$/i;
  const cache = new WeakMap();

  // -> { ms, source: 'exif' | 'video' | 'file' } or null
  async function readCaptureTime(file) {
    if (!file) return null;
    if (cache.has(file)) return cache.get(file);
    const name = file.name || '';
    const type = String(file.type || '');
    let res = null;
    try {
      if (type.startsWith('image/') || IMAGE_EXT.test(name)) {
        const ms = await readImageCaptureTime(file);
        if (ms != null) res = { ms, source: 'exif' };
      } else if (ISO_VIDEO_EXT.test(name) || /^video\/(mp4|quicktime|3gpp2?|x-m4v)$/.test(type)) {
        const ms = await readVideoCaptureTime(file);
        if (ms != null) res = { ms, source: 'video' };
      }
    } catch (_) {
      res = null;
    }
    if (!res && file.lastModified > 0) {
      // Files rebuilt from a ZIP get "now" as lastModified; only trust files older than this page load.
      const t0 = typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin : Date.now();
      if (file.lastModified < t0 - 1000) res = { ms: file.lastModified, source: 'file' };
    }
    cache.set(file, res);
    return res;
  }

  // ---------------------------------------------------------------------------
  // Pure ordering: items = [{ index, t: {ms,source}|null }] -> new index order
  // ---------------------------------------------------------------------------
  function orderByCaptureTime(items) {
    const dated = items.filter((x) => x.t);
    const undated = items.filter((x) => !x.t);
    dated.sort((a, b) => (a.t.ms - b.t.ms) || (a.index - b.index)); // stable by current order
    return { order: dated.concat(undated).map((x) => x.index), datedCount: dated.length, undatedCount: undated.length };
  }

  // ---------------------------------------------------------------------------
  // DOM glue
  // ---------------------------------------------------------------------------
  let undoOrder = null;
  let applying = false;

  function statusEl() { return document.getElementById('sort-status'); }

  function setStatus(text, withUndo) {
    const el = statusEl();
    if (!el) return;
    el.textContent = text || '';
    if (withUndo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sort-undo';
      b.textContent = '元に戻す';
      b.addEventListener('click', undoSort);
      el.appendChild(document.createTextNode(' '));
      el.appendChild(b);
    }
  }

  // Called from renumberCuts(): any other reorder/delete makes the saved order stale.
  function clearSortUndo() {
    if (applying || !undoOrder) return;
    undoOrder = null;
    setStatus('');
  }

  function applyOrder(tbody, rows) {
    applying = true;
    try {
      rows.forEach((r) => tbody.appendChild(r));
      if (typeof renumberCuts === 'function') renumberCuts();
    } finally {
      applying = false;
    }
  }

  async function sortRowsByCaptureTime() {
    const tbody = document.getElementById('storyboard-body');
    const btn = document.getElementById('btn-sort-capture');
    if (!tbody) return;
    const rows = Array.from(tbody.children);
    if (rows.length < 2) { setStatus('並べ替えるカットが 2 件以上必要です'); return; }

    if (btn) btn.disabled = true;
    setStatus('撮影日時を読み取り中…');
    try {
      const items = [];
      for (let i = 0; i < rows.length; i++) {
        const box = rows[i].querySelector('.visual-box');
        const id = box && box.dataset ? box.dataset.assetId : '';
        const file = id && typeof assetStore !== 'undefined' ? assetStore.get(id) : null;
        items.push({ index: i, t: file ? await readCaptureTime(file) : null });
      }
      const { order, datedCount, undatedCount } = orderByCaptureTime(items);
      if (datedCount < 2) {
        setStatus(`撮影日時を読み取れたカットが ${datedCount} 件のため、並べ替えませんでした`);
        return;
      }
      const next = order.map((i) => rows[i]);
      if (next.every((r, i) => r === rows[i])) {
        setStatus(undatedCount ? `すでに撮影日時順です（日時なし ${undatedCount} 件は末尾）` : 'すでに撮影日時順です');
        return;
      }
      undoOrder = rows.slice();
      applyOrder(tbody, next);

      const by = { exif: 0, video: 0, file: 0 };
      items.forEach((x) => { if (x.t) by[x.t.source] += 1; });
      const parts = [`写真 EXIF ${by.exif}`, `動画 ${by.video}`];
      if (by.file) parts.push(`ファイル日時 ${by.file}`);
      if (undatedCount) parts.push(`日時なし ${undatedCount}（末尾）`);
      setStatus(`撮影日時順に並べ替えました: ${parts.join(' / ')}`, true);
    } catch (err) {
      console.error(err);
      setStatus('並べ替えに失敗しました');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function undoSort() {
    const tbody = document.getElementById('storyboard-body');
    if (!tbody || !undoOrder) return;
    const present = new Set(Array.from(tbody.children));
    const saved = new Set(undoOrder);
    const restored = undoOrder.filter((r) => present.has(r));
    const extras = Array.from(tbody.children).filter((r) => !saved.has(r)); // rows added after sorting
    applyOrder(tbody, restored.concat(extras));
    undoOrder = null;
    setStatus('元の順序に戻しました');
  }

  function setupCaptureSort() {
    const btn = document.getElementById('btn-sort-capture');
    if (btn) btn.addEventListener('click', sortRowsByCaptureTime);
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  const api = {
    readCaptureTime, orderByCaptureTime, exifDateToMs,
    parseTiffCaptureTime, findExifTiffInJpeg,
    sortRowsByCaptureTime, undoSort, clearSortUndo, setupCaptureSort,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CutsCaptureSort = api;
  root.setupCaptureSort = setupCaptureSort;
})(typeof window !== 'undefined' ? window : globalThis);
