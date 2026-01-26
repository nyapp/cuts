// js/31_assets_bgm.js
// BGM (header audio) behaviors

function setupAudioInputListener() {
  const input = document.getElementById("hidden-audio-input");
  if (!input) return;

  input.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0] && currentTargetBgmBox) {
      renderBgmToBox(e.target.files[0], currentTargetBgmBox);
      input.value = "";
    }
  });
}

function setupBgmBoxEvents() {
  const box = document.getElementById("bgm-box");
  if (!box) return;

  box.addEventListener("dblclick", () => {
    currentTargetBgmBox = box;
    const input = document.getElementById("hidden-audio-input");
    if (input) input.click();
  });

  // Note: hover判定で消す挙動は、現状コードを維持（後で改善可能）
  box.addEventListener("click", () => {
    if (box.matches(":hover")) {
      clearBgm();
    } else {
      currentTargetBgmBox = box;
    }
  });

  box.addEventListener("dragover", (e) => {
    e.preventDefault();
    box.classList.add("drag-over");
  });

  box.addEventListener("dragleave", (e) => {
    e.preventDefault();
    box.classList.remove("drag-over");
  });

  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("drag-over");
    const f =
      e.dataTransfer.files && e.dataTransfer.files[0]
        ? e.dataTransfer.files[0]
        : null;
    if (f) renderBgmToBox(f, box);
  });

  updateBgmActionButton();
}

// --- BGM action button (Add/Clear toggle) ---
function setupBgmActionButton() {
  const btn = document.getElementById("bgm-action-btn");
  if (!btn) return;

  // Set initial state
  updateBgmActionButton();

  btn.addEventListener("click", () => {
    const box = document.getElementById("bgm-box");
    if (!box) return;

    const hasBgm = !!(
      box.dataset &&
      box.dataset.kind === "audio" &&
      box.dataset.filename
    );

    if (hasBgm) {
      clearBgm();
    } else {
      currentTargetBgmBox = box;
      const input = document.getElementById("hidden-audio-input");
      if (input) input.click();
    }
  });
}

function updateBgmActionButton() {
  const btn = document.getElementById("bgm-action-btn");
  const box = document.getElementById("bgm-box");
  if (!btn || !box) return;

  const hasBgm = !!(
    box.dataset &&
    box.dataset.kind === "audio" &&
    box.dataset.filename
  );

  if (hasBgm) {
    btn.textContent = "Clear";
    btn.classList.remove("is-add");
    btn.classList.add("is-clear");
  } else {
    btn.textContent = "Add";
    btn.classList.remove("is-clear");
    btn.classList.add("is-add");
  }
}

function renderBgmToBox(file, box) {
  if (!file || !box) return;

  // 入れ替え時に古いアセットを削除
  const oldAssetId = box.dataset.assetId;
  if (oldAssetId) {
    assetStore.delete(oldAssetId);
  }

  const nameLower = (file.name || "").toLowerCase();
  const extIsAudio =
    nameLower.endsWith(".mp3") ||
    nameLower.endsWith(".wav") ||
    nameLower.endsWith(".m4a") ||
    nameLower.endsWith(".aac");

  const isAudio =
    (file.type && file.type.startsWith("audio/")) ||
    (!file.type && extIsAudio);

  if (!isAudio) return;

  // Store original file for ZIP export
  setBoxAsset(box, file, "audio");

  const fileName = file.name && file.name.trim() ? file.name.trim() : "bgm";
  box.dataset.filename = fileName;
  box.dataset.filetype = file.type;
  box.dataset.kind = "audio";

  const safeName = escapeHtml(fileName);
  box.classList.add("has-image");
  box.innerHTML = `
    <div class="kind-badge">BGM</div>
    <div class="file-name" title="${safeName}">${safeName}</div>
  `;

  updateBgmActionButton();
}

function clearBgm() {
  const box = document.getElementById("bgm-box");
  if (!box) return;

  const assetId = box.dataset.assetId;
  if (assetId) assetStore.delete(assetId);

  box.classList.remove("has-image");
  box.innerHTML = "";
  box.removeAttribute("data-filename");
  box.removeAttribute("data-filetype");
  box.removeAttribute("data-kind");
  box.removeAttribute("data-assetId");
  box.removeAttribute("data-assetName");

  updateBgmActionButton();
}