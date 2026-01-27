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
let dropIndicatorRow = null;

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
// Row actions menu (shared)
// ----------------------------
let rowMenuEl = null;
let rowMenuTargetRow = null;

function ensureRowMenu() {
  if (rowMenuEl) return rowMenuEl;

  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.style.display = 'none';

  // Minimal menu: Delete row
  menu.innerHTML = `
    <button type="button" class="row-menu-item" data-action="delete">Delete row</button>
  `;

  document.body.appendChild(menu);
  rowMenuEl = menu;

  // Click outside to close
  document.addEventListener('mousedown', (e) => {
    if (!rowMenuEl || rowMenuEl.style.display === 'none') return;
    const isInsideMenu = rowMenuEl.contains(e.target);
    const isMenuButton = e.target && e.target.closest && e.target.closest('.btn-row-menu');
    if (!isInsideMenu && !isMenuButton) {
      closeRowMenu();
    }
  });

  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRowMenu();
  });

  // Menu item actions
  rowMenuEl.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const row = rowMenuTargetRow;

    if (action === 'delete' && row) {
      const ok = e.shiftKey ? true : window.confirm('Delete this row?');
      if (!ok) return;

      if (draggingRow === row) draggingRow = null;
      row.remove();
      renumberCuts();
      closeRowMenu();
      return;
    }

    closeRowMenu();
  });

  return rowMenuEl;
}

function openRowMenu(anchorEl, rowEl) {
  const menu = ensureRowMenu();
  rowMenuTargetRow = rowEl;

  const r = anchorEl.getBoundingClientRect();
  // Place menu under the button, aligned to its left edge
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.display = 'block';
}

function closeRowMenu() {
  if (!rowMenuEl) return;
  rowMenuEl.style.display = 'none';
  rowMenuTargetRow = null;
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
    <td draggable="true" class="cell-handle">
      <div class="handle-wrap">
        <div class="cut-number">${rowCount}</div>
        <button type="button" class="btn-row-menu" title="Row actions" aria-label="Row actions">⋯</button>
      </div>
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
  // Row actions menu (⋯)
  // ----------------------------
  const menuBtn = newRow.querySelector('.btn-row-menu');
  let suppressMenuClickUntil = 0;
  if (menuBtn) {
    // Merge: short click = menu, long-press = drag handle
    menuBtn.setAttribute('draggable', 'false');

    // Long-press enables drag on the ⋯ button
    let pressTimer = null;
    const LONG_PRESS_MS = 350;
    const clearPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    menuBtn.addEventListener('pointerdown', (e) => {
      // Primary pointer only
      if (e.button !== 0) return;
      clearPress();

      // If user holds, enable dragging on this button
      pressTimer = setTimeout(() => {
        menuBtn.setAttribute('draggable', 'true');
      }, LONG_PRESS_MS);
    });

    menuBtn.addEventListener('pointerup', () => {
      clearPress();
      // If drag didn't start, keep it non-draggable for normal clicks
      if (Date.now() >= suppressMenuClickUntil) {
        menuBtn.setAttribute('draggable', 'false');
      }
    });

    menuBtn.addEventListener('pointercancel', () => {
      clearPress();
      menuBtn.setAttribute('draggable', 'false');
    });

    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() < suppressMenuClickUntil) return;
      openRowMenu(menuBtn, newRow);
    });
  }

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
  // Google Sheets-like: drag from the No. cell (except ⋯ button)
  const dragCell = newRow.querySelector('td.cell-handle');

  dragCell.addEventListener('dragstart', (e) => {
    // Don't start a row drag when user is clicking the ⋯ menu button
    if (e.target && e.target.closest && e.target.closest('.btn-row-menu')) {
      e.preventDefault();
      return;
    }
    draggingRow = newRow;
    newRow.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Prevent the click-to-open-menu right after drag
    suppressMenuClickUntil = Date.now() + 600;
  });

  dragCell.addEventListener('dragend', () => {
    draggingRow = null;
    newRow.classList.remove('dragging');
    document
      .querySelectorAll('#storyboard-body tr')
      .forEach(r => r.classList.remove('drag-over', 'drop-before', 'drop-after'));
    dropIndicatorRow = null;
    renumberCuts();
  });

  newRow.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggingRow || draggingRow === newRow) return;

    // Clear previous indicator
    if (dropIndicatorRow && dropIndicatorRow !== newRow) {
      dropIndicatorRow.classList.remove('drag-over', 'drop-before', 'drop-after');
    }

    // Decide whether drop inserts before or after this row
    const rect = newRow.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2;

    newRow.classList.add('drag-over');
    newRow.classList.toggle('drop-after', isAfter);
    newRow.classList.toggle('drop-before', !isAfter);
    dropIndicatorRow = newRow;
  });

  newRow.addEventListener('dragleave', () => {
    newRow.classList.remove('drag-over', 'drop-before', 'drop-after');
    if (dropIndicatorRow === newRow) dropIndicatorRow = null;
  });

  newRow.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggingRow || draggingRow === newRow) return;

    const rows = Array.from(tbody.children);
    const dragIndex = rows.indexOf(draggingRow);
    const dropIndex = rows.indexOf(newRow);

    const rect = newRow.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2;

    if (isAfter) {
      tbody.insertBefore(draggingRow, newRow.nextSibling);
    } else {
      tbody.insertBefore(draggingRow, newRow);
    }

    // Clear indicators immediately after drop
    newRow.classList.remove('drag-over', 'drop-before', 'drop-after');
    if (dropIndicatorRow === newRow) dropIndicatorRow = null;
  });

  // ----------------------------
  // Finalize
  // ----------------------------
  if (typeof recalcStartTimes === 'function') {
    recalcStartTimes();
  }
}