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
| **Utilities** | `js/02_sanity_check.js`, `js/05_state.js`, `js/10_dom.js`, `js/60_keyboard_ime.js` | Startup check, state, DOM helpers, IME/keyboard |

JSZip is loaded from CDN in `index.html`; no package manager required for the web app.

---

## Design Principles

- **Local-first** — No server; all data stays in the browser or in files you save.
- **Clear responsibilities** — HTML structure, CSS presentation, JS behavior; no inline handlers in HTML.
- **Maintainable CSS** — Variables and consistent naming.
- **IME-friendly** — Japanese (and other) input method editors work correctly in caption fields.

---

## License

MIT
