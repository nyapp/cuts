#!/usr/bin/env node
// Smoke test for js/46_bulk_import.js classifyFile() (Node 20+).
//   node scripts/bulk_import_smoke.js
const assert = require('assert');
const { classifyFile } = require('../js/46_bulk_import.js');

const F = (name, type = '', lastModified) => new File(['x'], name, { type, ...(lastModified ? { lastModified } : {}) });
let failed = 0;
const t = (name, fn) => { try { fn(); console.log('ok   -', name); } catch (e) { failed += 1; console.log('FAIL -', name, '\n      ', e.message); } };

t('uses the MIME type when present', () => {
  assert.strictEqual(classifyFile(F('a.bin', 'image/jpeg')).kind, 'image');
  assert.strictEqual(classifyFile(F('a.bin', 'video/mp4')).kind, 'video');
});
t('falls back to the extension when MIME is empty and keeps lastModified', () => {
  const lm = Date.UTC(2020, 0, 2);
  const h = classifyFile(F('IMG_0001.HEIC', '', lm));
  assert.strictEqual(h.kind, 'image'); assert.strictEqual(h.file.type, 'image/heic'); assert.strictEqual(h.file.lastModified, lm);
  assert.strictEqual(h.file.name, 'IMG_0001.HEIC');
  const m = classifyFile(F('clip.MOV'));
  assert.strictEqual(m.kind, 'video'); assert.strictEqual(m.file.type, 'video/quicktime');
});
t('rejects non-media', () => {
  assert.strictEqual(classifyFile(F('notes.txt', 'text/plain')), null);
  assert.strictEqual(classifyFile(F('song.mp3', 'audio/mpeg')), null);
  assert.strictEqual(classifyFile(F('noext')), null);
  assert.strictEqual(classifyFile(null), null);
});
console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
