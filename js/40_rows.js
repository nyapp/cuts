// js/40_rows.js
// Row creation + row reorder (drag & drop) helpers.
// This module is responsible for:
// - Creating a row DOM from rowData
// - Restoring imported data (JSON / ZIP)
// - Handling row reorder and renumbering
//
// Depends on:
// escapeHtml, recalcStartTimes,
// setupVisualBoxEvents,
// onTextKeyDown, attachImeGuards,
// onDurationKeyDown, attachDurationNumericGuards

// ----------------------------
// Row reorder helpers
// ----------------------------
let draggingRow = null;

function renumberCuts() {
  const rows = document.querySelectorAll('#storyboard-body tr');
  rows.forEach((row, idx) => {
    const no = row.querySelector('.cut-number');
    if (no) no.textContent = idx + 1;
  });

  if (typeof recalcStartTimes === 'function') {
    recalcStartTimes();
  }
}

// ----------------------------
// Row creation
// ----------------------------
function addRow(data = null) {
  const tbody = document.getElementById('storyboard-body');
  const rowCount = tbody.children.length + 1;
  const newRow = document.createElement('tr');

  // ---- Data normalization (IMPORT FLOW) ----
  // These lines are the "data creation / restore" core.
  const visualHtml   = data ? (data.visual ?? '') : '';

  // Caption text (backward compatible)
  const audioText    = data ? (data.audio ?? data.caption ?? '') : '';

  // Duration (backward compatible)
  const DEFAULT_DURATION = '5'; // seconds (used when no data is provided)
  const durationText = data ? (data.duration ?? data.time ?? DEFAULT_DURATION) : DEFAULT_DURATION;

  // Start time (optional; recalculated later)
  const startTimeText = data ? (data.startTime ?? '') : '';

  // Visual metadata (for badge / asset restore)
  const visualMeta = data ? (data.visualMeta ?? null) : null;

  // ---- DOM creation ----
  newRow.innerHTML = `
    <td draggable="true">
      <div class="cut-number">${rowCount}</div>
    </td>
    <td>
      <div class="visual-box">${visualHtml}</div>
    </td>
    <td>
      <div class="caption-wrap">
        <div class="input-audio" contenteditable="true"></div>
      </div>
    </td>
    <td>
      <input class="input-duration"
             type="text"
             inputmode="decimal"
             autocomplete="off"
             spellcheck="false"
             value="${escapeHtml(durationText)}">
    </td>
    <td>
      <textarea class="input-start"
                style="text-align:center;"
                readonly>${escapeHtml(startTimeText)}</textarea>
    </td>
  `;

  tbody.appendChild(newRow);

  // ----------------------------
  // Caption restore
  // ----------------------------
  const captionEl = newRow.querySelector('.input-audio');
  if (captionEl) {
    captionEl.textContent = audioText || '';
    if (typeof onTextKeyDown === 'function') {
      captionEl.addEventListener('keydown', onTextKeyDown);
    }
    if (typeof attachImeGuards === 'function') {
      attachImeGuards(captionEl);
    }
  }

  // Clicking empty caption area focuses editor
  const captionWrap = newRow.querySelector('.caption-wrap');
  if (captionWrap && captionEl) {
    captionWrap.addEventListener('mousedown', (e) => {
      if (e.target === captionWrap) {
        e.preventDefault();
        captionEl.focus();
      }
    });
  }

  // ----------------------------
  // Visual box restore
  // ----------------------------
  const visualBox = newRow.querySelector('.visual-box');

  if (visualMeta && typeof visualMeta === 'object') {
    if (visualMeta.filename)  visualBox.dataset.filename  = visualMeta.filename;
    if (visualMeta.filetype)  visualBox.dataset.filetype  = visualMeta.filetype;
    if (visualMeta.kind)      visualBox.dataset.kind      = visualMeta.kind;
    if (visualMeta.assetId)   visualBox.dataset.assetId   = visualMeta.assetId;
    if (visualMeta.assetName) visualBox.dataset.assetName = visualMeta.assetName;
  }

  // Restore visual state
  if (visualBox.querySelector('img')) {
    visualBox.classList.add('has-image');

    const ft   = (visualBox.dataset.filetype || '').toLowerCase();
    const kind = (visualBox.dataset.kind || '').toLowerCase();
    const isVid = kind === 'video' || ft.startsWith('video/');
    const isImg = kind === 'image' || ft.startsWith('image/');

    if (!visualBox.querySelector('.kind-badge') && (isVid || isImg)) {
      const badge = document.createElement('div');
      badge.className = 'kind-badge';
      badge.textContent = isVid ? 'VID' : 'IMG';
      visualBox.prepend(badge);
    }
  }

  if (typeof setupVisualBoxEvents === 'function') {
    setupVisualBoxEvents(visualBox);
  }

  // ----------------------------
  // Duration input setup
  // ----------------------------
  const durationEl = newRow.querySelector('.input-duration');
  if (durationEl) {
    if (typeof onDurationKeyDown === 'function') {
      durationEl.addEventListener('keydown', onDurationKeyDown);
    }
    if (typeof attachDurationNumericGuards === 'function') {
      attachDurationNumericGuards(durationEl);
    }
  }

  // ----------------------------
  // Drag & Drop reorder
  // ----------------------------
  const dragCell = newRow.querySelector('td[draggable="true"]');

  dragCell.addEventListener('dragstart', (e) => {
    draggingRow = newRow;
    newRow.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  dragCell.addEventListener('dragend', () => {
    draggingRow = null;
    newRow.classList.remove('dragging');
    document
      .querySelectorAll('#storyboard-body tr')
      .forEach(r => r.classList.remove('drag-over'));
    renumberCuts();
  });

  newRow.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggingRow || draggingRow === newRow) return;
    newRow.classList.add('drag-over');
  });

  newRow.addEventListener('dragleave', () => {
    newRow.classList.remove('drag-over');
  });

  newRow.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggingRow || draggingRow === newRow) return;

    const rows = Array.from(tbody.children);
    const dragIndex = rows.indexOf(draggingRow);
    const dropIndex = rows.indexOf(newRow);

    if (dragIndex < dropIndex) {
      tbody.insertBefore(draggingRow, newRow.nextSibling);
    } else {
      tbody.insertBefore(draggingRow, newRow);
    }
  });

  // ----------------------------
  // Finalize
  // ----------------------------
  if (typeof recalcStartTimes === 'function') {
    recalcStartTimes();
  }
}