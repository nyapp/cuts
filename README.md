# CUTS  
**Cut-based Unified Timeline Sheet**

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
both lightweight data export and full project archiving.

---

## Features

- Cut-based storyboard editing
- Automatic Start Time calculation from Duration
- Drag & drop row reordering
- Visual (image / video) and BGM asset handling
- ZIP-based project save/load (including assets)
- JSON export (data only, no media)
- Screen / Print style separation for clean PDF output

---

## Project Layers

CUTS is structured in layers, each with a clear responsibility.
The README focuses on the conceptual entry point; detailed file-level documentation lives in the `docs/` directory.

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
- `js/71_json_io.js` — JSON export

### Utilities Layer
- `js/02_sanity_check.js` — Startup validation
- `js/10_dom.js` — Shared DOM utilities
- `js/60_keyboard_ime.js` — IME / keyboard safety

### Documentation
- `docs/file-roles.md` — Detailed file responsibilities
- `docs/data-flow.md` — ZIP / JSON data flow
- `docs/design-notes.md` — UI / CSS design notes

---

## How to Use

### Open the app
- Open `index.html` directly in a modern browser  
  (Chrome / Edge / Safari recommended)

### Basic workflow
1. Add shots using **ADD SHOT**
2. Set Duration to auto-calculate Start Time
3. Attach visual and audio assets if needed
4. Save the project as a ZIP (recommended)
5. Export JSON if only timeline data is required
6. Use **EXPORT PDF** for printable planning sheets

---

## Save Formats

### ZIP (Recommended)
- Includes:
  - manifest.json
  - referenced assets (image / video / audio)
- Best for long-term storage and restoration

### JSON
- Data only (no media)
- Useful for lightweight backups or tool integration

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