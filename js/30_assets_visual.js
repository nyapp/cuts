// js/30_assets_visual.js
// Visual (image/video) selection, drag&drop, paste handling

function renderThumbToVisualBox(box, kind, safeName, thumbDataUrl) {
  if (!box) return;
  const label = kind === "video" ? "VID" : "IMG";
  box.classList.add("has-image");
  if (thumbDataUrl) {
    box.innerHTML = `
      <div class="kind-badge">${label}</div>
      <img src="${thumbDataUrl}" alt="${safeName}">
      <div class="file-name" title="${safeName}">${safeName}</div>
    `;
  } else {
    box.innerHTML = `
      <div class="kind-badge">${label}</div>
      <div class="file-name" title="${safeName}">${safeName}</div>
    `;
  }
}

// 隠しinputの変更イベント（クリック選択時）
function setupImageInputListener() {
  const input = document.getElementById("hidden-image-input");
  if (!input) return;
  input.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0] && currentTargetBox) {
      renderImageToBox(e.target.files[0], currentTargetBox);
      input.value = "";
    }
  });
}

function setupGlobalPasteListener() {
  document.addEventListener("paste", function (e) {
    if (!currentTargetBox) return;

    const cd =
      e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
    if (!cd || !cd.items) return;

    for (const item of cd.items) {
      if (item.kind === "file") {
        const blob = item.getAsFile();
        if (blob) {
          renderImageToBox(blob, currentTargetBox);
          e.preventDefault();
        }
        break; // 1回のペーストで1枚のみ処理
      }
    }
  });
}

function clearVisualBox(box) {
  if (!box) return;

  // Remove the asset entry for this box (best-effort).
  const assetId = box.dataset.assetId;
  if (assetId) {
    try {
      assetStore.delete(assetId);
    } catch (_) {}
  }

  // Clear UI
  box.innerHTML = "";
  box.classList.remove("has-image", "is-active");

  // Clear dataset in a consistent way (dataset uses camelCase; attributes are kebab-case)
  delete box.dataset.filename;
  delete box.dataset.filetype;
  delete box.dataset.kind;
  delete box.dataset.assetId;
  delete box.dataset.assetName;

  // Also remove attributes (kebab-case) to avoid stale values being serialized elsewhere
  box.removeAttribute("data-filename");
  box.removeAttribute("data-filetype");
  box.removeAttribute("data-kind");
  box.removeAttribute("data-asset-id");
  box.removeAttribute("data-asset-name");
}

