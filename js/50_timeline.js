// js/50_timeline.js
// Timing helpers: Duration -> Start Time (mm:ss)

// Parse seconds from user input (supports "", "12", "12.5"). Non-numeric -> 0
function parseSeconds(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Format seconds for display in Start Time column as mm:ss
function formatSeconds(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.floor(sec + 1e-9);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  const mmStr = String(mm);
  const ssStr = String(ss).padStart(2, "0");
  return `${mmStr}:${ssStr}`;
}

// Recalculate Start Time for all rows based on cumulative Duration
function recalcStartTimes() {
  const rows = document.querySelectorAll("#storyboard-body tr");
  let t = 0;
  rows.forEach((row) => {
    const durEl = row.querySelector(".input-duration");
    const startEl = row.querySelector(".input-start");
    const dur = durEl ? parseSeconds(durEl.value) : 0;
    if (startEl) startEl.value = formatSeconds(t);
    t += dur;
  });
}
