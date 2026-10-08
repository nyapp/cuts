// js/12_zip_store.js
// Memory-flat ZIP writer and reader for project ZIPs and NLE export ZIPs.
//
// Why: JSZip pulls every file into the JS heap (ArrayBuffer per asset, then the whole archive),
// so peak memory was ~4x the project size (449 MB of clips -> ~2.8 GB). Media files are already
// compressed, so projects use STORE (no compression). For STORE a ZIP is just headers around the
// raw bytes, which means:
//   - WRITE: compute each file's CRC-32 in 8 MB chunks, then build the archive as a Blob made of
//     [header, file Blob, header, file Blob, ..., central directory]. Blob parts reference the
//     original File objects; their bytes are never copied into the JS heap.
//   - READ: parse the central directory only and return file.slice() views for each entry.
//     Compressed (DEFLATE) archives are reported as unsupported so the caller can fall back to JSZip.
// ZIP64 structures are written/read when sizes or offsets exceed 4 GiB (or forced for tests).
//
// Pure functions of Blob/File/Uint8Array/string: runs in browsers and Node 20+
// (see scripts/zip_store_smoke.js).

(function (root) {
  'use strict';

  const CHUNK = 8 * 1024 * 1024;
  const U32 = 0xffffffff;
  const U16 = 0xffff;

  // ---------------------------------------------------------------------------
  // CRC-32 (IEEE), table driven
  // ---------------------------------------------------------------------------
  // Slicing-by-8 tables: ~4x faster than the byte-wise loop on multi-GB projects.
  const CRC_T = (() => {
    const t = new Uint32Array(256 * 8);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    for (let k = 1; k < 8; k++) {
      for (let n = 0; n < 256; n++) {
        const prev = t[(k - 1) * 256 + n];
        t[k * 256 + n] = ((prev >>> 8) ^ t[prev & 0xff]) >>> 0;
      }
    }
    return t;
  })();
  const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

  function crc32Update(crc, u8) {
    const T = CRC_T;
    let c = crc ^ U32;
    let i = 0;
    const len = u8.length;
    if (len >= 16 && LITTLE_ENDIAN && (u8.byteOffset & 3) === 0) {
      const w = new Uint32Array(u8.buffer, u8.byteOffset, len >> 2);
      const end = (len >> 3) << 1; // words consumed in pairs
      let wi = 0;
      for (; wi < end; wi += 2) {
        const a = w[wi] ^ c;
        const b = w[wi + 1];
        c = T[1792 + (a & 255)] ^ T[1536 + ((a >>> 8) & 255)] ^ T[1280 + ((a >>> 16) & 255)] ^ T[1024 + (a >>> 24)] ^
            T[768 + (b & 255)] ^ T[512 + ((b >>> 8) & 255)] ^ T[256 + ((b >>> 16) & 255)] ^ T[b >>> 24];
      }
      i = wi << 2;
    }
    for (; i < len; i++) c = T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ U32) >>> 0;
  }

  async function crc32OfBlob(blob, onChunk) {
    let crc = 0;
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const buf = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + CHUNK)).arrayBuffer());
      crc = crc32Update(crc, buf);
      if (onChunk) onChunk(Math.min(blob.size, pos + CHUNK));
    }
    return crc;
  }

  // ---------------------------------------------------------------------------
  // Writer
  // ---------------------------------------------------------------------------
  const enc = new TextEncoder();

  function dosDateTime(d) {
    const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    const date = ((Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    return { time, date };
  }

  function set64(dv, o, v) {
    dv.setUint32(o, v % 4294967296, true);
    dv.setUint32(o + 4, Math.floor(v / 4294967296), true);
  }

  function sizeOf(data) {
    return typeof data === 'string' ? enc.encode(data).length : data.size != null ? data.size : data.byteLength;
  }

  // entries: [{ name, data: Blob | File | Uint8Array | ArrayBuffer | string }]
  // opts: { onProgress(done, total, name), forceZip64, now }
  // -> Blob (application/zip)
  async function createZipBlob(entries, opts) {
    const o = opts || {};
    const force64 = !!o.forceZip64;
    const { time, date } = dosDateTime(o.now instanceof Date ? o.now : new Date());

    // normalize + add parent directory entries (like a file manager would)
    const items = [];
    const seenDirs = new Set();
    for (const e of entries) {
      const name = String(e.name).replace(/^\/+/, '');
      const parts = name.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc += parts[i] + '/';
        if (!seenDirs.has(acc)) {
          seenDirs.add(acc);
          items.push({ name: acc, dir: true, data: new Uint8Array(0), size: 0, crc: 0 });
        }
      }
      let data = e.data;
      if (typeof data === 'string') data = enc.encode(data);
      else if (data instanceof ArrayBuffer) data = new Uint8Array(data);
      items.push({ name, dir: name.endsWith('/'), data, size: sizeOf(data), crc: 0 });
    }

    // pass 1: CRC-32 (reads file bytes in chunks; nothing is retained)
    const files = items.filter((x) => !x.dir && x.size > 0);
    let done = 0;
    for (const it of files) {
      it.crc = it.data instanceof Uint8Array ? crc32Update(0, it.data) : await crc32OfBlob(it.data);
      done += 1;
      if (o.onProgress) o.onProgress(done, files.length, it.name);
    }

    // pass 2: lay out headers + data references
    const parts = [];
    const central = [];
    let offset = 0;
    let anyZip64 = false;
    for (const it of items) {
      const nameBytes = enc.encode(it.name);
      const sizeBig = force64 || it.size >= U32;
      const offBig = force64;           // decided per entry below once the real offset is known
      const z64Local = sizeBig;
      const extraLen = z64Local ? 20 : 0;
      const lh = new Uint8Array(30 + nameBytes.length + extraLen);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, z64Local ? 45 : 20, true);
      dv.setUint16(6, 0x0800, true);          // UTF-8 names
      dv.setUint16(8, 0, true);               // STORE
      dv.setUint16(10, time, true);
      dv.setUint16(12, date, true);
      dv.setUint32(14, it.crc, true);
      dv.setUint32(18, z64Local ? U32 : it.size, true);
      dv.setUint32(22, z64Local ? U32 : it.size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, extraLen, true);
      lh.set(nameBytes, 30);
      if (z64Local) {
        const x = 30 + nameBytes.length;
        dv.setUint16(x, 1, true);
        dv.setUint16(x + 2, 16, true);
        set64(dv, x + 4, it.size);
        set64(dv, x + 12, it.size);
        anyZip64 = true;
      }
      const localOffset = offset;
      parts.push(lh);
      if (it.size > 0) parts.push(it.data);
      offset += lh.length + it.size;
      central.push({ it, nameBytes, sizeBig: z64Local, offBig: offBig || localOffset >= U32, localOffset });
      if (central[central.length - 1].offBig) anyZip64 = true;
    }

    // central directory
    const cdStart = offset;
    const cdChunks = [];
    for (const c of central) {
      const { it, nameBytes } = c;
      const extraFields = [];
      if (c.sizeBig) extraFields.push(it.size, it.size);
      if (c.offBig) extraFields.push(c.localOffset);
      const extraLen = extraFields.length ? 4 + extraFields.length * 8 : 0;
      const ch = new Uint8Array(46 + nameBytes.length + extraLen);
      const dv = new DataView(ch.buffer);
      const needs64 = c.sizeBig || c.offBig;
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, (3 << 8) | (needs64 ? 45 : 20), true); // made by: UNIX
      dv.setUint16(6, needs64 ? 45 : 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, time, true);
      dv.setUint16(14, date, true);
      dv.setUint32(16, it.crc, true);
      dv.setUint32(20, c.sizeBig ? U32 : it.size, true);
      dv.setUint32(24, c.sizeBig ? U32 : it.size, true);
      dv.setUint16(28, nameBytes.length, true);
      dv.setUint16(30, extraLen, true);
      dv.setUint16(32, 0, true);              // comment
      dv.setUint16(34, 0, true);              // disk
      dv.setUint16(36, 0, true);              // internal attrs
      dv.setUint32(38, it.dir ? (((0o040755 << 16) | 0x10) >>> 0) : ((0o100644 << 16) >>> 0), true);
      dv.setUint32(42, c.offBig ? U32 : c.localOffset, true);
      ch.set(nameBytes, 46);
      if (extraLen) {
        const x = 46 + nameBytes.length;
        dv.setUint16(x, 1, true);
        dv.setUint16(x + 2, extraFields.length * 8, true);
        extraFields.forEach((v, i) => set64(dv, x + 4 + i * 8, v));
      }
      cdChunks.push(ch);
    }
    const cdSize = cdChunks.reduce((a, b) => a + b.length, 0);
    parts.push(...cdChunks);
    offset += cdSize;

    const count = items.length;
    const needZip64End = force64 || anyZip64 || count >= U16 || cdStart >= U32 || cdSize >= U32;
    if (needZip64End) {
      const r = new Uint8Array(56 + 20);
      const dv = new DataView(r.buffer);
      dv.setUint32(0, 0x06064b50, true);
      set64(dv, 4, 44);
      dv.setUint16(12, (3 << 8) | 45, true);
      dv.setUint16(14, 45, true);
      dv.setUint32(16, 0, true);
      dv.setUint32(20, 0, true);
      set64(dv, 24, count);
      set64(dv, 32, count);
      set64(dv, 40, cdSize);
      set64(dv, 48, cdStart);
      dv.setUint32(56, 0x07064b50, true);     // locator
      dv.setUint32(60, 0, true);
      set64(dv, 64, cdStart + cdSize);
      dv.setUint32(72, 1, true);
      parts.push(r);
    }
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, needZip64End ? U16 : count, true);
    ev.setUint16(10, needZip64End ? U16 : count, true);
    ev.setUint32(12, needZip64End ? U32 : cdSize, true);
    ev.setUint32(16, needZip64End ? U32 : cdStart, true);
    ev.setUint16(20, 0, true);
    parts.push(eocd);

    return new Blob(parts, { type: 'application/zip' });
  }

  // ---------------------------------------------------------------------------
  // Reader (STORE-only, lazy)
  // ---------------------------------------------------------------------------
  const dec = new TextDecoder('utf-8');

  function read64(dv, o) {
    return dv.getUint32(o + 4, true) * 4294967296 + dv.getUint32(o, true);
  }

  function bytesToBase64(u8) {
    let s = '';
    const step = 0x8000;
    for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
    return btoa(s);
  }

  // -> { files: {name: {name, dir}}, file(name) -> entry | null, lazy: true } or null when the archive
  // is not a plain STORE zip (encrypted / compressed / unreadable). Entries expose JSZip-like
  // `async('blob' | 'string' | 'base64' | 'arraybuffer' | 'uint8array')`.
  async function openZipLazy(file) {
    const size = file.size;
    if (size < 22) return null;
    const tailLen = Math.min(size, 65557);
    const tailStart = size - tailLen;
    const tail = new Uint8Array(await file.slice(tailStart, size).arrayBuffer());
    const tdv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tdv.getUint32(i, true) === 0x06054b50 && i + 22 + tdv.getUint16(i + 20, true) === tail.length) { eocd = i; break; }
    }
    if (eocd < 0) return null;

    let count = tdv.getUint16(eocd + 10, true);
    let cdSize = tdv.getUint32(eocd + 12, true);
    let cdOffset = tdv.getUint32(eocd + 16, true);
    if (count === U16 || cdSize === U32 || cdOffset === U32) {
      const loc = eocd - 20;
      if (loc < 0 || tdv.getUint32(loc, true) !== 0x07064b50) return null;
      const rec = read64(tdv, loc + 8);
      const r = new DataView(await file.slice(rec, rec + 56).arrayBuffer());
      if (r.byteLength < 56 || r.getUint32(0, true) !== 0x06064b50) return null;
      count = read64(r, 32);
      cdSize = read64(r, 40);
      cdOffset = read64(r, 48);
    }
    if (cdOffset + cdSize > size) return null;

    const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dv = new DataView(cd.buffer);
    const files = {};
    const entries = {};
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || dv.getUint32(p, true) !== 0x02014b50) return null;
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      let csize = dv.getUint32(p + 20, true);
      let usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 extra field
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = dv.getUint16(x, true);
        const len = dv.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (usize === U32) { usize = read64(dv, q); q += 8; }
          if (csize === U32) { csize = read64(dv, q); q += 8; }
          if (lho === U32) { lho = read64(dv, q); q += 8; }
        }
        x += 4 + len;
      }
      const dir = name.endsWith('/');
      if (!dir && (method !== 0 || (flags & 1))) return null; // compressed or encrypted: caller falls back
      files[name] = { name, dir };
      if (!dir) entries[name] = { name, size: usize, offset: lho };
      p += 46 + nameLen + extraLen + commentLen;
    }

    const dataBlob = async (e) => {
      const h = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
      if (h.byteLength < 30 || h.getUint32(0, true) !== 0x04034b50) throw new Error('bad local header: ' + e.name);
      const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      return file.slice(start, start + e.size);
    };
    const wrap = (e) => ({
      name: e.name,
      async: async (type) => {
        const blob = await dataBlob(e);
        switch (type) {
          case 'blob': return blob;
          case 'string': return dec.decode(await blob.arrayBuffer());
          case 'arraybuffer': return blob.arrayBuffer();
          case 'uint8array': return new Uint8Array(await blob.arrayBuffer());
          case 'base64': return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
          default: throw new Error('unsupported type: ' + type);
        }
      },
    });
    return { files, file: (name) => (entries[name] ? wrap(entries[name]) : null), lazy: true };
  }

  // ---------------------------------------------------------------------------
  // Download helper (browser)
  // ---------------------------------------------------------------------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Big files: give the browser time to start reading the blob before releasing it
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 120000);
  }

  // Shared "busy" line in the storyboard toolbar (also used by the importer)
  function setBusyStatus(text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('import-status');
    if (el) el.textContent = text || '';
  }

  function formatBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    return Math.round(n / 1048576) + ' MB';
  }

  const api = { createZipBlob, openZipLazy, crc32Update, downloadBlob, setBusyStatus, formatBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CutsZip = api;
  root.createZipBlob = createZipBlob;
  root.openZipLazy = openZipLazy;
  root.downloadBlob = downloadBlob;
  root.setBusyStatus = setBusyStatus;
  root.formatBytes = formatBytes;
})(typeof window !== 'undefined' ? window : globalThis);