// 画像/動画ファイルを読み込んでボックスに表示（ファイル名も表示）
function renderImageToBox(file, box) {
  if (!file || !box) return;

  const oldAssetId = box.dataset.assetId;
  if (oldAssetId) assetStore.delete(oldAssetId);

  const nameLower = (file.name || "").toLowerCase();
  const extIsVideo =
    nameLower.endsWith(".mov") ||
    nameLower.endsWith(".mp4") ||
    nameLower.endsWith(".m4v");

  const isImage = file.type && file.type.startsWith("image/");
  const isVideo =
    (file.type && file.type.startsWith("video/")) || (!file.type && extIsVideo);

  const fileName =
    file.name && file.name.trim() ? file.name.trim() : "clipboard-file";

  box.dataset.filename = fileName;
  box.dataset.filetype = file.type;
  box.dataset.kind = isVideo ? "video" : isImage ? "image" : "";

  if (isImage) setBoxAsset(box, file, "image");
  if (isVideo) setBoxAsset(box, file, "video");

  // --- Image ---
  if (isImage) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const safeName = escapeHtml(fileName);
      box.classList.add("has-image");
      box.innerHTML = `
        <div class="kind-badge">IMG</div>
        <img src="${e.target.result}" alt="${safeName}">
        <div class="file-name" title="${safeName}">${safeName}</div>
      `;
    };
    reader.readAsDataURL(file);
    return;
  }

  // --- Video ---
  if (isVideo) {
    const safeName = escapeHtml(fileName);

    box.classList.add("has-image");
    box.innerHTML = `
      <div class="file-name" title="${safeName}">${safeName}</div>
    `;

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");

    video.style.position = "fixed";
    video.style.left = "-99999px";
    video.style.top = "0";
    video.style.width = "1px";
    video.style.height = "1px";

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.src = url;

    document.body.appendChild(video);

    const cleanup = () => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
      try {
        video.pause();
      } catch (_) {}
      try {
        video.remove();
      } catch (_) {}
    };

    let captured = false;

    const waitForFrame = () =>
      new Promise((resolve) => {
        if (typeof video.requestVideoFrameCallback === "function") {
          try {
            video.requestVideoFrameCallback(() => resolve());
            return;
          } catch (_) {}
        }
        setTimeout(resolve, 80);
      });

    const seekTo = (timeSec) =>
      new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        const onSeeked = () => {
          video.removeEventListener("timeupdate", onTimeUpdate);
          finish();
        };
        const onTimeUpdate = () => {
          video.removeEventListener("seeked", onSeeked);
          finish();
        };

        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("timeupdate", onTimeUpdate, { once: true });

        try {
          video.currentTime = Math.max(0, timeSec);
        } catch (_) {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("timeupdate", onTimeUpdate);
          finish();
        }

        setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("timeupdate", onTimeUpdate);
          finish();
        }, 700);
      });

    const isTooDark = (ctx, w, h) => {
      try {
        const sampleW = Math.min(64, w);
        const sampleH = Math.min(64, h);
        const img = ctx.getImageData(0, 0, sampleW, sampleH).data;
        let sum = 0;
        const n = sampleW * sampleH;
        for (let i = 0; i < img.length; i += 4) {
          sum +=
            img[i] * 0.2126 + img[i + 1] * 0.7152 + img[i + 2] * 0.0722;
        }
        const avg = sum / n;
        return avg < 8;
      } catch (_) {
        return false;
      }
    };

    async function captureAt(timeSec) {
      if (captured) return true;
      try {
        await seekTo(timeSec);
        await waitForFrame();

        const canvas = document.createElement("canvas");
        const vw = video.videoWidth || 160;
        const vh = video.videoHeight || 90;
        canvas.width = vw;
        canvas.height = vh;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, vw, vh);

        if (isTooDark(ctx, vw, vh)) return false;

        const thumbDataUrl = canvas.toDataURL("image/jpeg", 0.85);

        captured = true;
        box.classList.add("has-image");
        box.innerHTML = `
          <div class="kind-badge">VID</div>
          <img src="${thumbDataUrl}" alt="${safeName}">
          <div class="file-name" title="${safeName}">${safeName}</div>
        `;
        cleanup();
        return true;
      } catch (err) {
        console.warn("Video thumbnail generation failed at", timeSec, err);
        return false;
      }
    }

    const tryGenerate = async () => {
      if (captured) return;

      const d = Number.isFinite(video.duration) ? video.duration : 0;
      const candidates = [];
      if (d > 0) {
        candidates.push(Math.min(1.0, d * 0.1));
        candidates.push(Math.min(2.0, d * 0.2));
        candidates.push(d * 0.5);
        candidates.push(d * 0.8);
      } else {
        candidates.push(1.0);
        candidates.push(2.0);
      }

      for (const t of candidates) {
        const ok = await captureAt(t);
        if (ok) return;
      }

      if (!captured) {
        captured = true;
        box.classList.add("has-image");
        box.innerHTML = `
          <div class="file-name" title="${safeName}">${safeName}</div>
        `;
        cleanup();
      }
    };

    video.addEventListener(
      "loadedmetadata",
      () => {
        tryGenerate();
      },
      { once: true }
    );
    video.addEventListener(
      "loadeddata",
      () => {
        tryGenerate();
      },
      { once: true }
    );
    video.addEventListener(
      "error",
      () => {
        box.classList.add("has-image");
        box.innerHTML = `
          <div class="file-name" title="${safeName}">${safeName}</div>
        `;
        cleanup();
      },
      { once: true }
    );

    try {
      video.load();
    } catch (_) {}

    setTimeout(() => {
      if (!captured) tryGenerate();
    }, 1200);

    return;
  }
}

function setupVisualBoxEvents(box) {
  if (!box) return;

  box.addEventListener("dblclick", function () {
    currentTargetBox = box;
    document.getElementById("hidden-image-input").click();
  });

  box.addEventListener("dragover", function (e) {
    e.preventDefault();
    box.classList.add("drag-over");
  });
  box.addEventListener("dragleave", function (e) {
    e.preventDefault();
    box.classList.remove("drag-over");
  });
  box.addEventListener("drop", function (e) {
    e.preventDefault();
    box.classList.remove("drag-over");
    const f =
      e.dataTransfer.files && e.dataTransfer.files[0]
        ? e.dataTransfer.files[0]
        : null;
    if (f) renderImageToBox(f, box);
  });

  box.addEventListener("click", function () {
    if (box.matches(":hover")) {
      clearVisualBox(box);
    } else {
      currentTargetBox = box;
      document
        .querySelectorAll(".visual-box")
        .forEach((b) => b.classList.remove("is-active"));
      box.classList.add("is-active");
    }
  });
}