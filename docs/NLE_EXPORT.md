# NLE Export — 設計判断と使い方

CUTS のショットリストを、Premiere Pro / DaVinci Resolve / Final Cut Pro が**そのままシーケンスとして読み込める形**で書き出す機能の設計メモ。
実装は `js/80_nle_export.js`、UI は `EXPORT NLE` ボタン。

## 結論

| 項目 | 決定 |
|---|---|
| 主フォーマット | **Final Cut Pro 7 XML（xmeml v4, 拡張子 .xml）** + **SRT** |
| 併記フォーマット | OpenTimelineIO (.otio)、FCPXML 1.11 (.fcpxml) |
| 同梱 | `assets/`（プロジェクト ZIP と同じ命名）+ ビジュアル未設定カット用のプレースホルダ PNG + README.txt |
| テロップの運び方 | 3 経路を同時に出す: (1) SRT → キャプショントラック、(2) シーケンスマーカーのコメント、(3) FCPXML では編集可能な Basic Title |
| メディアパス | 書き出し時に展開先フォルダを 1 回だけ聞く（localStorage に記憶）。空なら相対パスで書き、NLE 側の再リンクに任せる |
| 尺→フレーム | 累積秒を丸めてフレーム境界を決める（カット単位で丸めない）。合計尺がズレない |
| 作らないもの | .prproj 直接生成、AAF、EDL、Premiere プラグイン（理由は下表） |

## なぜ xmeml + SRT か

Premiere Pro が **ネイティブに** 読むタイムライン交換形式は、2026 年 9 月時点で次の 3 つ。

