#!/usr/bin/env python3
"""
CUTS プロジェクト（ZIP または manifest.json + assets）から簡易動画モックを生成するスクリプト。

使い方:
  python scripts/build_mock_video.py project.zip
  python scripts/build_mock_video.py path/to/extracted_project/
  python scripts/build_mock_video.py project.zip -o output.mp4 --fps 30
"""

from __future__ import annotations

import argparse
import json
import multiprocessing
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# --- 定数 ---
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif")
VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v", ".avi", ".webm")
CAPTION_BAR_COLOR = (50, 50, 50, 140)
PLACEHOLDER_COLOR = (60, 60, 60)
LETTERBOX_BG = (0, 0, 0)
CAPTION_TEXT_COLOR = (255, 255, 255, 255)
CAPTION_MAX_LEN = 80
CAPTION_BAR_TOP_RATIO = 2 / 3  # 帯の上辺を画面の下三分の一に
FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


# --- Manifest / プロジェクト読み込み ---

def parse_duration(s: str) -> float:
    """manifest の duration / startTime を秒に変換。'12', '12.5', '1:30' に対応。"""
    if not s or not str(s).strip():
        return 0.0
    s = str(s).strip()
    if ":" in s:
        parts = s.split(":")
        mults = [3600.0, 60.0, 1.0]
        if len(parts) in (2, 3):
            try:
                return sum(float(p) * m for p, m in zip(parts[-len(parts) :], mults[-len(parts) :]))
            except ValueError:
                pass
    try:
        return float(s)
    except ValueError:
        return 0.0


def load_project(input_path: Path) -> tuple[dict, str, str | None]:
    """入力（ZIP またはディレクトリ）から manifest と作業ディレクトリを返す。temp_dir は ZIP 時のみ設定。"""
    input_path = input_path.resolve()
    if input_path.suffix.lower() == ".zip":
        if not input_path.is_file():
            raise FileNotFoundError(f"ZIP not found: {input_path}")
        tmpdir = tempfile.mkdtemp(prefix="cuts_mock_")
        with zipfile.ZipFile(input_path, "r") as z:
            z.extractall(tmpdir)
        manifest_path = Path(tmpdir) / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError(f"manifest.json not found in ZIP: {input_path}")
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        return manifest, tmpdir, tmpdir
    if not input_path.is_dir():
        raise FileNotFoundError(f"Directory not found: {input_path}")
    manifest_path = input_path / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"manifest.json not found: {manifest_path}")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    return manifest, str(input_path), None


def get_asset_path(row: dict, assets_dir: Path) -> Path | None:
    """行の visual に対応する assets 内のファイルパスを返す。"""
    visual = row.get("visual")
    file_ref = visual.get("file") if visual else None
    if not file_ref:
        return None
    path = assets_dir / Path(file_ref).name
    return path if path.is_file() else None


# --- キャプション（Pillow + ImageClip）---

