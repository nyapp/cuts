// js/80_nle_export.js
// Export the current storyboard as an NLE-importable timeline bundle.
//
// Output ZIP layout (everything under one top-level folder so any unzipper yields it):
//   <title>_NLE_<yyyymmdd-hhmm>/
//     <title>.xml              Final Cut Pro 7 XML (xmeml v4) -> Premiere Pro, DaVinci Resolve.
//                              V1 = cuts, V2 = captions as FCP7 Text generators (Premiere turns them
//                              into titles/graphics), A1 = BGM.
//     assets/                  referenced media (same naming as the project ZIP) + placeholder PNGs
//     README.txt               import steps (ja)
//     other_formats/<title>.srt     captions as SubRip (fallback / Resolve / FCP)
//     other_formats/<title>.otio    OpenTimelineIO JSON (Premiere Pro 2026, Resolve, Blender)
//     other_formats/<title>.fcpxml  FCPXML 1.11 (Final Cut Pro, with editable titles)
//
// Media paths: the user sets the folder where they unzip exports (NLE FOLDER in the controls bar,
// remembered in localStorage). Paths are written as <folder>/<title>_NLE_<stamp>/assets/... so an
// export unzipped there links without any relink dialog. Empty folder -> relative paths.
//
// The serializers below are pure functions of a "timeline model" so they can be
// unit-tested in Node (see scripts/nle_export_smoke.js). Browser-only code
// (DOM access, media probing, canvas placeholders, JSZip) lives in exportForNle().
//
// Depends on globals when run in the browser: createZipBlob / downloadBlob / setBusyStatus (js/12_zip_store.js), val, sanitizeFilename, assetStore.

