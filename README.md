# CUTS  
**Cut-based Unified Timeline Sheet**

> **English**: CUTS is a local-first, browser-based tool for planning video timelines in a cut-based (storyboard) style. Add shots, set durations for auto time calculation, attach visual references and BGM, then save as ZIP. No backend required — open `index.html` and start planning.
>
> **日本語**: CUTS は、カット（場面）単位で映像タイムラインを計画するローカルファーストのブラウザツールです。カットを追加し、尺を入力すると開始時刻が自動計算されます。画像・動画やBGMを紐付け、ZIPで保存できます。サーバー不要で、`index.html` を開くだけで利用できます。

CUTS is a local-first HTML application for planning video timelines in a cut-based manner.  
It allows creators to design a storyboard-like timeline, calculate start times automatically,  
and export the project for use in video editing workflows.

This project is designed to be simple, maintainable, and tool-agnostic.

---

## Concept

CUTS separates concerns clearly:

- **HTML**: structure (what exists)
- **CSS**: presentation (how it looks)
- **JavaScript**: behavior (how it works)

The application runs entirely in the browser (no backend required) and supports
ZIP-based project archiving with assets.

---

## Features

- Cut-based storyboard editing
- Automatic Start Time calculation from Duration
- Drag & drop row reordering
- Visual (image / video) and BGM asset handling
- ZIP-based project save/load (including assets)
- A4 layout suitable for browser Print → PDF

---

## Project Layers

CUTS is structured in layers, each with a clear responsibility.

### Presentation Layer
- `index.html` — Application structure (no logic)
- `css/screen.css` — Screen UI styles

### Application Logic Layer
- `js/01_bootstrap.js` — Application entry point
- `js/40_rows.js` — Row creation & restoration
- `js/50_timeline.js` — Time calculation

### Assets & IO Layer
- `js/20_asset_store.js` — Asset registry
- `js/30_assets_visual.js` — Visual asset handling
- `js/31_assets_bgm.js` — BGM asset handling
- `js/70_zip_io.js` — ZIP save / load

### Utilities Layer
- `js/02_sanity_check.js` — Startup validation
- `js/05_state.js` — Shared UI state
- `js/10_dom.js` — Shared DOM utilities
- `js/60_keyboard_ime.js` — IME / keyboard safety

---

## How to Use

### Open the app
- **GitHub Pages**: リポジトリの **Settings → Pages** で **Source: Deploy from a branch** を選び、**Branch: main**（または default）、**Folder: / (root)** にして Save。数分後に `https://<username>.github.io/cuts/` で開けます。
- **ローカル**: ブラウザで `index.html` を直接開く  
  (Chrome / Edge / Safari 推奨)

### Basic workflow
1. Add shots using **ADD SHOT**
2. Set Duration to auto-calculate Start Time
3. Attach visual and audio assets if needed
4. Save the project as a ZIP
5. Use browser Print (Ctrl+P / Cmd+P) to export as PDF

---

## GitHub Pages で公開する

このリポジトリは静的ファイルだけなので、GitHub Pages でそのまま動きます。

1. リポジトリの **Settings** → **Pages**
2. **Build and deployment** の **Source** で **Deploy from a branch** を選択
3. **Branch** で `main`（またはデフォルトブランチ）、**Folder** で **/ (root)** を選んで **Save**
4. 数分後、`https://<あなたのユーザー名>.github.io/cuts/` でアクセス可能（リポジトリ名が `cuts` の場合）

ビルドや Node は不要です。プッシュした内容がそのまま配信されます。

---

## Save Format

### ZIP
- Includes:
  - manifest.json
  - referenced assets (image / video / audio)
- Best for long-term storage and restoration

---

## Video mock (Python)

From a saved CUTS project (ZIP or extracted folder), you can generate a simple video mock with Python.

**Setup** — 初回だけ。仮想環境の作成とパッケージ導入を自動で行います。

```bash
./scripts/run_mock.sh --help   # 初回は .venv 作成＋pip install が走ります
```

**Usage** — 以降はこのコマンドだけでOK（`pip` や `source .venv/bin/activate` は不要）

```bash
# From ZIP
./scripts/run_mock.sh project.zip

# From extracted directory (manifest.json + assets/)
./scripts/run_mock.sh path/to/extracted_project/

# Options
./scripts/run_mock.sh project.zip -o output.mp4 --fps 30 --width 1920 --height 1080
./scripts/run_mock.sh project.zip --no-bgm   # skip BGM
./scripts/run_mock.sh project.zip --fast     # 短時間で書き出し（FFmpeg のみ、要 ffmpeg コマンド）
```

<details>
<summary>仮想環境を使わず手動で入れたい場合</summary>

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements-mock.txt
python scripts/build_mock_video.py project.zip
```
</details>

- Each cut is rendered for its **Duration** (seconds). Image/video assets are used when present; otherwise a placeholder (cut number + caption) is shown.
- Optional **BGM** from the project is mixed onto the timeline.
- Output: MP4 (H.264/AAC). Default size 1920×1080, 30 fps.

---

## Design Principles

- Local-first (no server dependency)
- Explicit responsibility per file
- No inline JavaScript handlers in HTML
- Maintainable CSS using variables
- Japanese IME-friendly input handling

---

## Status

This project is under active development.
Internal structure and documentation are continuously refined
to improve long-term maintainability.

---

## License

MIT