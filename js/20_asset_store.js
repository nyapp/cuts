// js/20_asset_store.js
// Centralized asset store for ZIP export/import.
// Stores original File objects so they can be bundled into ZIP and re-registered on load.

// assetId -> File
const assetStore = new Map();
let assetSeq = 1;

function registerAssetWithId(assetId, file) {
  if (!assetId || !file) return;
  assetStore.set(assetId, file);

  // Keep assetSeq ahead to avoid collisions for new assets created after loading.
  try {
    const n = parseInt(String(assetId).replace(/^[^0-9]+/, ''), 10);
    if (Number.isFinite(n) && n >= assetSeq) assetSeq = n + 1;
  } catch (_) {}
}

function makeAssetId(prefix) {
  const p = (prefix || 'a').toString();
  const id = String(assetSeq++).padStart(4, '0');
  return `${p}${id}`;
}

// Attach a picked/dropped File to a box and register it in the asset store.
// kind: 'image' | 'video' | 'audio'
function setBoxAsset(box, file, kind) {
  if (!box || !file) return;
  const rawName = file.name || 'asset';
  const assetId = makeAssetId(kind === 'audio' ? 'm' : 'v');

  assetStore.set(assetId, file);

  box.dataset.assetId = assetId;
  box.dataset.assetName = rawName; // immutable original name
  box.dataset.filename = rawName;
  box.dataset.kind = kind || box.dataset.kind || '';
  box.dataset.filetype = file.type || box.dataset.filetype || '';
}