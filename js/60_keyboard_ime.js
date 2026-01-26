// js/60_keyboard_ime.js
// Keyboard navigation + IME guards + numeric-only guards for Duration

// --- Keyboard navigation: Duration-only Tab ---
function focusDurationField(currentEl, direction) {
  const fields = Array.from(document.querySelectorAll(".input-duration"));
  const idx = fields.indexOf(currentEl);
  if (idx === -1) return;

  let nextIdx = idx + direction;
  if (nextIdx < 0) nextIdx = 0;
  if (nextIdx >= fields.length) nextIdx = fields.length - 1;

  const nextEl = fields[nextIdx];
  if (nextEl) {
    nextEl.focus();
    try {
      nextEl.select();
    } catch (_) {}
  }
}

function onDurationKeyDown(e) {
  if (e.key !== "Tab") return;
  e.preventDefault();
  // Shift+Tab = backward, Tab = forward
  focusDurationField(e.target, e.shiftKey ? -1 : 1);
}

// --- IME global state (best-effort mitigation for Safari underline-stuck issue) ---
let activeComposingCaption = null;

function forceCommitComposition(el) {
  if (!el) return;

  // Only act if we think we're composing
  const composing = el.dataset && el.dataset.composing === "true";
  if (!composing) return;

  // Best-effort commit strategy:
  // 1) Write back textContent
  // 2) Temporarily disable contenteditable to force IME to finalize
  try {
    const t = el.textContent;
    el.textContent = t;
  } catch (_) {}

  try {
    el.setAttribute("contenteditable", "false");
    // Force reflow
    void el.offsetHeight;
    el.setAttribute("contenteditable", "true");
  } catch (_) {}

  try {
    el.dataset.composing = "false";
  } catch (_) {}

  if (activeComposingCaption === el) activeComposingCaption = null;
}

// Capture pointer/focus changes to commit composition before the browser moves focus.
// Do NOT preventDefault; we just commit as early as possible.
document.addEventListener(
  "pointerdown",
  (e) => {
    const el = activeComposingCaption;
    if (!el) return;
    if (el.contains(e.target)) return;
    forceCommitComposition(el);
  },
  true
);

document.addEventListener(
  "focusin",
  (e) => {
    const el = activeComposingCaption;
    if (!el) return;
    if (el === e.target) return;
    forceCommitComposition(el);
  },
  true
);

// --- Keyboard navigation: On-screen Text / Caption-only Tab ---
function focusTextField(currentEl, direction) {
  const fields = Array.from(
    document.querySelectorAll('.input-audio[contenteditable="true"]')
  );
  const idx = fields.indexOf(currentEl);
  if (idx === -1) return;

  let nextIdx = idx + direction;
  if (nextIdx < 0) nextIdx = 0;
  if (nextIdx >= fields.length) nextIdx = fields.length - 1;

  const nextEl = fields[nextIdx];
  if (nextEl) {
    nextEl.focus();
    // Place caret at START (collapse(true))
    try {
      const range = document.createRange();
      range.selectNodeContents(nextEl);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }
}

function onTextKeyDown(e) {
  // During IME composition, do not hijack Tab.
  const composing = !!(
    e.isComposing ||
    (e.target && e.target.dataset && e.target.dataset.composing === "true")
  );
  if (composing) return;

  if (e.key !== "Tab") return;
  e.preventDefault();
  focusTextField(e.target, e.shiftKey ? -1 : 1);
}

// --- IME (Japanese input) guard for contenteditable captions ---
function attachImeGuards(el) {
  if (!el) return;

  el.dataset.composing = "false";

  el.addEventListener("compositionstart", () => {
    el.dataset.composing = "true";
    activeComposingCaption = el;
  });

  el.addEventListener("compositionend", () => {
    el.dataset.composing = "false";
    if (activeComposingCaption === el) activeComposingCaption = null;
  });

  // Best-effort: if blur happens while composing, force a commit.
  el.addEventListener("blur", () => {
    forceCommitComposition(el);
  });
}

// --- Duration numeric-only guards (caret-safe, IME-aware) ---
function normalizeNumericString(raw) {
  const s = String(raw || "");
  let out = "";
  let dotUsed = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9") {
      out += ch;
      continue;
    }
    if (ch === "." && !dotUsed) {
      out += ch;
      dotUsed = true;
      continue;
    }
    // drop everything else
  }
  return out;
}

function applyNormalizedValuePreserveCaret(el) {
  if (!el) return;

  const start = typeof el.selectionStart === "number" ? el.selectionStart : null;
  const end = typeof el.selectionEnd === "number" ? el.selectionEnd : null;

  const before = String(el.value || "");
  const after = normalizeNumericString(before);
  if (after === before) return;

  // Best-effort caret preservation: compute how many invalid chars were removed before the caret.
  if (start != null && end != null) {
    const left = before.slice(0, start);
    const leftNorm = normalizeNumericString(left);
    const newPos = leftNorm.length;
    el.value = after;
    try {
      el.setSelectionRange(newPos, newPos);
    } catch (_) {}
  } else {
    el.value = after;
  }
}

function attachDurationNumericGuards(el) {
  if (!el) return;

  el.dataset.composing = "false";

  el.addEventListener("compositionstart", () => {
    el.dataset.composing = "true";
  });

  el.addEventListener("compositionend", () => {
    el.dataset.composing = "false";
    // Sanitize once IME commits text
    applyNormalizedValuePreserveCaret(el);
    recalcStartTimes();
  });

  // Prevent invalid characters before they are inserted (avoids caret jumps)
  el.addEventListener("beforeinput", (e) => {
    // Don't interfere mid-composition
    if (e.isComposing || el.dataset.composing === "true") return;

    const t = e.inputType || "";
    if (t === "insertText" || t === "insertCompositionText") {
      const data = e.data == null ? "" : String(e.data);
      const ok = data === "" || normalizeNumericString(data) === data;
      if (!ok) e.preventDefault();
      return;
    }

    // Let deletions happen normally
    if (t.startsWith("delete")) return;
  });

  // Sanitize pasted content
  el.addEventListener("paste", (e) => {
    if (!e.clipboardData) return;
    const text = e.clipboardData.getData("text");
    const cleaned = normalizeNumericString(text);
    if (cleaned === text) return; // allow normal paste

    e.preventDefault();
    try {
      const s = el.selectionStart;
      const en = el.selectionEnd;
      if (typeof s === "number" && typeof en === "number") {
        el.setRangeText(cleaned, s, en, "end");
      } else {
        el.value = normalizeNumericString(String(el.value || "") + cleaned);
      }
    } catch (_) {
      el.value = normalizeNumericString(String(el.value || "") + cleaned);
    }
    recalcStartTimes();
  });

  // Final safety: sanitize on input after non-text inputTypes
  el.addEventListener("input", () => {
    if (el.dataset.composing === "true") return;
    applyNormalizedValuePreserveCaret(el);
    recalcStartTimes();
  });
}