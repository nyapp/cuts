# 動画の素材尺（source duration）取得の動作確認方法

## 方法1: ブラウザの開発者ツール（Elements）で確認

1. 動画ファイルをアップロード
   - Visual Reference のセルをダブルクリックして動画を選択
   - または、動画ファイルをドラッグ&ドロップ

2. 開発者ツールを開く
   - **Mac**: `Cmd + Option + I`
   - **Windows/Linux**: `F12` または `Ctrl + Shift + I`

3. Elements（要素）タブを開く

4. 動画が登録された行の `.visual-box` 要素を探す
   - インスペクタで該当行を選択
   - `<div class="visual-box has-image">` を探す

5. 属性を確認
   - 選択した要素の属性パネルで `data-source-duration` を確認
   - 例: `data-source-duration="11.03"` のように秒数が表示される

## 方法2: コンソールで確認

開発者ツールの **Console** タブで以下を実行:

```javascript
// すべての visual-box で data-source-duration があるものを検索
document.querySelectorAll('.visual-box[data-source-duration]')

// 最初の1つだけ確認
document.querySelector('.visual-box[data-source-duration]')

// 属性の値を確認
document.querySelector('.visual-box[data-source-duration]')?.getAttribute('data-source-duration')

// すべての visual-box の source duration を一覧表示
Array.from(document.querySelectorAll('.visual-box')).map(box => ({
  filename: box.dataset.filename,
  sourceDuration: box.dataset.sourceDuration
})).filter(item => item.sourceDuration)
```

## 方法3: Durationフィールドの自動入力確認

1. 新しい行を追加（ADD SHOT ボタン）
2. Durationフィールドが空であることを確認
3. その行の Visual Reference に動画をアップロード
4. Durationフィールドに動画の長さ（秒）が自動入力されることを確認
   - 例: 動画が11.03秒なら、Durationフィールドに `11.03` と表示される

## 方法4: デバッグログを追加して確認

一時的にコンソールログを追加する場合、`js/30_assets_visual.js` の `updateDurationField()` 関数内に以下を追加:

```javascript
console.log('Video duration:', video.duration);
console.log('Formatted duration:', formattedDuration);
console.log('Box element:', box);
console.log('Setting data-source-duration:', formattedDuration);
```

## トラブルシューティング

### `data-source-duration` が設定されない場合

1. **動画のメタデータが読み込まれているか確認**
   ```javascript
   const video = document.createElement('video');
   video.src = URL.createObjectURL(yourVideoFile);
   video.addEventListener('loadedmetadata', () => {
     console.log('Duration:', video.duration);
   });
   ```

2. **動画ファイルの形式を確認**
   - 対応形式: `.mp4`, `.mov`, `.m4v`
   - ブラウザによっては一部のコーデックがサポートされていない場合があります

3. **イベントが発火しているか確認**
   - コンソールでエラーが出ていないか確認
   - Network タブで動画ファイルが正しく読み込まれているか確認

### Durationフィールドに自動入力されない場合

- Durationフィールドに既に値が入っている場合は、自動入力されません（ユーザーが設定した値を保護するため）
- 空の行で試してください
