#!/usr/bin/env node
// Smoke test for js/45_capture_sort.js (runs in Node 20+, no browser, no fixtures on disk).
//
//   TZ=Asia/Tokyo node scripts/capture_sort_smoke.js
//
// Builds tiny synthetic JPEG / PNG / HEIC-like / MP4 / MOV files in memory, checks that
// the capture time is read correctly, and checks the ordering rules.
// Exit code 1 on any failure.

const assert = require('assert');
const cs = require('../js/45_capture_sort.js');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('ok   -', name);
  } catch (e) {
    failed += 1;
    console.log('FAIL -', name, '\n      ', e.message);
  }
}

// ---------- builders ----------
function buildTiff({ le = false, dateOriginal, dateTime, offset, subsec }) {
  const w16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const w32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255] : [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const asc = (s) => Array.from(Buffer.from(s + '\0', 'latin1'));
  const header = [le ? 0x49 : 0x4d, le ? 0x49 : 0x4d, ...w16(42), ...w32(8)];

  // layout: header(8) | IFD0 | exifIFD | data area
  const ifd0Entries = [];
  const exifEntries = [];
  const data = [];
  const ifd0Len = 2 + 12 * ((dateTime ? 1 : 0) + 1) + 4;
  const exifCount = (dateOriginal ? 1 : 0) + (offset ? 1 : 0) + (subsec ? 1 : 0);
  const exifLen = 2 + 12 * exifCount + 4;
  const exifIfdOffset = 8 + ifd0Len;
  const dataStart = exifIfdOffset + exifLen;
  const place = (bytes) => {
    const at = dataStart + data.length;
    data.push(...bytes);
    return at;
  };
  const entry = (tag, type, count, valueBytesOrOffset) => [...w16(tag), ...w16(type), ...w32(count), ...valueBytesOrOffset];

  if (dateTime) {
    const b = asc(dateTime);
    ifd0Entries.push(entry(0x0132, 2, b.length, w32(place(b))));
  }
  ifd0Entries.push(entry(0x8769, 4, 1, w32(exifIfdOffset)));
  if (dateOriginal) {
    const b = asc(dateOriginal);
    exifEntries.push(entry(0x9003, 2, b.length, w32(place(b))));
  }
  if (offset) {
    const b = asc(offset);
    exifEntries.push(b.length <= 4 ? entry(0x9011, 2, b.length, [...b, ...Array(4 - b.length).fill(0)]) : entry(0x9011, 2, b.length, w32(place(b))));
  }
  if (subsec) {
    const b = asc(subsec);
    exifEntries.push(b.length <= 4 ? entry(0x9291, 2, b.length, [...b, ...Array(4 - b.length).fill(0)]) : entry(0x9291, 2, b.length, w32(place(b))));
  }
  const ifd = (entries) => [...w16(entries.length), ...entries.flat(), ...w32(0)];
  return Uint8Array.from([...header, ...ifd(ifd0Entries), ...ifd(exifEntries), ...data]);
}

