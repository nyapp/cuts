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
- Open `index.html` directly in a modern browser  
  (Chrome / Edge / Safari recommended)

### Basic workflow
1. Add shots using **ADD SHOT**
2. Set Duration to auto-calculate Start Time
3. Attach visual and audio assets if needed
4. Save the project as a ZIP
5. Use browser Print (Ctrl+P / Cmd+P) to export as PDF

---

## Save Format

### ZIP
- Includes:
  - manifest.json
  - referenced assets (image / video / audio)
- Best for long-term storage and restoration

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