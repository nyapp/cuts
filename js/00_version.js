// js/00_version.js
// Single source of truth for the app version. Bump this when releasing.
// Shown in the controls bar (#app-version), stamped on <html data-app-version>,
// and written into manifest.json (app.version) by SAVE ZIP.
const CUTS_APP_VERSION = '1.4.0';
if (typeof window !== 'undefined') window.CUTS_APP_VERSION = CUTS_APP_VERSION;