function jpegWithExif(tiff, { extraApp0 = true } = {}) {
  const exif = Uint8Array.from([...Buffer.from('Exif\0\0', 'latin1'), ...tiff]);
  const app1Len = exif.length + 2;
  const app0 = extraApp0 ? [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] : [];
  return Uint8Array.from([0xff, 0xd8, ...app0, 0xff, 0xe1, app1Len >> 8, app1Len & 255, ...exif, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

function pngWithExif(tiff) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const len = [(tiff.length >>> 24) & 255, (tiff.length >> 16) & 255, (tiff.length >> 8) & 255, tiff.length & 255];
  return Uint8Array.from([...sig, 0, 0, 0, 0, ...Buffer.from('IHDR'), 0, 0, 0, 0, ...len, ...Buffer.from('eXIf'), ...tiff, 0, 0, 0, 0]);
}

function heicLike(tiff) {
  // ftyp heic ... mdat [pad] 00 00 00 06 "Exif\0\0" TIFF
  return Uint8Array.from([
    0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic'),
    ...Array(5000).fill(0xab),
    0, 0, 0, 6, ...Buffer.from('Exif\0\0', 'latin1'), ...tiff,
  ]);
}

function box(type, payload) {
  const size = 8 + payload.length;
  return [(size >>> 24) & 255, (size >> 16) & 255, (size >> 8) & 255, size & 255, ...Buffer.from(type), ...payload];
}
function mvhd(creationSec, version = 0) {
  const be32 = (v) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const body = version === 1
    ? [1, 0, 0, 0, ...be32(Math.floor(creationSec / 4294967296)), ...be32(creationSec >>> 0), ...Array(8).fill(0), ...be32(1000), ...be32(0)]
    : [0, 0, 0, 0, ...be32(creationSec), ...be32(creationSec), ...be32(1000), ...be32(0)];
  return box('mvhd', [...body, ...Array(80).fill(0)]);
}
// moovAtEnd mimics iPhone/most camera files: ftyp, mdat, moov
function mp4(creationUnixMs, { moovAtEnd = true, version = 0, brand = 'isom' } = {}) {
  const creationSec = creationUnixMs == null ? 0 : Math.round(creationUnixMs / 1000) + 2082844800;
  const ftyp = box('ftyp', [...Buffer.from(brand), 0, 0, 2, 0, ...Buffer.from(brand)]);
  const mdat = box('mdat', Array(20000).fill(7));
  const moov = box('moov', mvhd(creationSec, version));
  return Uint8Array.from(moovAtEnd ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat]);
}

const F = (bytes, name, type = '', lastModified) => new File([bytes], name, { type, ...(lastModified ? { lastModified } : {}) });

// JST (+09:00) 2026-10-07 14:03:11 == 05:03:11Z
const T0 = Date.UTC(2026, 9, 7, 5, 3, 11);

(async () => {
  await test('exifDateToMs: offset, subsec, invalid', () => {
    assert.strictEqual(cs.exifDateToMs('2026:10:07 14:03:11', '500', '+09:00'), T0 + 500);
    assert.strictEqual(cs.exifDateToMs('2026:10:07 05:03:11', null, '+00:00'), T0);
    assert.strictEqual(cs.exifDateToMs('2026:10:07 05:03:11', null, '-05:00'), T0 + 5 * 3600000);
    assert.strictEqual(cs.exifDateToMs('0000:00:00 00:00:00'), null);
    assert.strictEqual(cs.exifDateToMs('garbage'), null);
  });

  await test('JPEG big-endian DateTimeOriginal + offset + subsec', async () => {
    const f = F(jpegWithExif(buildTiff({ le: false, dateOriginal: '2026:10:07 14:03:11', offset: '+09:00', subsec: '25' })), 'a.jpg', 'image/jpeg');
    const r = await cs.readCaptureTime(f);
    assert.deepStrictEqual(r, { ms: T0 + 250, source: 'exif' });
  });

  await test('JPEG little-endian, no JFIF segment', async () => {
    const f = F(jpegWithExif(buildTiff({ le: true, dateOriginal: '2026:10:07 05:03:11', offset: '+00:00' }), { extraApp0: false }), 'b.jpeg', 'image/jpeg');
    assert.strictEqual((await cs.readCaptureTime(f)).ms, T0);
  });

  await test('JPEG: falls back to IFD0 DateTime when no DateTimeOriginal', async () => {
    const f = F(jpegWithExif(buildTiff({ le: false, dateTime: '2026:10:07 05:03:11' })), 'c.jpg', 'image/jpeg');
    const r = await cs.readCaptureTime(f);
    // no offset recorded -> device-local wall clock
    assert.strictEqual(r.ms, new Date(2026, 9, 7, 5, 3, 11).getTime());
    assert.strictEqual(r.source, 'exif');
  });

  await test('PNG eXIf chunk', async () => {
    const f = F(pngWithExif(buildTiff({ le: false, dateOriginal: '2026:10:07 05:03:11', offset: '+00:00' })), 'd.png', 'image/png');
    assert.strictEqual((await cs.readCaptureTime(f)).ms, T0);
  });

  await test('HEIC-like (Exif block deep inside the file, >512KB header window not needed)', async () => {
    const f = F(heicLike(buildTiff({ le: true, dateOriginal: '2026:10:07 05:03:11', offset: '+00:00' })), 'e.heic', 'image/heic');
    assert.strictEqual((await cs.readCaptureTime(f)).ms, T0);
  });

  await test('image without EXIF -> null (no lastModified fallback for fresh files)', async () => {
    const f = F(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'f.png', 'image/png');
    assert.strictEqual(await cs.readCaptureTime(f), null);
  });

  await test('image without EXIF but old lastModified -> file time', async () => {
    const old = Date.UTC(2001, 8, 9, 1, 46, 40);
    const f = F(Uint8Array.from([1, 2, 3]), 'g.jpg', 'image/jpeg', old);
    assert.deepStrictEqual(await cs.readCaptureTime(f), { ms: old, source: 'file' });
  });

  await test('MP4 moov at end (large mdat first)', async () => {
    const f = F(mp4(T0, { moovAtEnd: true }), 'h.mp4', 'video/mp4');
    assert.deepStrictEqual(await cs.readCaptureTime(f), { ms: T0, source: 'video' });
  });

  await test('MP4 faststart (moov first), MOV brand, mvhd version 1', async () => {
    assert.strictEqual((await cs.readCaptureTime(F(mp4(T0, { moovAtEnd: false }), 'i.mp4', 'video/mp4'))).ms, T0);
    assert.strictEqual((await cs.readCaptureTime(F(mp4(T0, { brand: 'qt  ' }), 'j.mov', 'video/quicktime'))).ms, T0);
    assert.strictEqual((await cs.readCaptureTime(F(mp4(T0, { version: 1 }), 'k.mp4', 'video/mp4'))).ms, T0);
  });

  await test('MP4 with unset creation_time (0) -> null', async () => {
    assert.strictEqual(await cs.readCaptureTime(F(mp4(null), 'l.mp4', 'video/mp4')), null);
  });

  await test('truncated / garbage video does not throw', async () => {
    assert.strictEqual(await cs.readCaptureTime(F(Uint8Array.from([0, 0, 0, 1, 1, 2]), 'm.mov', 'video/quicktime')), null);
  });

  await test('orderByCaptureTime: ascending, stable ties, undated last in original order', () => {
    const t = (ms) => ({ ms, source: 'exif' });
    const items = [
      { index: 0, t: t(300) },
      { index: 1, t: null },
      { index: 2, t: t(100) },
      { index: 3, t: t(300) },
      { index: 4, t: null },
      { index: 5, t: t(200) },
    ];
    const r = cs.orderByCaptureTime(items);
    assert.deepStrictEqual(r.order, [2, 5, 0, 3, 1, 4]);
    assert.strictEqual(r.datedCount, 4);
    assert.strictEqual(r.undatedCount, 2);
  });

  console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
  process.exit(failed ? 1 : 0);
})();