(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Frame rate / format helpers
  // ---------------------------------------------------------------------------

  // "29.97" -> { rate: 29.97, timebase: 30, ntsc: true, frameDuration: "1001/30000s", num: 1001, den: 30000 }
  function parseFps(fpsStr) {
    const n = Number(String(fpsStr || '').trim());
    const fps = Number.isFinite(n) && n > 0 ? n : 30;
    const near = (a, b) => Math.abs(a - b) < 0.01;
    let timebase;
    let ntsc = false;
    if (near(fps, 23.976)) { timebase = 24; ntsc = true; }
    else if (near(fps, 29.97)) { timebase = 30; ntsc = true; }
    else if (near(fps, 59.94)) { timebase = 60; ntsc = true; }
    else { timebase = Math.round(fps); }
    const num = ntsc ? 1001 : 100;
    const den = ntsc ? timebase * 1000 : timebase * 100;
    const rate = ntsc ? Math.round((timebase * 1000 / 1001) * 1000) / 1000 : timebase;
    return { rate, timebase, ntsc, num, den, frameDuration: `${num}/${den}s` };
  }

  // "1920x1080 / 16:9" -> { width: 1920, height: 1080 }
  function parseFormat(formatStr) {
    const m = String(formatStr || '').match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
    if (!m) return { width: 1920, height: 1080 };
    return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  }

  function pad2(n, width) {
    return String(n).padStart(Math.max(2, width || 2), '0');
  }

  function escXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Build a file URL from a user-supplied base folder and a relative path.
  // base "" -> relative path (NLE will ask to relink; README explains).
  // base "/Users/me/proj" -> file://localhost/Users/me/proj/assets/x.mp4 (xmeml)
  // base "C:\\work\\proj"   -> file://localhost/C:/work/proj/assets/x.mp4
  function toFileUrl(base, relPath, style) {
    const encSeg = (seg) => encodeURIComponent(seg).replace(/%3A/gi, ':');
    const rel = String(relPath || '').split('/').map(encSeg).join('/');
    const b = String(base || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!b) return rel;
    const parts = b.split('/').map(encSeg);
    let path = parts.join('/');
    if (!path.startsWith('/')) path = '/' + path; // "C:/..." -> "/C:/..."
    const host = style === 'localhost' ? 'file://localhost' : 'file://';
    return `${host}${path}/${rel}`;
  }

  // ---------------------------------------------------------------------------
  // Timeline model
  // ---------------------------------------------------------------------------
  //
  // input = {
  //   title, fps, format, baseUrl,
  //   rows: [{ no, caption, durationSec, visual: { assetId, kind: 'image'|'video'|'placeholder', file, name, sourceSec } | null }],
  //   bgm:  { assetId, file, name, sourceSec } | null
  // }
  function buildTimelineModel(input) {
    const fps = parseFps(input.fps);
    const { width, height } = parseFormat(input.format);
    const title = String(input.title || 'untitled').trim() || 'untitled';
    const baseUrl = String(input.baseUrl || '');
    const safeTitle = title.replace(/[\\\/:*?"<>|]/g, '_');
    const exportFolder = input.exportFolder || `${safeTitle}_NLE_${exportStamp(input.now)}`;
    const toFrames = (sec) => Math.round(sec * fps.rate + 1e-6);

    const warnings = [];
    const cuts = [];
    const validRows = (input.rows || []).filter((r) => {
      const d = Number(r.durationSec);
      return Number.isFinite(d) && d > 0;
    });
    const noWidth = String(Math.max(validRows.length, 1)).length;

    let cumSec = 0;
    validRows.forEach((r, i) => {
      const startFrame = toFrames(cumSec);
      cumSec += Number(r.durationSec);
      const endFrame = toFrames(cumSec);
      const durFrames = endFrame - startFrame;
      if (durFrames <= 0) {
        warnings.push(`Cut ${r.no}: duration rounds to 0 frames; skipped.`);
        return;
      }
      const name = `Cut ${pad2(i + 1, noWidth)}`;
      const caption = String(r.caption || '').replace(/\r\n?/g, '\n').trim();
      const v = r.visual;
      let asset;
      if (v && v.file) {
        const kind = v.kind === 'video' ? 'video' : (v.kind === 'placeholder' ? 'placeholder' : 'image');
        let sourceFrames = null;
        let outFrame = durFrames;
        if (kind === 'video') {
          const s = Number(v.sourceSec);
          if (Number.isFinite(s) && s > 0) {
            sourceFrames = toFrames(s);
            if (sourceFrames < durFrames) {
              outFrame = sourceFrames;
              warnings.push(`${name}: source video is ${sourceFrames}f but the cut is ${durFrames}f; clip shortened to source length.`);
            }
          } else {
            warnings.push(`${name}: source duration unknown; assumed at least ${durFrames}f.`);
            sourceFrames = durFrames;
          }
        }
        asset = {
          assetId: v.assetId || `cut${i + 1}`,
          kind,
          file: v.file,
          name: v.name || v.file.split('/').pop(),
          sourceFrames,
          inFrame: 0,
          outFrame,
        };
      } else {
        asset = null; // caller may attach a generated placeholder
      }
      cuts.push({ no: i + 1, name, caption, startFrame, endFrame, durFrames, asset });
    });

    const totalFrames = cuts.length ? cuts[cuts.length - 1].endFrame : 0;

    let bgm = null;
    if (input.bgm && input.bgm.file) {
      const s = Number(input.bgm.sourceSec);
      const sourceFrames = Number.isFinite(s) && s > 0 ? toFrames(s) : null;
      let outFrame = totalFrames;
      if (sourceFrames != null && sourceFrames < totalFrames) {
        outFrame = sourceFrames;
        warnings.push(`BGM is shorter than the timeline (${sourceFrames}f < ${totalFrames}f).`);
      }
      if (sourceFrames == null) warnings.push('BGM duration unknown; assumed to cover the whole timeline.');
      bgm = {
        assetId: input.bgm.assetId || 'bgm',
        file: input.bgm.file,
        name: input.bgm.name || input.bgm.file.split('/').pop(),
        sourceFrames: sourceFrames == null ? totalFrames : sourceFrames,
        inFrame: 0,
        outFrame,
      };
    }

    return { title, safeTitle, exportFolder, fps, width, height, baseUrl, cuts, bgm, totalFrames, warnings };
  }

  // yyyymmdd-hhmm, local time
  function exportStamp(now) {
    const d = now instanceof Date ? now : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  // Media URL for a model-relative path (assets/...), including the export folder.
  function mediaUrl(model, rel, style) {
    return toFileUrl(model.baseUrl, `${model.exportFolder}/${rel}`, style);
  }

  // Attach placeholder assets (kind 'placeholder') for cuts without a visual.
  // Returns the list of placeholders the caller must render into the ZIP.
  function assignPlaceholders(model) {
    const list = [];
    model.cuts.forEach((c) => {
      if (c.asset) return;
      const file = `assets/placeholder_${pad2(c.no, String(model.cuts.length).length)}.png`;
      c.asset = {
        assetId: `ph${c.no}`,
        kind: 'placeholder',
        file,
        name: file.split('/').pop(),
        sourceFrames: null,
        inFrame: 0,
        outFrame: c.durFrames,
      };
      list.push({ cut: c, file });
    });
    return list;
  }

  // ---------------------------------------------------------------------------
  // Serializer: Final Cut Pro 7 XML (xmeml v4) — Premiere Pro / DaVinci Resolve
  // ---------------------------------------------------------------------------
  function buildXmeml(model) {
    const { fps, width, height } = model;
    const ntsc = fps.ntsc ? 'TRUE' : 'FALSE';
    const rate = `<rate><timebase>${fps.timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
    const url = (rel) => mediaUrl(model, rel, 'localhost');
    const lines = [];
    const L = (s) => lines.push(s);

    const fileIds = new Map();
    let fileSeq = 0;
    let clipSeq = 0;

    const fileElem = (asset, isAudio) => {
      let id = fileIds.get(asset.assetId);
      if (id) return `<file id="${id}"/>`;
      id = `file-${++fileSeq}`;
      fileIds.set(asset.assetId, id);
      const isStill = asset.kind !== 'video' && !isAudio;
      const dur = isStill ? asset.outFrame : asset.sourceFrames;
      let media;
      if (isAudio) {
        media = `<media><audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media>`;
      } else {
        media = `<media><video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video></media>`;
      }
      return [
        `<file id="${id}">`,
        `<name>${escXml(asset.name)}</name>`,
        `<pathurl>${escXml(url(asset.file))}</pathurl>`,
        rate,
        `<duration>${dur}</duration>`,
        `<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`,
        media,
        `</file>`,
      ].join('');
    };

    L('<?xml version="1.0" encoding="UTF-8"?>');
    L('<!DOCTYPE xmeml>');
    L('<xmeml version="4">');
    L('<sequence id="sequence-1">');
    L(`<name>${escXml(model.title)}</name>`);
    L(`<duration>${model.totalFrames}</duration>`);
    L(rate);
    L(`<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`);
    L('<in>-1</in><out>-1</out>');
    L('<media>');
    // --- video ---
    L('<video>');
    L(`<format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>`);
    L('<track>');
    model.cuts.forEach((c) => {
      const a = c.asset;
      if (!a) return;
      const id = `clipitem-${++clipSeq}`;
      const clipDur = a.kind === 'video' ? a.sourceFrames : a.outFrame;
      L(`<clipitem id="${id}">`);
      L(`<masterclipid>masterclip-${clipSeq}</masterclipid>`);
      L(`<name>${escXml(c.name)}</name>`);
      L('<enabled>TRUE</enabled>');
      L(`<duration>${clipDur}</duration>`);
      L(rate);
      L(`<start>${c.startFrame}</start><end>${c.startFrame + (a.outFrame - a.inFrame)}</end>`);
      L(`<in>${a.inFrame}</in><out>${a.outFrame}</out>`);
      L('<alphatype>none</alphatype><pixelaspectratio>square</pixelaspectratio><anamorphic>FALSE</anamorphic>');
      L(fileElem(a, false));
      if (c.caption) L(`<comments><mastercomment1>${escXml(c.caption)}</mastercomment1></comments>`);
      L('</clipitem>');
    });
    L('</track>');
    // --- V2: captions as FCP7 "Text" generators (Premiere imports them as titles) ---
    L('<track>');
    model.cuts.forEach((c) => {
      if (!c.caption) return;
      const id = `clipitem-${++clipSeq}`;
      L(textGeneratorItem(id, c, model));
    });
    L('</track>');
    L('</video>');
    // --- audio ---
    L('<audio>');
    L('<numOutputChannels>2</numOutputChannels>');
    L('<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>');
    L('<outputs><group><index>1</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>1</index></channel></group><group><index>2</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>2</index></channel></group></outputs>');
    L('<track>');
    if (model.bgm) {
      const b = model.bgm;
      const id = `clipitem-${++clipSeq}`;
      L(`<clipitem id="${id}">`);
      L(`<masterclipid>masterclip-${clipSeq}</masterclipid>`);
      L(`<name>${escXml(b.name)}</name>`);
      L('<enabled>TRUE</enabled>');
      L(`<duration>${b.sourceFrames}</duration>`);
      L(rate);
      L(`<start>0</start><end>${b.outFrame}</end>`);
      L(`<in>${b.inFrame}</in><out>${b.outFrame}</out>`);
      L(fileElem(b, true));
      L('<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>');
      L('</clipitem>');
    }
    L('</track>');
    L('</audio>');
    L('</media>');
    L('</sequence>');
    L('</xmeml>');
    return lines.join('\n') + '\n';
  }

  // FCP7 "Text" generator item for one cut (V2). Premiere Pro converts FCP7 Text
  // generators to titles on import; Resolve shows them as Text+ / generator.
  const TITLE_FONT = 'Hiragino Sans';
  function textGeneratorItem(id, cut, model) {
    const { fps, height } = model;
    const rate = `<rate><timebase>${fps.timebase}</timebase><ntsc>${fps.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
    const dur = cut.durFrames;
    const fontSize = Math.max(24, Math.round(height / 18));
    const param = (pid, name, value, extra) => `<parameter><parameterid>${pid}</parameterid><name>${name}</name>${extra || ''}<value>${value}</value></parameter>`;
    return [
      `<generatoritem id="${id}">`,
      `<name>${escXml(cut.caption.split('\n')[0])}</name>`,
      `<duration>${dur}</duration>`,
      rate,
      `<start>${cut.startFrame}</start><end>${cut.endFrame}</end>`,
      `<in>0</in><out>${dur}</out>`,
      '<enabled>TRUE</enabled><anamorphic>FALSE</anamorphic><alphatype>black</alphatype>',
      '<effect><name>Text</name><effectid>Text</effectid><effectcategory>Text</effectcategory><effecttype>generator</effecttype><mediatype>video</mediatype>',
      param('str', 'Text', escXml(cut.caption)),
      param('fontname', 'Font', escXml(TITLE_FONT)),
      param('fontsize', 'Size', fontSize, '<valuemin>0</valuemin><valuemax>1000</valuemax>'),
      param('fontstyle', 'Style', 1, '<valuemin>1</valuemin><valuemax>4</valuemax>'),
      param('fontalign', 'Alignment', 2, '<valuemin>1</valuemin><valuemax>3</valuemax>'),
      param('fontcolor', 'Font Color', '<alpha>255</alpha><red>255</red><green>255</green><blue>255</blue>'),
      param('origin', 'Origin', '<horiz>0</horiz><vert>0.35</vert>'),
      param('fonttrack', 'Tracking', 1, '<valuemin>-200</valuemin><valuemax>200</valuemax>'),
      param('leading', 'Leading', 0, '<valuemin>-100</valuemin><valuemax>100</valuemax>'),
      param('aspect', 'Aspect', 1, '<valuemin>0.1</valuemin><valuemax>5</valuemax>'),
      param('autokern', 'Auto Kerning', 'TRUE'),
      param('subpixel', 'Use Subpixel', 'TRUE'),
      '</effect>',
      '<sourcetrack><mediatype>video</mediatype></sourcetrack>',
      '</generatoritem>',
    ].join('');
  }

  // ---------------------------------------------------------------------------
  // Serializer: SubRip (.srt) — captions track in Premiere / Resolve / FCP
  // ---------------------------------------------------------------------------
  function buildSrt(model) {
    const toTs = (frames) => {
      const ms = Math.round((frames / model.fps.rate) * 1000);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const r = ms % 1000;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
    };
    const out = [];
    let n = 0;
    model.cuts.forEach((c) => {
      if (!c.caption) return;
      n += 1;
      out.push(String(n));
      out.push(`${toTs(c.startFrame)} --> ${toTs(c.endFrame)}`);
      out.push(c.caption);
      out.push('');
    });
    return out.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Serializer: OpenTimelineIO JSON (.otio)
  // ---------------------------------------------------------------------------
  function buildOtio(model) {
    const rate = model.fps.rate;
    const RT = (v) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: v });
    const TR = (start, dur) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: RT(start), duration: RT(dur) });
    const url = (rel) => mediaUrl(model, rel, 'triple');
    const clip = (name, asset, inF, outF, metadata) => ({
      OTIO_SCHEMA: 'Clip.2',
      metadata: metadata || {},
      name,
      source_range: TR(inF, outF - inF),
      effects: [],
      markers: [],
      enabled: true,
      media_references: {
        DEFAULT_MEDIA: {
          OTIO_SCHEMA: 'ExternalReference.1',
          metadata: {},
          name: asset.name,
          available_range: TR(0, asset.kind === 'video' || asset.sourceFrames != null ? asset.sourceFrames : outF),
          available_image_bounds: null,
          target_url: url(asset.file),
        },
      },
      active_media_reference_key: 'DEFAULT_MEDIA',
    });
    const track = (name, kind, children) => ({
      OTIO_SCHEMA: 'Track.1', metadata: {}, name, source_range: null, effects: [], markers: [], enabled: true, color: null, children, kind,
    });

    const videoChildren = model.cuts.filter((c) => c.asset).map((c) => {
      const cl = clip(c.name, c.asset, c.asset.inFrame, c.asset.outFrame, { CUTS: { no: c.no, caption: c.caption, kind: c.asset.kind } });
      if (c.asset.outFrame - c.asset.inFrame < c.durFrames) {
        // keep timeline positions: pad with a gap when the source was shorter than the cut
        return [cl, { OTIO_SCHEMA: 'Gap.1', metadata: {}, name: '', source_range: TR(0, c.durFrames - (c.asset.outFrame - c.asset.inFrame)), effects: [], markers: [], enabled: true }];
      }
      return [cl];
    }).flat();

    const audioChildren = model.bgm ? [clip(model.bgm.name, model.bgm, model.bgm.inFrame, model.bgm.outFrame, { CUTS: { role: 'bgm' } })] : [];

    const timeline = {
      OTIO_SCHEMA: 'Timeline.1',
      metadata: { CUTS: { generator: 'CUTS', width: model.width, height: model.height } },
      name: model.title,
      global_start_time: RT(0),
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        metadata: {},
        name: 'tracks',
        source_range: null,
        effects: [],
        markers: [],
        enabled: true,
        color: null,
        children: [track('V1', 'Video', videoChildren), track('A1', 'Audio', audioChildren)],
      },
    };
    return JSON.stringify(timeline, null, 2) + '\n';
  }

  // ---------------------------------------------------------------------------
  // Serializer: FCPXML 1.11 — Final Cut Pro / DaVinci Resolve (editable titles)
  // ---------------------------------------------------------------------------
  function buildFcpxml(model) {
    const { fps, width, height } = model;
    const T = (frames) => (frames === 0 ? '0s' : `${frames * fps.num}/${fps.den}s`);
    const url = (rel) => mediaUrl(model, rel, 'triple');
    const fmtName = (() => {
      const std = { 1080: '1080', 2160: '2160', 720: '720' }[height];
      const r = { 23.976: '2398', 24: '24', 25: '25', 29.97: '2997', 30: '30', 50: '50', 59.94: '5994', 60: '60' }[fps.rate];
      return std && r && width > height ? ` name="FFVideoFormat${std}p${r}"` : '';
    })();
    const BASIC_TITLE_UID = '.../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti';
    const lines = [];
    const L = (s) => lines.push(s);

    // resources
    const assetIds = new Map();
    let rSeq = 2; // r1 = format, r2 = title effect
    const resources = [];
    const assetRes = (asset, isAudio) => {
      if (assetIds.has(asset.assetId)) return assetIds.get(asset.assetId);
      const id = `r${++rSeq + 0}`;
      assetIds.set(asset.assetId, id);
      const src = escXml(url(asset.file));
      if (isAudio) {
        resources.push(`<asset id="${id}" name="${escXml(asset.name)}" start="0s" duration="${T(asset.sourceFrames)}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"><media-rep kind="original-media" src="${src}"/></asset>`);
      } else if (asset.kind === 'video') {
        resources.push(`<asset id="${id}" name="${escXml(asset.name)}" start="0s" duration="${T(asset.sourceFrames)}" hasVideo="1" format="r1" videoSources="1"><media-rep kind="original-media" src="${src}"/></asset>`);
      } else {
        resources.push(`<asset id="${id}" name="${escXml(asset.name)}" start="0s" duration="0s" hasVideo="1" format="r1" videoSources="1"><media-rep kind="original-media" src="${src}"/></asset>`);
      }
      return id;
    };
    model.cuts.forEach((c) => { if (c.asset) assetRes(c.asset, false); });
    if (model.bgm) assetRes(model.bgm, true);

    L('<?xml version="1.0" encoding="UTF-8"?>');
    L('<!DOCTYPE fcpxml>');
    L('<fcpxml version="1.11">');
    L('<resources>');
    L(`<format id="r1"${fmtName} frameDuration="${fps.frameDuration}" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>`);
    L(`<effect id="r2" name="Basic Title" uid="${escXml(BASIC_TITLE_UID)}"/>`);
    resources.forEach(L);
    L('</resources>');
    L('<library>');
    L('<event name="CUTS">');
    L(`<project name="${escXml(model.title)}">`);
    L(`<sequence format="r1" duration="${T(model.totalFrames)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`);
    L('<spine>');
    let tsSeq = 0;
    model.cuts.forEach((c, i) => {
      const a = c.asset;
      if (!a) return;
      const ref = assetIds.get(a.assetId);
      const len = a.outFrame - a.inFrame;
      const tag = a.kind === 'video' ? 'asset-clip' : 'video';
      L(`<${tag} ref="${ref}" offset="${T(c.startFrame)}" name="${escXml(c.name)}" start="${T(a.inFrame)}" duration="${T(len)}">`);
      if (i === 0 && model.bgm) {
        const b = model.bgm;
        L(`<asset-clip ref="${assetIds.get(b.assetId)}" lane="-1" offset="${T(a.inFrame)}" name="${escXml(b.name)}" start="${T(b.inFrame)}" duration="${T(b.outFrame - b.inFrame)}" audioRole="music"/>`);
      }
      if (c.caption) {
        const ts = `ts${++tsSeq}`;
        L(`<title ref="r2" lane="1" offset="${T(a.inFrame)}" name="${escXml(c.caption.split('\n')[0])}" start="0s" duration="${T(len)}">`);
        L(`<text><text-style ref="${ts}">${escXml(c.caption)}</text-style></text>`);
        L(`<text-style-def id="${ts}"><text-style font="Helvetica" fontSize="72" fontFace="Regular" fontColor="1 1 1 1" alignment="center"/></text-style-def>`);
        L('</title>');
      }
      if (len < c.durFrames) {
        L(`</${tag}>`);
        L(`<gap name="Gap" offset="${T(c.startFrame + len)}" start="0s" duration="${T(c.durFrames - len)}"/>`);
        return;
      }
      L(`</${tag}>`);
    });
    L('</spine>');
    L('</sequence>');
    L('</project>');
    L('</event>');
    L('</library>');
    L('</fcpxml>');
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------------
  // README (ja) bundled into the ZIP
  // ---------------------------------------------------------------------------
  function buildReadme(model) {
    const t = model.safeTitle;
    const rel = !model.baseUrl;
    return [
      `CUTS NLE export: ${model.title}`,
      '',
      'Premiere Pro での手順',
      rel
        ? '  1. この ZIP を展開する（macOS はダブルクリック）'
        : `  1. この ZIP を「NLE FOLDER」に指定したフォルダ（${model.baseUrl}）で展開する（macOS はダブルクリック）`,
      `  2. Premiere で File > 読み込み → ${t}.xml`,
      rel
        ? '  3. 「メディアをリンク」が出たら assets/ の中のファイルを 1 つ選ぶ（残りは自動で再リンク）'
        : '  3. 以上。メディアは自動でリンクされる（別の場所に展開した場合だけ「メディアをリンク」で assets/ のファイルを 1 つ選ぶ）',
      '',
      '開いた後のシーケンス',
      '  V1  各カット（Cut 01, 02, ...）。尺どおりに並ぶ。Visual Reference が無いカットは黒地にカット番号の PNG',
      '  V2  テロップ（Text ジェネレータ → Premiere がタイトル/グラフィックに変換）。クリップと一緒に動く',
      '  A1  BGM（設定していた場合）',
      '',
      '同梱ファイル',
      `  ${t}.xml                  Final Cut Pro 7 XML。Premiere / DaVinci Resolve 用`,
      '  assets/                   参照メディア',
      `  other_formats/${t}.srt    テロップの字幕ファイル（V2 のタイトルがうまく出ない場合の代替。読み込んでシーケンスにドロップ）`,
      `  other_formats/${t}.otio   OpenTimelineIO。Premiere Pro 2026 / Resolve / Blender 用`,
      `  other_formats/${t}.fcpxml FCPXML 1.11。Final Cut Pro 用（テロップは Basic Title）`,
      '',
      '注意',
      '  - 尺は秒からフレームに丸めている（累積で丸めるので合計尺はズレない）',
      '  - 動画素材はカットの尺より短い場合、素材の長さで切っている',
      '  - 動画素材の音声は載せていない（A1 は BGM のみ）',
      '  - 動画素材は先頭（00:00）から使用。イン点の指定は今後の拡張',
      '',
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Browser glue
  // ---------------------------------------------------------------------------

  // Probe media duration (seconds) from a File via <video>/<audio>. Resolves null on failure/timeout.
  function probeMediaDuration(file, kind) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined' || !file) return resolve(null);
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      const u = URL.createObjectURL(file);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        try { URL.revokeObjectURL(u); } catch (_) {}
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), 8000);
      el.preload = 'metadata';
      el.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        const d = el.duration;
        finish(Number.isFinite(d) && d > 0 ? d : null);
      });
      el.addEventListener('error', () => { clearTimeout(timer); finish(null); });
      el.src = u;
    });
  }

  // Render a placeholder PNG (Blob) for a cut without a visual reference.
  function renderPlaceholderPng(cut, width, height) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#444';
      ctx.lineWidth = Math.max(2, Math.round(width / 480));
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, width - ctx.lineWidth * 2, height - ctx.lineWidth * 2);
      ctx.fillStyle = '#e6e6e6';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const big = Math.round(Math.min(width, height) / 6);
      ctx.font = `bold ${big}px Helvetica, Arial, sans-serif`;
      ctx.fillText(cut.name.toUpperCase(), width / 2, height / 2 - big * 0.4);
      if (cut.caption) {
        const small = Math.round(big / 3);
        ctx.font = `${small}px Helvetica, Arial, "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.fillStyle = '#bdbdbd';
        const lines = cut.caption.split('\n').slice(0, 3);
        lines.forEach((ln, i) => {
          let s = ln;
          while (s && ctx.measureText(s).width > width * 0.9) s = s.slice(0, -1);
          ctx.fillText(s, width / 2, height / 2 + big * 0.5 + i * small * 1.4);
        });
      }
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  // Collect the current UI state into the exporter input shape.
  async function collectExportInput(baseUrl) {
    const rows = [];
    const trs = document.querySelectorAll('#storyboard-body tr');
    for (let idx = 0; idx < trs.length; idx++) {
      const row = trs[idx];
      const box = row.querySelector('.visual-box');
      const captionEl = row.querySelector('.input-audio');
      const durEl = row.querySelector('.input-duration');
      const item = {
        no: idx + 1,
        caption: captionEl ? captionEl.innerText : '',
        durationSec: durEl ? Number(String(durEl.value || '').trim()) : 0,
        visual: null,
      };
      if (box && box.dataset && box.dataset.assetId) {
        const id = box.dataset.assetId;
        const name = sanitizeFilename(box.dataset.assetName || box.dataset.filename || `cut_${idx + 1}`);
        const kind = (box.dataset.kind || '').toLowerCase() === 'video' ? 'video' : 'image';
        let sourceSec = kind === 'video' ? Number(box.dataset.sourceDuration) : null;
        if (kind === 'video' && !(sourceSec > 0)) {
          sourceSec = await probeMediaDuration(assetStore.get(id), 'video');
        }
        item.visual = { assetId: id, kind, file: `assets/${id}_${name}`, name, sourceSec };
      }
      rows.push(item);
    }

    let bgm = null;
    const bgmBox = document.getElementById('bgm-box');
    if (bgmBox && bgmBox.dataset && bgmBox.dataset.assetId) {
      const id = bgmBox.dataset.assetId;
      const name = sanitizeFilename(bgmBox.dataset.assetName || bgmBox.dataset.filename || 'bgm');
      const sourceSec = await probeMediaDuration(assetStore.get(id), 'audio');
      bgm = { assetId: id, file: `assets/${id}_${name}`, name, sourceSec };
    }

    return {
      title: val('h-title') || 'project',
      fps: val('h-fps'),
      format: val('h-format'),
      baseUrl,
      now: new Date(),
      rows,
      bgm,
    };
  }

  const BASE_KEY = 'cuts.nleExport.baseFolder';

  function getNleFolder() {
    const el = typeof document !== 'undefined' ? document.getElementById('nle-folder') : null;
    if (el) return String(el.value || '').trim();
    try { return localStorage.getItem(BASE_KEY) || ''; } catch (_) { return ''; }
  }

  // Wire the NLE FOLDER input: restore from localStorage, persist on change.
  function setupNleFolderInput() {
    const el = document.getElementById('nle-folder');
    if (!el) return;
    try { el.value = localStorage.getItem(BASE_KEY) || ''; } catch (_) {}
    el.addEventListener('change', () => {
      try { localStorage.setItem(BASE_KEY, String(el.value || '').trim()); } catch (_) {}
    });
  }

  async function exportForNle() {
    try {
      const baseUrl = getNleFolder();
      const input = await collectExportInput(baseUrl);
      const model = buildTimelineModel(input);
      if (!model.cuts.length) {
        alert('書き出せるカットがありません（尺が 0 の行は無視されます）。');
        return;
      }
      const placeholders = assignPlaceholders(model);

      // Build the ZIP without loading media into memory (see js/12_zip_store.js).
      const top = model.exportFolder;
      const entries = [
        { name: `${top}/${model.safeTitle}.xml`, data: buildXmeml(model) },
        { name: `${top}/README.txt`, data: buildReadme(model) },
        { name: `${top}/other_formats/${model.safeTitle}.srt`, data: buildSrt(model) },
        { name: `${top}/other_formats/${model.safeTitle}.otio`, data: buildOtio(model) },
        { name: `${top}/other_formats/${model.safeTitle}.fcpxml`, data: buildFcpxml(model) },
      ];

      const used = new Set();
      model.cuts.forEach((c) => { if (c.asset && c.asset.kind !== 'placeholder') used.add(c.asset.assetId); });
      if (model.bgm) used.add(model.bgm.assetId);
      for (const [assetId, file] of assetStore.entries()) {
        if (!used.has(assetId)) continue;
        entries.push({ name: `${top}/assets/${assetId}_${sanitizeFilename(file.name || 'asset')}`, data: file });
      }
      for (const ph of placeholders) {
        const blob = await renderPlaceholderPng(ph.cut, model.width, model.height);
        if (blob) entries.push({ name: `${top}/${ph.file}`, data: blob });
      }

      setBusyStatus('NLE 用 ZIP を作成中…');
      const blob = await createZipBlob(entries, {
        onProgress: (done, total) => setBusyStatus(`NLE 用 ZIP を作成中… ${done} / ${total}`),
      });
      downloadBlob(blob, `${model.exportFolder}.zip`);
      setBusyStatus(`書き出しました（${formatBytes(blob.size)}）`);

      if (model.warnings.length) {
        alert('書き出しました。注意:\n- ' + model.warnings.join('\n- '));
      }
    } catch (err) {
      console.error(err);
      setBusyStatus('');
      alert('Failed to export for NLE.');
    }
  }

  // ---------------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------------
  const api = {
    parseFps, parseFormat, toFileUrl,
    buildTimelineModel, assignPlaceholders,
    buildXmeml, buildSrt, buildOtio, buildFcpxml, buildReadme,
    exportForNle, setupNleFolderInput,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CutsNleExport = api;
  root.exportForNle = exportForNle;
  root.setupNleFolderInput = setupNleFolderInput;
})(typeof window !== 'undefined' ? window : globalThis);
