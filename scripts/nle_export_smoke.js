#!/usr/bin/env node
// Smoke test for js/80_nle_export.js (runs in Node, no browser needed).
//
//   node scripts/nle_export_smoke.js [outDir]
//
// Writes sample.xml / sample.srt / sample.otio / sample.fcpxml into outDir
// (default: scripts/out_nle_smoke) and prints the frame table. Use the output
// to verify importability in Premiere / Resolve / FCP, or validate with
// OpenTimelineIO:  otioconvert -i sample.xml -o roundtrip.otio

const fs = require('fs');
const path = require('path');
const nle = require('../js/80_nle_export.js');

const outDir = process.argv[2] || path.join(__dirname, 'out_nle_smoke');
fs.mkdirSync(outDir, { recursive: true });

const input = {
  title: 'sample',
  fps: '29.97',
  format: '1920x1080 / 16:9',
  baseUrl: process.env.CUTS_BASE || '',
  rows: [
    { no: 1, caption: 'オープニング\n二行目', durationSec: 3, visual: { assetId: 'v0001', kind: 'video', file: 'assets/v0001_clip a.mp4', name: 'clip a.mp4', sourceSec: 11.03 } },
    { no: 2, caption: 'Still image cut', durationSec: 2.5, visual: { assetId: 'v0002', kind: 'image', file: 'assets/v0002_still.png', name: 'still.png', sourceSec: null } },
    { no: 3, caption: '', durationSec: 1.7, visual: null },
    { no: 4, caption: 'Short source', durationSec: 4, visual: { assetId: 'v0003', kind: 'video', file: 'assets/v0003_short.mov', name: 'short.mov', sourceSec: 2 } },
    { no: 5, caption: 'zero duration (skipped)', durationSec: 0, visual: null },
  ],
  bgm: { assetId: 'm0001', file: 'assets/m0001_bgm.mp3', name: 'bgm.mp3', sourceSec: 120 },
};

const model = nle.buildTimelineModel(input);
nle.assignPlaceholders(model);

console.log(`fps=${model.fps.rate} timebase=${model.fps.timebase} ntsc=${model.fps.ntsc} size=${model.width}x${model.height} total=${model.totalFrames}f`);
console.table(model.cuts.map((c) => ({ name: c.name, start: c.startFrame, end: c.endFrame, dur: c.durFrames, asset: c.asset && c.asset.file, out: c.asset && c.asset.outFrame })));
if (model.warnings.length) console.log('warnings:\n- ' + model.warnings.join('\n- '));

const files = {
  'sample.xml': nle.buildXmeml(model),
  'sample.srt': nle.buildSrt(model),
  'sample.otio': nle.buildOtio(model),
  'sample.fcpxml': nle.buildFcpxml(model),
  'README.txt': nle.buildReadme(model),
};
for (const [name, text] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), text);
}
console.log('wrote', Object.keys(files).join(', '), '->', outDir);
