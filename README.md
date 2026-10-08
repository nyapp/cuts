# CUTS  
**Cut-based Unified Timeline Sheet**

> **English**: CUTS is a local-first, browser-based tool for planning video timelines in a cut-based (storyboard) style. Add shots, set durations (start times are calculated automatically), attach visual references and BGM, then save as ZIP. No server or account required — open `index.html` and start planning.
>
> **日本語**: CUTS は、カット（場面）単位で映像タイムラインを計画するローカルファーストのブラウザツールです。カットを追加し、尺（秒）を入力すると開始時刻が自動計算され、ZIP に含まれます。画像・動画や BGM を紐付け、ZIP で保存できます。サーバー不要で、`index.html` を開くだけで利用できます。

---

## Features

- **Cut-based storyboard** — Add shots, set duration per cut; start times are calculated automatically and included in export.
- **Project header** — Title (delivery filename), date, version, platform (Signage / YouTube / Instagram Reels / TikTok / Web / Internal), format (resolution & aspect), FPS, loudness (LUFS), delivery (codec / container / audio).
- **Main BGM** — Attach one main BGM file for the whole project; saved in the project ZIP.
- **Visual reference per cut** — Image or video per row; paste or drag-and-drop supported.
- **On-screen text / caption** — Editable caption per cut (e.g. for supers or notes).
- **Row reorder** — Drag rows by the handle (No. column); row menu (⋯) for delete.
- **ZIP project** — Save/load project as a single ZIP (manifest + assets + thumbnails); version auto-increments on save.
- **Print → PDF** — A4-friendly layout; use browser Print (Ctrl+P / Cmd+P) to export as PDF.
- **Bulk import** — **IMPORT MEDIA** takes many photos / videos at once (phones: the photo library picker), one cut per file. You can also drop files anywhere on the page. See [Bulk import](#bulk-import).
- **Sort by capture time** — One button reorders the cuts by when each image / video was captured (photo EXIF, video metadata). Cuts without a time go to the end; one tap undoes it. See [Sort by capture time](#sort-by-capture-time).
- **Phone-friendly** — At 640 px and below each cut becomes a card (No. / sec, visual, caption), the buttons move to a bottom toolbar, and form fields are 16 px so iOS Safari does not zoom. Tap a visual box to add or replace an image/video; use the ⋯ menu for Move up / Move down / Clear visual / Delete.
- **Export NLE** — One ZIP with a Final Cut Pro 7 XML (Premiere Pro / DaVinci Resolve; cuts on V1, captions on V2 as titles, BGM on A1), the referenced media, and `other_formats/` (OpenTimelineIO, FCPXML, SRT). See [docs/NLE_EXPORT.md](docs/NLE_EXPORT.md).

No backend, no build step. Static HTML/CSS/JS; runs in any modern browser (Chrome, Edge, Safari recommended).

---

## How to Run

### Option 1: GitHub Pages

1. In the repo **Settings** → **Pages**
2. **Source**: Deploy from a branch  
3. **Branch**: `main` (or your default), **Folder**: `/ (root)` → Save  
4. After a few minutes, open `https://<username>.github.io/<repo>/`  
   (e.g. `https://<username>.github.io/cuts/` if the repo is named `cuts`)

No build or Node required; the repo contents are served as-is.

### Option 2: Local

Open `index.html` in a browser (double-click or drag into the window).  
Recommended: Chrome, Edge, or Safari.

---

## Basic Workflow

1. Set **PROJECT TITLE** (used as base filename for the ZIP).
2. Optionally set **DATE**, **VERSION**, **PLATFORM**, **FORMAT**, **FPS**, **LOUDNESS**, **DELIVERY**.
3. Add **MAIN BGM** if needed (single audio file for the project).
4. Use **ADD SHOT** to add rows. For each row:
   - Add a **Visual Reference** (image or video) by paste or file picker.
   - Enter **On-screen Text / Caption**.
   - Enter **Duration** in seconds; start time is calculated automatically.
5. Reorder rows by dragging the handle in the No. column; use ⋯ to delete a row.
6. **SAVE ZIP** to download the project (manifest + assets + thumbs).
7. Use **LOAD ZIP** to restore a saved project.
8. Use browser **Print → PDF** for a printable timeline sheet.
9. Import many photos / videos at once with **IMPORT MEDIA** (or drop them on the page), then optionally press **SORT BY CAPTURE TIME** above the table to put the cuts in shooting order.
10. Use **EXPORT NLE** to hand the timeline to an editor. Set **NLE FOLDER** (controls bar) once to the folder where you unzip exports (e.g. `~/Downloads`); then unzip and import the `.xml` into Premiere Pro. Cuts land on V1, captions on V2 as editable titles, BGM on A1, media already linked. `other_formats/` holds `.otio` / `.fcpxml` / `.srt` for Resolve, Final Cut Pro and fallbacks. Details: [docs/NLE_EXPORT.md](docs/NLE_EXPORT.md).

---

## Save Format (ZIP)

A saved project is a ZIP containing:

- **manifest.json** — Project metadata: `header` (title, date, version, platform, format, fps, loudness, delivery), optional `bgm`, and `rows` (per-cut caption, duration, startTime, visual reference).
- **assets/** — Referenced files (images, videos, BGM) with names like `<assetId>_<filename>`.
- **thumbs/** — Optional thumbnail images per visual asset (`<assetId>.jpg`) for quick preview on load.

Suitable for version control (binary assets) or long-term storage; load back via **LOAD ZIP**.

---

## Video Mock (Python)

From a saved CUTS project (ZIP or extracted folder), you can generate a simple video mock with Python.

**First-time setup** — The script creates a venv and installs dependencies automatically:

```bash
./scripts/run_mock.sh --help   # Creates .venv and installs deps on first run
```

**Usage:**

```bash
# From ZIP
./scripts/run_mock.sh project.zip

# From extracted directory (manifest.json + assets/)
./scripts/run_mock.sh path/to/extracted_project/

# Options
./scripts/run_mock.sh project.zip -o output.mp4 --fps 30 --width 1920 --height 1080
./scripts/run_mock.sh project.zip --no-bgm   # Skip BGM
./scripts/run_mock.sh project.zip --fast      # Quick export (FFmpeg only; requires ffmpeg)
```

Each cut is rendered for its **Duration** (seconds). Image/video assets are used when present; otherwise a placeholder (cut number + caption) is shown. Optional **BGM** from the project is mixed onto the timeline. Output: MP4 (H.264/AAC), default 1920×1080, 30 fps.

<details>
<summary>Manual setup (without the wrapper script)</summary>

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements-mock.txt
python scripts/build_mock_video.py project.zip
```
</details>

---

## Project Structure

| Layer | Files | Role |
|-------|--------|------|
| **Presentation** | `index.html`, `css/screen.css` | Structure and styles |
| **Application** | `js/01_bootstrap.js`, `js/40_rows.js`, `js/50_timeline.js` | Entry, rows, timing |
| **Assets & I/O** | `js/20_asset_store.js`, `js/30_assets_visual.js`, `js/31_assets_bgm.js`, `js/70_zip_io.js` | Asset registry, visual/BGM handling, ZIP save/load |
| **Bulk import** | `js/46_bulk_import.js`, `scripts/bulk_import_smoke.js` | Multi-file picker / page drop, row placement, throttled thumbnails |
| **Capture sort** | `js/45_capture_sort.js`, `scripts/capture_sort_smoke.js` | EXIF / MP4 capture-time readers, ordering, undo; Node smoke test |
| **NLE export** | `js/80_nle_export.js`, `scripts/nle_export_smoke.js` | FCP7 XML / SRT / OTIO / FCPXML serializers + export ZIP; Node smoke test |
| **Utilities** | `js/00_version.js`, `js/02_sanity_check.js`, `js/05_state.js`, `js/10_dom.js`, `js/60_keyboard_ime.js` | App version, startup check, state, DOM helpers, IME/keyboard |

JSZip is loaded from CDN in `index.html`; no package manager required for the web app.

---

## Bulk import

**IMPORT MEDIA** (above the table) opens a multi-select picker; every photo / video becomes one cut. Dropping files on the page does the same.

- **Placement**: empty cuts (no visual and no caption) are filled from the top, the rest are appended. Files keep the order the picker or drop provides; the status line then offers **撮影日時順に並べる**.
- **Drop on one cut**: with several files dropped on a cut's visual box, the first fills that cut and the others become new cuts right after it. One file still just replaces that cut's visual.
- **Skipped**: anything that is not a photo / video (audio, documents) is skipped and counted in the status line. Files with no MIME type (HEIC, MOV on some desktop browsers) are recognized by extension.
- **Memory**: photos are shown as thumbnails of at most 1280 px, so dozens of 12-megapixel photos stay light. The originals are untouched in the project ZIP, and `thumbs/` in the ZIP is now a real small JPEG instead of a copy of the original. Thumbnails are made 3 at a time; a file that cannot be decoded within 12 s is left as a name-only cut.
- Video durations behave as before: a cut's seconds default to the clip length minus 2 s (images: 5 s).
- Test: `node scripts/bulk_import_smoke.js`.

## Sort by capture time

**SORT BY CAPTURE TIME** (above the table) orders the cuts from earliest to latest. Where the time comes from, in order:

| Visual | Source |
|---|---|
| Photo (JPEG, HEIC, PNG, WebP, TIFF) | EXIF DateTimeOriginal (then DateTimeDigitized, then DateTime), with the recorded UTC offset when present |
| Video (MP4, MOV, M4V, 3GP) | Creation time in the file header (`mvhd`); only the header is read, so large files are fine |
| Anything else | The file's modified time, but only for files that existed before the page was opened (files restored from a ZIP are skipped because their modified time is "now") |

Rules: ties keep the current order; cuts with no time (no visual, screenshots, stripped metadata) keep their relative order at the end. A status line shows how many cuts used each source, and **元に戻す** restores the previous order until you reorder, delete or sort again. Photos without a recorded UTC offset are read as this device's local time, so a shoot in another time zone sorts correctly among photos but can be off against videos (which are UTC). Test: `TZ=Asia/Tokyo node scripts/capture_sort_smoke.js`.

## App Version

The version is shown at the right end of the controls bar (e.g. `CUTS v1.1.0`) and written into `manifest.json` as `app.version` on SAVE ZIP.

To release a new version run:

```bash
./scripts/bump_version.sh 1.2.0
```

It updates `js/00_version.js` and the `?v=` cache-busting query on every local `<script>`/`<link>` in `index.html`, so browsers (Safari in particular) fetch the new files instead of serving cached ones after a GitHub Pages deploy.

## Design Principles

- **Local-first** — No server; all data stays in the browser or in files you save.
- **Clear responsibilities** — HTML structure, CSS presentation, JS behavior; no inline handlers in HTML.
- **Maintainable CSS** — Variables and consistent naming.
- **IME-friendly** — Japanese (and other) input method editors work correctly in caption fields.

---

## License

MIT