| 形式 | Premiere Pro | DaVinci Resolve | Final Cut Pro | ブラウザ JS で生成 | テロップ | 備考 |
|---|---|---|---|---|---|---|
| FCP7 XML (xmeml .xml) | ○ File > Import（[Adobe 公式](https://helpx.adobe.com/premiere-pro/using/importing-xml-project-files-final.html)） | ○ | × (FCP X 以降は非対応、変換ツールが必要) | 容易（テキスト XML） | マーカー／クリップ名まで。タイトル生成器は Premiere で編集可能テキストにならない | 20 年来の事実上の業界標準。Resolve/Premiere 双方が読み書きする |
| OpenTimelineIO (.otio) | ○ Premiere Pro 2026 で正式対応（[Adobe コミュニティ告知](https://community.adobe.com/announcements-732/now-released-otio-import-and-export-311699)、対応開始バージョン番号は未確認） | ○ 18.5 以降 | × | 容易（JSON） | マーカーのみ | ASWF 標準。Python の otioconvert で AAF/EDL/kdenlive 等に二次変換できる |
| FCPXML (.fcpxml) | × ([Adobe 公式](https://helpx.adobe.com/premiere-pro/using/importing-xml-project-files-final.html)は XtoCC 等での変換を案内) | ○ | ○ | 容易（テキスト XML） | ○ Basic Title として編集可能 | FCP 向けはこれ一択 |
| SRT | ○ キャプショントラック。「キャプションをグラフィックにアップグレード」で編集可能テキストレイヤーに変換可 | ○ 字幕トラック | ○ | 自明 | ○ | テロップ本文を「編集可能な形」で Premiere に渡せる唯一の軽量経路 |
| EDL (CMX3600) | ○ | ○ | △ | 容易 | × | 1 トラック、リール名 8 文字、静止画に弱い。採用しない |
| AAF | ○ | ○ | × | 困難（バイナリ、pyaaf 必須） | △ | Avid 向け。必要なら .otio から otioconvert で生成 |
| .prproj | 本体 | × | × | 非現実的（gzip 圧縮 XML、非公開スキーマ、バージョンごとに変化） | – | 採用しない |
| Premiere UXP プラグイン | 本体 | × | × | 別プロダクト | ○ | 配布・署名・保守コストが大きい。将来 xmeml で足りなくなってから |

一次情報で確認できたもの: Adobe helpx（xmeml 対応 / fcpxml 非対応）、Adobe コミュニティ公式告知（OTIO 正式対応）。
二次情報: Resolve の OTIO / FCP7 XML / FCPXML 対応（マニュアル転載サイト）、Premiere の SRT → グラフィック変換（解説記事）。

## 出力ファイルの構造

### `<title>.xml`（xmeml v4）

- `<sequence>`: 名前、総尺（フレーム）、`<rate>`（timebase + ntsc）、`<timecode>` 00:00:00:00 NDF、`<format>` に解像度・正方画素
- V1: カットごとに `<clipitem>`。`start/end` がシーケンス位置、`in/out` が素材のイン・アウト。`<name>` は `Cut 01` 形式、`<comments><mastercomment1>` にテロップ
- A1: BGM 1 クリップ（`<sourcetrack>` audio）
- `<marker>`（シーケンスマーカー）: カットごとに `in/out` 付き、`<comment>` にテロップ
- 静止画は `<file>` の `<duration>` をカット尺にする（OTIO の fcp_xml アダプタと同じ流儀。Premiere は静止画を任意尺で扱う）

### `<title>.srt`

テロップのあるカットだけ。開始・終了はフレーム境界から算出（ms 丸め）。

### `<title>.otio`

`Timeline.1 > Stack.1 > Track.1(V1/A1) > Clip.2 + ExternalReference.1`。
素材がカットより短い場合は `Gap.1` で位置を保つ。シーケンスマーカー（Stack の markers）にテロップ。`metadata.CUTS` にカット番号・種別を残す。

### `<title>.fcpxml`（1.11）

- 動画: `<asset-clip>`、静止画: `<video>`（Apple 流）、BGM は最初のクリップに `lane="-1"` で接続
- テロップ: `<title ref="Basic Title" lane="1">` として各クリップに接続（FCP 上で編集可能）
- 注: OTIO の fcpx_xml アダプタは `<video>`/`<title>` を解釈できず読めない。FCP / Resolve のネイティブ読込を前提にしている

## フレーム計算

| fps 入力 | timebase | ntsc | 実レート | FCPXML frameDuration |
|---|---|---|---|---|
| 23.976 | 24 | TRUE | 23.976 | 1001/24000s |
| 24 / 25 / 30 / 50 / 60 | 同値 | FALSE | 同値 | 100/2400s 等 |
| 29.97 | 30 | TRUE | 29.97 | 1001/30000s |
| 59.94 | 60 | TRUE | 59.94 | 1001/60000s |

`startFrame_i = round(Σ_{k<i} dur_k × rate)`、`endFrame_i = round(Σ_{k≤i} dur_k × rate)`。各カットを個別に丸めると数十カットで 1 フレーム以上ズレるため、累積で丸める。

## メディアパスと再リンク

xmeml の `<pathurl>` と FCPXML の `src` は本来 **絶対 file URL**。ブラウザからはローカルの絶対パスが分からないので、書き出し時に「展開予定フォルダ」を 1 回だけ prompt で聞き、以後は localStorage に記憶する。

| 入力 | xmeml pathurl | fcpxml / otio |
|---|---|---|
| `/Users/yuki/proj` | `file://localhost/Users/yuki/proj/assets/…` | `file:///Users/yuki/proj/assets/…` |
| `C:\work\proj` | `file://localhost/C:/work/proj/assets/…` | `file:///C:/work/proj/assets/…` |
| 空欄 | `assets/…`（相対） | `assets/…`（相対） |

相対のままでも Premiere は「メディアをリンク」ダイアログで `assets/` 内の 1 ファイルを指定すれば同フォルダを一括再リンクする（README.txt に手順を同梱）。

## 検証状況

| 検証 | 状態 |
|---|---|
| Node スモーク（`node scripts/nle_export_smoke.js`）→ OTIO 0.18.1 の `fcp_xml` / `otio_json` アダプタで読み戻し、全カットの開始・尺・BGM・マーカーが一致 | 済 |
| Chromium（Playwright）で index.html を開き、動画/静止画/BGM を投入 → EXPORT NLE → ZIP 展開 → 上記読み戻し | 済 |
| XML の整形式（minidom parse） | 済 |
| **Premiere Pro 実機での .xml インポート** | **未検証** |
| **DaVinci Resolve 実機での .xml / .otio / .fcpxml インポート** | **未検証** |
| **Final Cut Pro 実機での .fcpxml インポート** | **未検証** |
| Premiere Pro 2026 の .otio インポート | 未検証 |

実機で最初に確認する順: Premiere に `.xml` → 「メディアをリンク」 → `.srt` をドロップ。ここで問題が出たらこのファイルの「出力ファイルの構造」を照らして修正する。

## 既知の制限と次の拡張

| 制限 | 次の一手 |
|---|---|
| 動画素材は先頭 00:00 から使用（イン点なし） | 行に「素材イン点（秒）」欄を追加し、`asset.inFrame` に流す（モデルは対応済） |
| 動画素材の音声は載せない（A1 は BGM のみ） | 行ごとの「音声を使う」トグル → xmeml で `<link>` 付きの音声 clipitem を A2 に追加 |
| BGM は 1 本のみ・音量調整なし | CUTS 側の仕様。必要なら xmeml `<filter>`（Audio Levels）を出す |
| xmeml の静止画は Premiere が「静止画」として扱うが、Resolve でのふるまいは未検証 | Resolve で問題が出たら `<clipitem>` に `<stillframe>TRUE</stillframe>` を試す |
| FCPXML タイトルのフォントは Helvetica 固定 | header にフォント設定を持たせるまでは FCP 側で一括変更 |
| Avid（AAF）非対応 | `pip install opentimelineio otio-aaf-adapter` → `otioconvert -i x.otio -o x.aaf` |

## 再生成

- 実装: `js/80_nle_export.js`（純粋関数 `buildTimelineModel` / `buildXmeml` / `buildSrt` / `buildOtio` / `buildFcpxml` と、ブラウザ用の `exportForNle`）
- サンプル出力: `node scripts/nle_export_smoke.js [outDir]`（環境変数 `CUTS_BASE` で展開先フォルダを指定可）
- OTIO での読み戻し確認: `pip install opentimelineio otio-fcp-adapter` → `otioconvert -i sample.xml -o roundtrip.otio`
