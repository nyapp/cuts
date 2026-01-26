// js/70_zip_io.js
// ZIP export/import (manifest.json + assets + thumbs)
//
// Depends on globals defined elsewhere:
// - JSZip (loaded via CDN)
// - helper funcs: val, escapeHtml, sanitizeFilename, dataUrlToUint8Array, blobToDataUrl
// - app funcs: addRow, recalcStartTimes, renumberCuts, updateProjectTitleDisplay
// - bgm funcs: clearBgm, updateBgmActionButton
// - asset funcs/data: assetStore, registerAssetWithId
// - visual helper: renderThumbToVisualBox

// --- ZIP export: manifest.json + assets/* ---
async function saveProjectZip() {
  try {
    // Version auto-increment (+0.01 per save)
    const vEl = document.getElementById("h-version");
    const currentV = vEl ? String(vEl.value || "").trim() : "";
    const parsed = Number(currentV);
    const base = Number.isFinite(parsed) ? parsed : 1.0;
    const next = Math.round((base + 0.01) * 100) / 100;
    const nextStr = next.toFixed(2);
    if (vEl) vEl.value = nextStr;

    const title = val("h-title");
    const version = val("h-version") || "1.00";
    const safeTitle = (title || "project").replace(/[\\\/:*?"<>|]/g, "_");

    // Build manifest
    const manifest = {
      header: {
        title: title || "",
        date: val("h-date"),
        version: val("h-version"),
        format: val("h-format"),
        fps: val("h-fps"),
        delivery: val("h-delivery"),
        loudness: val("h-loudness"),
        platform: val("h-platform"),
      },
      bgm: null,
      rows: [],
    };

    // BGM reference (optional)
    const bgmBox = document.getElementById("bgm-box");
    if (bgmBox && bgmBox.dataset && bgmBox.dataset.assetId) {
      const id = bgmBox.dataset.assetId;
      const name = sanitizeFilename(
        bgmBox.dataset.assetName || bgmBox.dataset.filename || "bgm"
      );
      manifest.bgm = {
        assetId: id,
        file: `assets/${id}_${name}`,
        kind: "audio",
        filetype: bgmBox.dataset.filetype || "",
      };
    }

    // Collect rows
    const rows = document.querySelectorAll("#storyboard-body tr");
    rows.forEach((row, idx) => {
      const box = row.querySelector(".visual-box");
      const audio = row.querySelector(".input-audio")
        ? row.querySelector(".input-audio").textContent
        : "";
      const duration = row.querySelector(".input-duration")
        ? row.querySelector(".input-duration").value
        : "";
      const startTime = row.querySelector(".input-start")
        ? row.querySelector(".input-start").value
        : "";

      const item = {
        no: idx + 1,
        caption: audio || "",
        duration: duration || "",
        startTime: startTime || "",
        visual: null,
      };

      if (box && box.dataset && box.dataset.assetId) {
        const id = box.dataset.assetId;
        const name = sanitizeFilename(
          box.dataset.assetName || box.dataset.filename || `cut_${idx + 1}`
        );
        const kind = (box.dataset.kind || "").toLowerCase();
        item.visual = {
          assetId: id,
          file: `assets/${id}_${name}`,
          kind: kind || "",
          filetype: box.dataset.filetype || "",
        };
      }

      manifest.rows.push(item);
    });

    // Create ZIP
    if (typeof JSZip === "undefined") {
      alert("JSZip is not available. Please check the network connection or the script tag.");
      return;
    }

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    const assetsFolder = zip.folder("assets");
    const thumbsFolder = zip.folder("thumbs");

    // Add original asset files that were selected during this session
    const usedAssetIds = new Set();
    if (manifest.bgm && manifest.bgm.assetId) usedAssetIds.add(manifest.bgm.assetId);
    manifest.rows.forEach((row) => {
      if (row.visual && row.visual.assetId) usedAssetIds.add(row.visual.assetId);
    });

    for (const [assetId, file] of assetStore.entries()) {
      if (usedAssetIds.has(assetId)) {
        const rawName = file.name || "asset";
        const zipName = `${assetId}_${sanitizeFilename(rawName)}`;
        const buf = await file.arrayBuffer();
        assetsFolder.file(zipName, buf);
      }
    }

    // Add thumbs from current UI when possible (optional)
    document.querySelectorAll(".visual-box").forEach((box) => {
      const assetId = box && box.dataset ? box.dataset.assetId : "";
      const img = box ? box.querySelector("img") : null;
      if (!assetId || !img || !img.src || !String(img.src).startsWith("data:")) return;
      const u = dataUrlToUint8Array(img.src);
      if (!u) return;
      thumbsFolder.file(`${assetId}.jpg`, u.bytes);
    });

    // Build and download
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}_v${version}.zip`;
    a.click();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }, 500);
  } catch (err) {
    console.error(err);
    alert("Failed to export ZIP.");
  }
}

// --- ZIP loader ---
async function loadProjectZip(input) {
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  if (typeof JSZip === "undefined") {
    alert("JSZip is not available. Please check the network connection or the script tag.");
    input.value = "";
    return;
  }

  try {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    // --- Read manifest ---
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) {
      alert("manifest.json not found in ZIP.");
      input.value = "";
      return;
    }

    const manifestText = await manifestEntry.async("string");
    const manifest = JSON.parse(manifestText);

    // --- Reset current state ---
    assetStore.clear();

    // --- Restore header ---
    if (manifest && manifest.header) {
      const h = manifest.header;
      if (document.getElementById("h-title")) document.getElementById("h-title").value = h.title || "";
      updateProjectTitleDisplay();

      if (document.getElementById("h-date")) {
        const dateEl = document.getElementById("h-date");
        if (h.date) {
          dateEl.value = h.date;
        } else {
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, "0");
          const dd = String(today.getDate()).padStart(2, "0");
          dateEl.value = `${yyyy}-${mm}-${dd}`;
        }
      }

      if (document.getElementById("h-version")) document.getElementById("h-version").value = h.version || "1.00";
      if (document.getElementById("h-format")) document.getElementById("h-format").value = h.format || "";
      if (document.getElementById("h-fps")) document.getElementById("h-fps").value = h.fps || "";
      if (document.getElementById("h-delivery")) document.getElementById("h-delivery").value = h.delivery || "";
      if (document.getElementById("h-loudness")) document.getElementById("h-loudness").value = h.loudness || "";
      if (document.getElementById("h-platform")) document.getElementById("h-platform").value = h.platform || "";
    }

    // --- Restore BGM ---
    const bgmBox = document.getElementById("bgm-box");
    if (bgmBox) {
      if (manifest && manifest.bgm && manifest.bgm.assetId) {
        const b = manifest.bgm;
        const safeName = escapeHtml((b.file || "").split("/").pop() || "bgm");
        bgmBox.dataset.assetId = b.assetId || "";
        bgmBox.dataset.assetName = (b.file || "").split("/").pop() || "";
        bgmBox.dataset.filename = bgmBox.dataset.assetName || "";
        bgmBox.dataset.filetype = b.filetype || "";
        bgmBox.dataset.kind = "audio";
        bgmBox.innerHTML = `
          <div class="kind-badge">BGM</div>
          <div class="file-name" title="${safeName}">${safeName}</div>
        `;
      } else {
        clearBgm();
      }
      updateBgmActionButton();
    }

    // --- Load assets into assetStore (as File objects) ---
    const assetFiles = {};
    const assetsFolder = zip.folder("assets");
    if (assetsFolder) {
      const assetNames = [];
      assetsFolder.forEach((relativePath) => {
        if (relativePath && !relativePath.endsWith("/")) assetNames.push(relativePath);
      });

      for (const rel of assetNames) {
        const entry = zip.file(`assets/${rel}`);
        if (!entry) continue;

        const blob = await entry.async("blob");
        const m = String(rel).match(/^([a-zA-Z]+\\d{4})_(.+)$/);
        const assetId = m ? m[1] : "";
        const name = m ? m[2] : rel;

        const lower = name.toLowerCase();
        let mime = "";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
        else if (lower.endsWith(".png")) mime = "image/png";
        else if (lower.endsWith(".webp")) mime = "image/webp";
        else if (lower.endsWith(".gif")) mime = "image/gif";
        else if (lower.endsWith(".mp4")) mime = "video/mp4";
        else if (lower.endsWith(".mov")) mime = "video/quicktime";
        else if (lower.endsWith(".m4v")) mime = "video/x-m4v";
        else if (lower.endsWith(".mp3")) mime = "audio/mpeg";
        else if (lower.endsWith(".wav")) mime = "audio/wav";
        else if (lower.endsWith(".m4a")) mime = "audio/mp4";
        else if (lower.endsWith(".aac")) mime = "audio/aac";

        const f = new File([blob], name, { type: mime || blob.type || "" });
        if (assetId) {
          assetFiles[assetId] = f;
          registerAssetWithId(assetId, f);
        }
      }
    }

// --- Load thumbs as data URLs (robust) ---
// We store thumbs in ZIP as `thumbs/<assetId>.jpg`.
// Using base64 avoids occasional blank renders that can happen with blob->FileReader in some browsers.
const thumbsMap = {};
const thumbsFolder = zip.folder('thumbs');
if (thumbsFolder) {
  const thumbNames = [];
  thumbsFolder.forEach((relativePath) => {
    if (relativePath && !relativePath.endsWith('/')) thumbNames.push(relativePath);
  });

  for (const rel of thumbNames) {
    const entry = zip.file(`thumbs/${rel}`);
    if (!entry) continue;

    const assetId = String(rel).replace(/\.[^.]+$/, '');
    if (!assetId) continue;

    const ext = String(rel).toLowerCase().split('.').pop() || 'jpg';
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/jpeg';

    try {
      const b64 = await entry.async('base64');
      if (b64) thumbsMap[assetId] = `data:${mime};base64,${b64}`;
    } catch (e) {
      // Fallback: blob -> dataURL
      try {
        const blob = await entry.async('blob');
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl) thumbsMap[assetId] = dataUrl;
      } catch (_) {}
    }
  }
}

    // --- Rebuild rows from manifest ---
    const tbody = document.getElementById("storyboard-body");
    if (tbody) tbody.innerHTML = "";

    const rows = manifest && Array.isArray(manifest.rows) ? manifest.rows : [];
    rows.forEach((r) => {
      const visualMeta = r && r.visual
        ? {
            filename: (r.visual.file || "").split("/").pop() || "",
            filetype: r.visual.filetype || "",
            kind: r.visual.kind || "",
            assetId: r.visual.assetId || "",
            assetName: (r.visual.file || "").split("/").pop() || "",
          }
        : null;

      addRow({
        visual: "",
        audio: r && r.caption ? r.caption : "",
        duration: r && r.duration ? r.duration : "",
        visualMeta,
      });
    });

    // Apply visuals (thumb-first, fallback to filename)
    const uiRows = document.querySelectorAll("#storyboard-body tr");
    uiRows.forEach((rowEl, idx) => {
      const r = rows[idx];
      if (!r || !r.visual) return;

      const box = rowEl.querySelector(".visual-box");
      if (!box) return;

      const v = r.visual;
      const assetId = v.assetId || "";
      const fileName = (v.file || "")
        .split("/")
        .pop()
        .replace(new RegExp(`^${v.assetId}_`), "") || "";
      const safeName = escapeHtml(fileName || `cut_${idx + 1}`);
      const kind = (v.kind || "").toLowerCase();

      box.dataset.assetId = assetId;
      box.dataset.assetName = fileName;
      box.dataset.filename = fileName;
      box.dataset.filetype = v.filetype || (assetFiles[assetId] ? assetFiles[assetId].type : "");
      box.dataset.kind = kind;

      if (assetId && assetFiles[assetId]) {
        registerAssetWithId(assetId, assetFiles[assetId]);
      }

      const thumb = assetId ? (thumbsMap[assetId] || "") : "";
      if (kind === "video" || kind === "image") {
        renderThumbToVisualBox(box, kind, safeName, thumb);
      } else {
        box.classList.add("has-image");
        box.innerHTML = `<div class="file-name" title="${safeName}">${safeName}</div>`;
      }
    });

    recalcStartTimes();
    renumberCuts();

    alert("ZIP project loaded successfully.");
  } catch (err) {
    console.error(err);
    alert("Failed to load ZIP project.");
  } finally {
    input.value = "";
  }
}