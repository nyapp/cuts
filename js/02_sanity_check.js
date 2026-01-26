// js/02_sanity_check.js
// Startup sanity checks: verify required globals exist.
// This prevents "silent failure" when a module name/order changes.

function sanityCheckCUTS() {
  const required = [
    // Core row functions
    'addRow',
    'renumberCuts',

    // Timeline
    'recalcStartTimes',

    // Visual/BGM setup hooks (optional but recommended)
    'setupVisualBoxEvents',

    // IO
    'saveProjectZip',
    'loadProjectZip',
    'exportDataJson',
  ];

  const missing = required.filter((name) => typeof window[name] !== 'function');

  if (missing.length > 0) {
    console.group('CUTS Sanity Check: Missing functions');
    missing.forEach((name) => console.error('Missing:', name));
    console.info('Likely causes: script load order / filename mismatch / function renamed.');
    console.groupEnd();

    // Visible but non-blocking notice (keep it simple)
    // You can comment out this alert later if you dislike popups.
    alert('Startup check failed. Open DevTools Console for details.');
    return false;
  }

  console.log('CUTS Sanity Check: OK');
  return true;
}