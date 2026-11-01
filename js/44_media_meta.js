// js/44_media_meta.js
// Cheap media metadata without decoding: duration and creation time of MP4 / MOV / M4V / 3GP from the
// `mvhd` atom (only atom headers are read, so a 4 GB clip costs a few small reads), plus a light
// <video preload="metadata"> probe for everything else (WebM, MKV, ...).
//
// Used by the bulk importer (duration is needed up front for every clip, thumbnails are not) and by
// the capture-time sort. Pure functions of a File/Blob so they run in Node 20+ too
// (see scripts/capture_sort_smoke.js).

(function (root) {
  'use strict';

  const MAC_EPOCH_OFFSET_SEC = 2082844800; // 1904-01-01 -> 1970-01-01
  const ISO_VIDEO_EXT = /\.(mp4|m4v|mov|3gp|3g2)$/i;
  const ISO_VIDEO_MIME = /^video\/(mp4|quicktime|3gpp2?|x-m4v)$/;

  function fourcc(dv, o) {
    return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  }

  // children of moov starting at `start`; returns { creationSec (mac epoch), timescale, units } | null
  function findMvhd(buf, start) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let p = start;
    while (p + 8 <= buf.length) {
      const size = dv.getUint32(p);
      const type = fourcc(dv, p + 4);
      if (size < 8) break;
      if (type === 'mvhd') {
        const version = dv.getUint8(p + 8);
        if (version === 1) {
          if (p + 40 > buf.length) return null;
          return {
            creationSec: dv.getUint32(p + 12) * 4294967296 + dv.getUint32(p + 16),
            timescale: dv.getUint32(p + 28),
            units: dv.getUint32(p + 32) * 4294967296 + dv.getUint32(p + 36),
          };
        }
        if (p + 28 > buf.length) return null;
        return { creationSec: dv.getUint32(p + 12), timescale: dv.getUint32(p + 20), units: dv.getUint32(p + 24) };
      }
      p += size;
    }
    return null;
  }

  // -> { durationSec: number|null, createdMs: number|null } or null when this is not an ISO-BMFF file
  async function readIsoVideoMeta(file) {
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
        const m = findMvhd(buf, headerLen);
        if (!m) return null;
        return {
          durationSec: m.timescale > 0 && m.units > 0 ? m.units / m.timescale : null,
          createdMs: m.creationSec > MAC_EPOCH_OFFSET_SEC ? (m.creationSec - MAC_EPOCH_OFFSET_SEC) * 1000 : null,
        };
      }
      pos += size;
    }
    return null;
  }

  function isIsoVideo(file) {
    return ISO_VIDEO_EXT.test(file.name || '') || ISO_VIDEO_MIME.test(String(file.type || ''));
  }

  // Browser only: duration from the media element's metadata. -> seconds | null (8 s timeout)
  function probeElementDuration(file, kind) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve(null);
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      const url = URL.createObjectURL(file);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { el.removeAttribute('src'); el.load(); } catch (_) {}   // release the decoder right away
        try { URL.revokeObjectURL(url); } catch (_) {}
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), 8000);
      el.preload = 'metadata';
      el.muted = true;
      el.addEventListener('loadedmetadata', () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null));
      el.addEventListener('error', () => finish(null));
      el.src = url;
    });
  }

  // -> { durationSec, createdMs, source: 'mvhd' | 'element' } | null
  async function readVideoMeta(file) {
    try {
      if (isIsoVideo(file)) {
        const m = await readIsoVideoMeta(file);
        if (m && m.durationSec) return { ...m, source: 'mvhd' };
      }
    } catch (_) { /* fall through to the element probe */ }
    const d = await probeElementDuration(file, 'video');
    return d ? { durationSec: d, createdMs: null, source: 'element' } : null;
  }

  const api = { readIsoVideoMeta, isIsoVideo, probeElementDuration, readVideoMeta, MAC_EPOCH_OFFSET_SEC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CutsMediaMeta = api;
})(typeof window !== 'undefined' ? window : globalThis);
