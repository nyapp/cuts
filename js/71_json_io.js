// js/71_json_io.js
// Data-only JSON export/import (no media)
// Depends on globals: $, val, escapeHtml, addRow, recalcStartTimes, renumberCuts,
// updateProjectTitleDisplay, clearBgm, updateBgmActionButton

function exportDataJson() {
  // Version auto-increment (+0.01)
  const vEl = document.getElementById('h-version');
  const currentV = vEl ? String(vEl.value || '').trim() : '';
  const parsed = Number(currentV);
  const base = Number.isFinite(parsed) ? parsed : 1.0;
  const next = Math.round((base + 0.01) * 100) / 100;
  const nextStr = next.toFixed(2);
  if (vEl) vEl.value = nextStr;

  const bgmBox = $('bgm-box');
  const bgmDs = (bgmBox && bgmBox.dataset) ? bgmBox.dataset : {};

  const projectData = {
    header: {
      title: val('h-title'),
      date: val('h-date'),
      version: val('h-version'),
      format: val('h-format'),
      fps: val('h-fps'),
      delivery: val('h-delivery'),
      loudness: val('h-loudness'),
      platform: val('h-platform'),
      bgmMeta: {
        filename: bgmDs.filename || '',
        filetype: bgmDs.filetype || '',
        kind: bgmDs.kind || '',
        assetId: bgmDs.assetId || '',
        assetName: bgmDs.assetName || ''
      }
    },
    rows: []
  };

  const rows = document.querySelectorAll('#storyboard-body tr');
  rows.forEach((row) => {
    const box = row.querySelector('.visual-box');
    const captionEl = row.querySelector('.input-audio');
    const durEl = row.querySelector('.input-duration');
    const startEl = row.querySelector('.input-start');

    projectData.rows.push({
      visual: box ? box.innerHTML : '',
      audio: captionEl ? captionEl.textContent : '',
      duration: durEl ? durEl.value : '',
      startTime: startEl ? startEl.value : '',
      visualMeta: {
        filename: (box && box.dataset && box.dataset.filename) ? box.dataset.filename : '',
        filetype: (box && box.dataset && box.dataset.filetype) ? box.dataset.filetype : '',
        kind: (box && box.dataset && box.dataset.kind) ? box.dataset.kind : '',
        assetId: (box && box.dataset && box.dataset.assetId) ? box.dataset.assetId : '',
        assetName: (box && box.dataset && box.dataset.assetName) ? box.dataset.assetName : ''
      }
    });
  });

  const dataStr = JSON.stringify(projectData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const title = projectData.header.title || 'storyboard';
  const version = projectData.header.version || '1.00';
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
  a.download = `${safeTitle}_v${version}.json`;
  a.click();

  try { URL.revokeObjectURL(url); } catch (_) {}
}

function loadProject(input) {
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);

      // Header
      if (data.header) {
        const h = data.header;

        const titleEl = document.getElementById('h-title');
        if (titleEl) titleEl.value = h.title || '';
        updateProjectTitleDisplay();

        const dateEl = document.getElementById('h-date');
        if (dateEl) dateEl.value = h.date || '';

        const vEl = document.getElementById('h-version');
        if (vEl) vEl.value = h.version || '1.00';

        const fmtEl = document.getElementById('h-format');
        if (fmtEl) fmtEl.value = h.format || '';

        const fpsEl = document.getElementById('h-fps');
        if (fpsEl) fpsEl.value = h.fps || '';

        const delEl = document.getElementById('h-delivery');
        if (delEl) delEl.value = h.delivery || '';

        const loudEl = document.getElementById('h-loudness');
        if (loudEl) loudEl.value = h.loudness || '';

        const platEl = document.getElementById('h-platform');
        if (platEl) platEl.value = h.platform || '';

        // BGM meta (optional; no media in JSON)
        const box = document.getElementById('bgm-box');
        if (box && h.bgmMeta && typeof h.bgmMeta === 'object' && h.bgmMeta.filename) {
          const m = h.bgmMeta;
          box.dataset.filename = m.filename || '';
          box.dataset.filetype = m.filetype || '';
          box.dataset.kind = m.kind || 'audio';
          if (m.assetId) box.dataset.assetId = m.assetId;
          if (m.assetName) box.dataset.assetName = m.assetName;
          const safeName = escapeHtml(m.filename || '');
          box.innerHTML = `
            <div class="kind-badge">BGM</div>
            <div class="file-name" title="${safeName}">${safeName}</div>
          `;
          updateBgmActionButton();
        } else {
          clearBgm();
          updateBgmActionButton();
        }
      }

      // Rows
      const tbody = document.getElementById('storyboard-body');
      if (tbody) tbody.innerHTML = '';

      if (data.rows && Array.isArray(data.rows)) {
        data.rows.forEach((rowData) => addRow(rowData));
      }

      recalcStartTimes();
      renumberCuts();

      // Normalize visuals for older data
      document.querySelectorAll('.visual-box').forEach((box) => {
        if (box.querySelector('img')) box.classList.add('has-image');
        if (box.querySelector('.kind-badge')) return;

        const ft = (box.dataset.filetype || '').toLowerCase();
        const kind = (box.dataset.kind || '').toLowerCase();
        const isVid = kind === 'video' || ft.startsWith('video/');
        const isImg = kind === 'image' || ft.startsWith('image/');

        if (isVid || isImg) {
          const badge = document.createElement('div');
          badge.className = 'kind-badge';
          badge.textContent = isVid ? 'VID' : 'IMG';
          box.prepend(badge);
        }
      });

      alert('Project loaded successfully.');
    } catch (err) {
      alert('Failed to load project.');
      console.error(err);
    }
  };

  reader.readAsText(file);
  input.value = '';
}