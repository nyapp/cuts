#!/usr/bin/env node
// Smoke test for js/12_zip_store.js (Node 20+). Uses unzip / python3 as independent validators when present.
//   node scripts/zip_store_smoke.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const z = require('../js/12_zip_store.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zipstore-'));
let failed = 0;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status !== null;
async function test(name, fn) {
  try { await fn(); console.log('ok   -', name); } catch (e) { failed += 1; console.log('FAIL -', name, '\n      ', e.stack.split('\n').slice(0, 3).join('\n       ')); }
}

const big = crypto.randomBytes(5 * 1024 * 1024 + 123);   // crosses the 8MB chunk? no: exercises partial chunk
const big2 = crypto.randomBytes(9 * 1024 * 1024 + 7);    // crosses the 8MB chunk boundary
const small = Uint8Array.from([1, 2, 3, 4, 5]);
const entries = () => [
  { name: 'manifest.json', data: JSON.stringify({ title: '日本語タイトル', n: 1 }, null, 2) },
  { name: 'assets/v0001_日本語 clip (1).mp4', data: new File([big], 'x.mp4') },
  { name: 'assets/v0002_big2.mov', data: new Blob([big2]) },
  { name: 'assets/v0003_small.bin', data: small },
  { name: 'assets/v0004_empty.txt', data: new Uint8Array(0) },
  { name: 'thumbs/v0001.jpg', data: small },
  { name: 'proj_NLE_20261008-0000/other_formats/a.srt', data: '1\n00:00:00,000 --> 00:00:01,000\nテロップ\n' },
];
const expectHash = {
  'assets/v0001_日本語 clip (1).mp4': sha(big),
  'assets/v0002_big2.mov': sha(big2),
  'assets/v0003_small.bin': sha(small),
  'assets/v0004_empty.txt': sha(Buffer.alloc(0)),
  'thumbs/v0001.jpg': sha(small),
};

async function build(opts) {
  const progress = [];
  const blob = await z.createZipBlob(entries(), { ...opts, onProgress: (d, t, n) => progress.push([d, t, n]) });
  const file = path.join(tmp, opts && opts.forceZip64 ? 'z64.zip' : 'std.zip');
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  return { blob, file, progress };
}

(async () => {
  if (zlib.crc32) await test('crc32Update matches zlib.crc32 (all lengths 0..70, unaligned views, chunked, large)', () => {
    const b = crypto.randomBytes(200000);
    for (let n = 0; n <= 70; n++) assert.strictEqual(z.crc32Update(0, b.subarray(0, n)), zlib.crc32(b.subarray(0, n)), 'len ' + n);
    for (const off of [1, 2, 3, 5]) assert.strictEqual(z.crc32Update(0, b.subarray(off, off + 4099)), zlib.crc32(b.subarray(off, off + 4099)), 'offset ' + off);
    assert.strictEqual(z.crc32Update(0, b), zlib.crc32(b));
    assert.strictEqual(z.crc32Update(z.crc32Update(0, b.subarray(0, 777)), b.subarray(777)), zlib.crc32(b)); // incremental
    const big = crypto.randomBytes(64 * 1024 * 1024);
    const t0 = Date.now();
    assert.strictEqual(z.crc32Update(0, big), zlib.crc32(big));
    console.log(`       (64 MB CRC in ${Date.now() - t0} ms)`);
  });

  for (const force of [false, true]) {
    const label = force ? 'ZIP64 (forced)' : 'standard';
    let built;
    await test(`${label}: builds and reports progress`, async () => {
      built = await build({ forceZip64: force });
      assert.ok(built.blob.size > big.length + big2.length);
      assert.strictEqual(built.progress.length, 6);            // 6 non-empty files
      assert.deepStrictEqual(built.progress[built.progress.length - 1].slice(0, 2), [6, 6]);
    });
    if (!built) continue;

    await test(`${label}: own lazy reader round trip (names, bytes, directories, unicode)`, async () => {
      const f = new File([fs.readFileSync(built.file)], 'p.zip');
      const zip = await z.openZipLazy(f);
      assert.ok(zip && zip.lazy);
      const names = Object.keys(zip.files);
      for (const d of ['assets/', 'thumbs/', 'proj_NLE_20261008-0000/', 'proj_NLE_20261008-0000/other_formats/']) assert.ok(zip.files[d] && zip.files[d].dir, 'dir ' + d);
      assert.strictEqual(zip.file('assets/'), null);
      const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
      assert.strictEqual(manifest.title, '日本語タイトル');
      for (const [name, h] of Object.entries(expectHash)) {
        const blob = await zip.file(name).async('blob');
        assert.strictEqual(sha(Buffer.from(await blob.arrayBuffer())), h, name);
      }
      assert.strictEqual(await zip.file('thumbs/v0001.jpg').async('base64'), Buffer.from(small).toString('base64'));
      assert.ok(names.includes('proj_NLE_20261008-0000/other_formats/a.srt'));
    });

    if (have('unzip')) await test(`${label}: unzip -t (independent validator)`, () => {
      const r = spawnSync('unzip', ['-t', built.file], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      assert.ok(/No errors detected/.test(r.stdout), r.stdout);
    });
    if (have('python3')) await test(`${label}: python zipfile testzip + content check`, () => {
      const code = `
import zipfile, hashlib, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
assert all(i.compress_type == 0 for i in z.infolist())
d = z.read('assets/v0003_small.bin'); assert d == bytes([1,2,3,4,5])
h = hashlib.sha256(z.read('assets/v0002_big2.mov')).hexdigest(); print(h)
assert z.read('manifest.json').decode('utf-8').find('日本語タイトル') > 0
assert any(i.filename.endswith('日本語 clip (1).mp4') for i in z.infolist())
`;
      const r = spawnSync('python3', ['-c', code, built.file], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout.trim(), expectHash['assets/v0002_big2.mov']);
    });
  }

  if (have('python3')) await test('openZipLazy returns null for a DEFLATE archive (caller falls back to JSZip)', async () => {
    const f = path.join(tmp, 'deflate.zip');
    const r = spawnSync('python3', ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); z.writestr('a.txt','hello '*1000); z.close()", f]);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(await z.openZipLazy(new File([fs.readFileSync(f)], 'd.zip')), null);
  });

  await test('openZipLazy returns null for non-zip data', async () => {
    assert.strictEqual(await z.openZipLazy(new File([crypto.randomBytes(5000)], 'x.zip')), null);
    assert.strictEqual(await z.openZipLazy(new File([new Uint8Array(10)], 'tiny.zip')), null);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
  process.exit(failed ? 1 : 0);
})();
