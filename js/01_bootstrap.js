// js/01_bootstrap.js
// App bootstrap (initialization) and header title sync.
// Loaded after the inline script so it can safely reference addRow() and other functions.

function updateProjectTitleDisplay() {
  const input = document.getElementById('h-title');
  const display = document.getElementById('project-title-display');
  if (!display) return;
  const v = input ? String(input.value || '').trim() : '';
  display.textContent = v ? v : '(Untitled)';
}

function setupProjectTitleSync() {
  const input = document.getElementById('h-title');
  if (!input) return;
  input.addEventListener('input', updateProjectTitleDisplay);
  updateProjectTitleDisplay();
}

function applyInitialDefaultsIfEmpty() {
  const setIfEmpty = (id, value) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = value;
  };

  // Standard defaults
  setIfEmpty('h-format', '1920x1080 / 16:9');
  setIfEmpty('h-fps', '30');
  setIfEmpty('h-delivery', 'H.264 / mp4 / AAC');
  setIfEmpty('h-loudness', '-14 LUFS / -1 dBTP');

  // Platform default
  setIfEmpty('h-platform', 'Signage');

  // Version default
  setIfEmpty('h-version', '1.00');

  // Set current date if empty
  const dateEl = document.getElementById('h-date');
  if (dateEl && !dateEl.value) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }
}

function bootstrapCUTS() {
    if (typeof sanityCheckCUTS === 'function') {
    const ok = sanityCheckCUTS();
    if (!ok) return;
  
  // --- Wire UI buttons (replaces inline onclick handlers) ---
  const btnSaveZip = document.getElementById('btn-save-zip');
  if (btnSaveZip) {
    btnSaveZip.addEventListener('click', () => {
      if (typeof saveProjectZip === 'function') saveProjectZip();
    });
  }

  const btnLoadZip = document.getElementById('btn-load-zip');
  const zipInput = document.getElementById('file-input-zip');
  if (btnLoadZip && zipInput) {
    btnLoadZip.addEventListener('click', () => zipInput.click());
    zipInput.addEventListener('change', () => {
      if (typeof loadProjectZip === 'function') loadProjectZip(zipInput);
    });
  }

  const btnAddShot = document.getElementById('btn-add-shot');
  if (btnAddShot) {
    btnAddShot.addEventListener('click', () => {
      if (typeof addRow === 'function') addRow();
    });
  }

  const btnExportJson = document.getElementById('btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', (e) => {
      if (typeof exportDataJson === 'function') exportDataJson();
      if (typeof closeHamburger === 'function') closeHamburger(e.currentTarget);
    });
  }
  }
  const tbody = document.getElementById('storyboard-body');
  if (tbody && tbody.children.length === 0) {
    addRow();
    addRow();
    addRow();
  }

  // Module initializers
  if (typeof setupImageInputListener === 'function') setupImageInputListener();
  if (typeof setupGlobalPasteListener === 'function') setupGlobalPasteListener();
  if (typeof setupAudioInputListener === 'function') setupAudioInputListener();
  if (typeof setupBgmBoxEvents === 'function') setupBgmBoxEvents();
  if (typeof setupBgmActionButton === 'function') setupBgmActionButton();

  setupProjectTitleSync();
  applyInitialDefaultsIfEmpty();

  if (typeof recalcStartTimes === 'function') recalcStartTimes();
}

// Use addEventListener instead of window.onload to avoid overwriting other handlers.
window.addEventListener('load', bootstrapCUTS);