def _find_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """利用可能なフォントを返す。日本語対応を優先。"""
    for path in FONT_CANDIDATES:
        if Path(path).is_file():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def make_caption_image(no: int, caption: str, width: int, height: int) -> np.ndarray:
    """帯（半透明グレー）＋キャプション文字を中央寄せで描画した RGBA 画像を返す。"""
    bar_h = max(60, height // 6)
    img_w, img_h = width, bar_h
    pil = Image.new("RGBA", (img_w, img_h), CAPTION_BAR_COLOR)
    draw = ImageDraw.Draw(pil)

    font_size = max(24, min(img_w, img_h) // 16) * 2
    font = _find_font(font_size)
    text = (caption or "").strip()[:CAPTION_MAX_LEN]
    if not text:
        return np.array(pil)

    lines = text.split("\n")
    spacing = max(4, font_size // 4)
    line_infos = []
    total_h = 0
    for line in lines:
        sample = line or "A"
        bbox = draw.textbbox((0, 0), sample, font=font)
        lh = bbox[3] - bbox[1]
        lw = bbox[2] - bbox[0]
        line_infos.append((line, lh, lw))
        total_h += lh + spacing
    total_h -= spacing

    y = (img_h - total_h) // 2
    for line, lh, line_w in line_infos:
        x = (img_w - line_w) // 2
        if line:
            draw.text((x, y), line, fill=CAPTION_TEXT_COLOR, font=font)
        y += lh + spacing
    return np.array(pil)


def add_caption_layer(base_clip, no: int, caption: str):
    """base_clip の上にキャプションを重ねる。帯は画面の下三分の一に配置。"""
    from moviepy import CompositeVideoClip, ImageClip

    w, h = base_clip.size
    arr = make_caption_image(no, caption, w, h)
    caption_clip = ImageClip(arr, duration=base_clip.duration)
    caption_clip = caption_clip.with_position(("center", int(h * CAPTION_BAR_TOP_RATIO)))
    composed = CompositeVideoClip([base_clip, caption_clip])
    caption_clip.close()
    return composed


def make_placeholder_base(duration: float, size: tuple[int, int]):
    """画像がないカット用の土台（単色）。"""
    from moviepy import ColorClip
    return ColorClip(size=size, color=PLACEHOLDER_COLOR, duration=duration)


def resize_keep_aspect_ratio(clip, size: tuple[int, int]):
    """縦横比を保って指定サイズに収め、余白は黒で埋める。"""
    from moviepy import ColorClip, CompositeVideoClip

    cw, ch = clip.size
    tw, th = size
    if (cw, ch) == (tw, th):
        return clip
    scale = min(tw / cw, th / ch)
    new_w, new_h = int(round(cw * scale)), int(round(ch * scale))
    resized = clip.resized((new_w, new_h))
    bg = ColorClip(size=size, color=LETTERBOX_BG, duration=clip.duration)
    return CompositeVideoClip([bg, resized.with_position("center")])


# --- クリップ生成 ---

def create_base_clip(asset_path: Path | None, duration: float, size: tuple[int, int], subclip_fn) -> "VideoClip":
    """アセットから土台クリップを生成。失敗時・未指定時はプレースホルダー。"""
    from moviepy import ImageClip, VideoFileClip

    if not asset_path or not asset_path.is_file():
        return make_placeholder_base(duration, size)
    suffix = asset_path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        try:
            return ImageClip(str(asset_path), duration=duration)
        except Exception as e:
            print(f"Warning: could not load image {asset_path}: {e}", file=sys.stderr)
        return make_placeholder_base(duration, size)
    if suffix in VIDEO_EXTENSIONS:
        try:
            base = VideoFileClip(str(asset_path))
            if base.duration > duration:
                base = subclip_fn(base, 0, duration)
            else:
                base = base.with_duration(duration)
            return base
        except Exception as e:
            print(f"Warning: could not load video {asset_path}: {e}", file=sys.stderr)
        return make_placeholder_base(duration, size)
    return make_placeholder_base(duration, size)


def build_clip_for_row(row: dict, i: int, assets_dir: Path, size: tuple[int, int], fps: float, subclip_fn) -> "VideoClip":
    """1行分のクリップ（リサイズ＋キャプション付き）を組み立てる。"""
    duration = parse_duration(row.get("duration") or "3")
    if duration <= 0:
        duration = 3.0
    no = row.get("no", i + 1)
    caption = (row.get("caption") or "").strip()[:CAPTION_MAX_LEN]

    base = create_base_clip(get_asset_path(row, assets_dir), duration, size, subclip_fn)
    if base.size != size:
        base = resize_keep_aspect_ratio(base, size)
    clip = add_caption_layer(base, no, caption)
    return clip.with_fps(fps)


def resolve_output_path(input_path: Path, output_opt: str | None) -> str:
    """出力ファイルパスを決定する。"""
    if output_opt:
        out = output_opt
    else:
        base_name = input_path.stem if input_path.suffix.lower() == ".zip" else input_path.name
        out = str(Path(base_name).with_name(f"{base_name}_mock.mp4"))
    if not out.lower().endswith((".mp4", ".mov", ".webm")):
        out = out + ".mp4" if "." not in Path(out).name else out
    return out


# --- 高速書き出し（FFmpeg のみ、Python でフレーム合成しない）---

def _run_ffmpeg(args: list[str], check: bool = True, timeout: int | None = None) -> subprocess.CompletedProcess:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args
    return subprocess.run(cmd, capture_output=True, text=True, check=check, timeout=timeout)


def _export_segment_ffmpeg(
    seg_path: Path,
    asset_path: Path | None,
    caption_png: Path,
    duration: float,
    width: int,
    height: int,
    fps: float,
    preset: str,
    threads: int = 1,
    timeout: int | None = None,
) -> bool:
    """1カット分を FFmpeg でエンコード。timeout でハングを防ぐ。"""
    w, h = width, height
    overlay_xy = f"(main_w-overlay_w)/2:main_h*{CAPTION_BAR_TOP_RATIO}"
    scale_pad = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black"
    th = ["-threads", str(threads)] if threads else []

    if asset_path and asset_path.is_file():
        suffix = asset_path.suffix.lower()
        if suffix in IMAGE_EXTENSIONS:
            filt = f"[0:v]{scale_pad}[v];[v][1:v]overlay={overlay_xy}[out]"
            r = _run_ffmpeg(
                ["-loop", "1", "-i", str(asset_path), "-t", str(duration), "-r", str(fps), "-i", str(caption_png),
                 "-filter_complex", filt, "-map", "[out]", "-c:v", "libx264", "-preset", preset] + th + [str(seg_path)],
                check=False, timeout=timeout,
            )
        elif suffix in VIDEO_EXTENSIONS:
            filt = f"[0:v]{scale_pad}[v];[v][1:v]overlay={overlay_xy}[out]"
            r = _run_ffmpeg(
                ["-i", str(asset_path), "-t", str(duration), "-i", str(caption_png), "-filter_complex", filt,
                 "-map", "[out]", "-c:v", "libx264", "-preset", preset, "-r", str(fps)] + th + [str(seg_path)],
                check=False, timeout=timeout,
            )
        else:
            asset_path = None
    if not asset_path or not asset_path.is_file():
        filt = f"[0][1]overlay={overlay_xy}[out]"
        r = _run_ffmpeg(
            ["-f", "lavfi", "-i", f"color=c=0x3c3c3c:s={w}x{h}:d={duration}", "-r", str(fps), "-i", str(caption_png),
             "-filter_complex", filt, "-map", "[out]", "-c:v", "libx264", "-preset", preset] + th + [str(seg_path)],
            check=False, timeout=timeout,
        )
    if r.returncode != 0:
        if r.stderr:
            print(r.stderr, file=sys.stderr)
        return False
    return True


def run_ffmpeg_export(
    manifest: dict,
    work_dir: str,
    rows: list[dict],
    assets_dir: Path,
    out_path: str,
    fps: float,
    width: int,
    height: int,
    preset: str,
    no_bgm: bool,
) -> int:
    """FFmpeg のみで全カットを合成・エンコードし、1本の動画に書き出す。カットは並列エンコードする。"""
    tmpdir = tempfile.mkdtemp(prefix="cuts_ffmpeg_")
    try:
        seg_dir = Path(tmpdir) / "segments"
        seg_dir.mkdir()

        # 全キャプション PNG とエンコード引数を用意
        tasks = []
        for i, row in enumerate(rows):
            duration = parse_duration(row.get("duration") or "3")
            if duration <= 0:
                duration = 3.0
            no = row.get("no", i + 1)
            caption = (row.get("caption") or "").strip()[:CAPTION_MAX_LEN]
            arr = make_caption_image(no, caption, width, height)
            caption_png = seg_dir / f"cap_{i:04d}.png"
            Image.fromarray(arr).save(caption_png, "PNG")
            seg_path = seg_dir / f"seg_{i:04d}.mp4"
            tasks.append((i, seg_path, get_asset_path(row, assets_dir), caption_png, duration))

        # 順番にエンコード（並列はやめ、1本の FFmpeg で複数スレッド使用。進捗・タイムアウト付き）
        n_threads = max(2, multiprocessing.cpu_count())
        seg_paths = []
        n_tasks = len(tasks)
        for i, (idx, seg_path, asset_path, caption_png, duration) in enumerate(tasks):
            timeout_sec = max(120, int(duration * 6))  # 長いカットは多めに
            print(f"Encoding segment {i + 1}/{n_tasks}...", flush=True)
            try:
                ok = _export_segment_ffmpeg(
                    seg_path, asset_path, caption_png, duration, width, height, fps, preset,
                    threads=n_threads, timeout=timeout_sec,
                )
                if ok:
                    seg_paths.append(seg_path)
                else:
                    print(f"Warning: segment {idx + 1} failed.", file=sys.stderr)
            except subprocess.TimeoutExpired:
                print(f"Warning: segment {idx + 1} timed out after {timeout_sec}s.", file=sys.stderr)

        if not seg_paths:
            print("No segments to concatenate.", file=sys.stderr)
            return 1

        # 連結（再エンコードなし）
        list_file = seg_dir / "list.txt"
        with open(list_file, "w") as f:
            for p in seg_paths:
                f.write(f"file '{p.resolve()}'\n")

        combined = Path(tmpdir) / "combined.mp4"
        r = _run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(combined)], check=False)
        if r.returncode != 0:
            if r.stderr:
                print(r.stderr, file=sys.stderr)
            return 1

        # BGM を載せる
        if not no_bgm and manifest.get("bgm") and assets_dir.is_dir():
            bgm = manifest["bgm"]
            name = Path(bgm.get("file") or "").name
            bgm_path = assets_dir / name
            if bgm_path.is_file():
                final_with_bgm = Path(tmpdir) / "final.mp4"
                # 動画のストリーム + BGM を -shortest で長さを揃えて出力
                r = _run_ffmpeg([
                    "-i", str(combined), "-i", str(bgm_path),
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", str(final_with_bgm),
                ], check=False)
                if r.returncode == 0:
                    shutil.move(str(final_with_bgm), out_path)
                else:
                    shutil.copy2(str(combined), out_path)
            else:
                shutil.copy2(str(combined), out_path)
        else:
            shutil.copy2(str(combined), out_path)

        return 0
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


# --- Main ---

def main() -> int:
    parser = argparse.ArgumentParser(description="CUTS プロジェクトから簡易動画モックを生成")
    parser.add_argument("input", help="CUTS の ZIP または manifest.json + assets/ があるディレクトリ")
    parser.add_argument("-o", "--output", default=None, help="出力動画（省略時は入力名_mock.mp4）")
    parser.add_argument("--fps", type=float, default=30.0, help="出力 FPS")
    parser.add_argument("--width", type=int, default=1920, help="出力幅")
    parser.add_argument("--height", type=int, default=1080, help="出力高さ")
    parser.add_argument("--no-bgm", action="store_true", help="BGM を使わない")
    parser.add_argument("--keep-temp", action="store_true", help="ZIP 解凍一時ディレクトリを残す")
    parser.add_argument(
        "--preset",
        default="fast",
        choices=("ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"),
        help="x264 のエンコード速度とファイルサイズのバランス（fast がデフォルトで短時間書き出し向け）",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="FFmpeg のみで書き出し（MoviePy を使わず短時間で完了。要 ffmpeg）",
    )
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    try:
        manifest, work_dir, temp_dir = load_project(input_path)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    rows = manifest.get("rows") or []
    if not rows:
        print("No rows in manifest.", file=sys.stderr)
        return 1

    assets_dir = Path(work_dir) / "assets"
    if not assets_dir.is_dir():
        assets_dir = Path(work_dir)

    out_path = resolve_output_path(input_path, args.output)
    size = (args.width, args.height)
    fps = args.fps

    if args.fast:
        # FFmpeg のみで書き出し（Python でフレーム合成しないため速い）
        print(f"Writing: {out_path} (fast mode)")
        ret = run_ffmpeg_export(
            manifest, work_dir, rows, assets_dir, out_path, fps, size[0], size[1], args.preset, args.no_bgm
        )
        if temp_dir and not args.keep_temp:
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass
        print("Done." if ret == 0 else "Failed.")
        return ret

    try:
        from moviepy import AudioFileClip, ImageClip, VideoFileClip, concatenate_videoclips
    except ImportError:
        print("moviepy が必要です: pip install moviepy", file=sys.stderr)
        return 1

    def subclip_fn(c, t0, t1):
        return c.subclipped(t0, t1) if hasattr(c, "subclipped") else c.subclip(t0, t1)

    size = (args.width, args.height)
    fps = args.fps
    clips = [build_clip_for_row(row, i, assets_dir, size, fps, subclip_fn) for i, row in enumerate(rows)]

    if not clips:
        print("No clips to concatenate.", file=sys.stderr)
        return 1

    final = concatenate_videoclips(clips, method="compose")

    if not args.no_bgm and manifest.get("bgm") and assets_dir.is_dir():
        bgm = manifest["bgm"]
        file_ref = (bgm.get("file") or "").strip()
        name = Path(file_ref).name
        bgm_path = assets_dir / name
        if bgm_path.is_file():
            try:
                audio = AudioFileClip(str(bgm_path))
                if audio.duration > final.duration:
                    audio = subclip_fn(audio, 0, final.duration)
                final = final.with_audio(audio)
            except Exception as e:
                print(f"Warning: could not add BGM {bgm_path}: {e}", file=sys.stderr)

    print(f"Writing: {out_path}")
    try:
        nthreads = max(1, multiprocessing.cpu_count() - 1)  # 1コア残して並列
        final.write_videofile(
            out_path,
            fps=fps,
            codec="libx264",
            preset=args.preset,
            audio_codec="aac",
            temp_audiofile=tempfile.mktemp(suffix=".m4a"),
            threads=nthreads,
            logger=None,
        )
    finally:
        for c in clips:
            try:
                c.close()
            except Exception:
                pass
        try:
            final.close()
        except Exception:
            pass
        if temp_dir and not args.keep_temp:
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
