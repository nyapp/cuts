// js/10_dom.js
// Common DOM & utility helpers (CUTS)

function $(id) {
  return document.getElementById(id);
}

function val(id) {
  const el = $(id);
  return el ? String(el.value || "") : "";
}

// Escape for safe HTML insertion (filenames, labels)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Make filename safe for filesystem / zip entries
function sanitizeFilename(name) {
  const base = (name || "asset").toString();
  return base.replace(/[\\\\\/\\:*?\"<>|]/g, "_");
}

// Blob -> data URL (used for thumbs)
function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    if (!blob) return resolve("");
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => resolve("");
    r.readAsDataURL(blob);
  });
}

// data URL -> Uint8Array (used for ZIP thumbs)
function dataUrlToUint8Array(dataUrl) {
  // data:[<mime>];base64,<payload>
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const b64 = m[2];
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes: u8 };
}