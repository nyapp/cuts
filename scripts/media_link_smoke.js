#!/usr/bin/env node
// Smoke test for js/48_media_link.js pure helpers (Node 20+): relink matching and unique-name detection.
//   node scripts/media_link_smoke.js
const assert = require('assert');
const { matchRelink, uniqueNames } = require('../js/48_media_link.js');

const F = (name, size) => ({ name, size });
let failed = 0;
const t = (name, fn) => { try { fn(); console.log('ok   -', name); } catch (e) { failed += 1; console.log('FAIL -', name, '\n      ', e.message); } };

t('matches by name and size anywhere in the folder tree', () => {
  const files = [F('IMG_0001.MOV', 100), F('IMG_0002.MOV', 200), F('notes.txt', 5)];
  const r = matchRelink([{ assetId: 'v1', name: 'IMG_0002.MOV', size: 200 }, { assetId: 'v2', name: 'IMG_0001.MOV', size: 100 }], files);
  assert.deepStrictEqual(r.matched.map((m) => [m.assetId, m.file.name]), [['v1', 'IMG_0002.MOV'], ['v2', 'IMG_0001.MOV']]);
  assert.deepStrictEqual(r.missing, []);
});
t('same name but different size is not a match (different clip)', () => {
  const r = matchRelink([{ assetId: 'v1', name: 'a.mov', size: 100 }], [F('a.mov', 999)]);
  assert.strictEqual(r.matched.length, 0);
  assert.deepStrictEqual(r.missing, ['v1']);
});
t('two cuts with the same name+size each get a different file (no reuse)', () => {
  const f1 = F('a.mov', 100); const f2 = F('a.mov', 100);
  const r = matchRelink([{ assetId: 'v1', name: 'a.mov', size: 100 }, { assetId: 'v2', name: 'a.mov', size: 100 }], [f1, f2]);
  assert.strictEqual(r.matched[0].file, f1);
  assert.strictEqual(r.matched[1].file, f2);
});
t('unknown size matches by name only', () => {
  assert.strictEqual(matchRelink([{ assetId: 'v1', name: 'a.mov', size: null }], [F('a.mov', 7)]).matched.length, 1);
  assert.strictEqual(matchRelink([{ assetId: 'v1', name: 'a.mov' }], [F('a.mov', 7)]).matched.length, 1);
});
t('Unicode normalization (macOS decomposed Japanese names) and case', () => {
  const nfd = 'がぞう.MOV'.normalize('NFD');
  const nfc = 'がぞう.mov'.normalize('NFC');
  assert.notStrictEqual(nfd, nfc);
  assert.strictEqual(matchRelink([{ assetId: 'v1', name: nfc, size: 1 }], [F(nfd, 1)]).matched.length, 1);
});
t('uniqueNames flags duplicates (they must be bundled, not linked)', () => {
  const ok = uniqueNames(['a.mov', 'b.mov', 'A.MOV', 'c.mov']);
  assert.strictEqual(ok('b.mov'), true);
  assert.strictEqual(ok('a.mov'), false);
  assert.strictEqual(ok('c.mov'), true);
});
console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
