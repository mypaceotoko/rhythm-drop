# Rhythm Drop 🎵

5レーンのブラウザ音ゲー。GitHub Pages でそのまま公開できます。

---

## ファイル構成

```
rhythm-drop/
├── index.html              # エントリーポイント・全画面のHTML
├── src/
│   ├── style.css           # 全スタイル（CSS変数・アニメーション含む）
│   ├── main.js             # 画面遷移・ボタン配線・起動処理
│   ├── game.js             # ゲームコアロジック（判定・スコア・ゲームループ）
│   ├── renderer.js         # Canvas描画エンジン（ノーツ・レーン・ヒットライン）
│   ├── audio.js            # Web Audio API ラッパー（デモビート・SE）
│   ├── effects.js          # DOM エフェクト（パーティクル・フラッシュ）
│   ├── input.js            # キーボード・タッチ入力管理
│   └── chart.js            # 譜面の読み込み・生成・正規化
└── data/
    └── demo-chart.json     # デモ譜面データ（JSON形式）
```

---

## 起動方法

### ローカルで動かす（推奨）

ES Modules を使っているので、**ローカルサーバーが必要**です。

```bash
# Python 3
cd rhythm-drop
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code の場合
# 「Live Server」拡張機能でindex.htmlを右クリック → Open with Live Server
```

ブラウザで `http://localhost:8080` を開く。

> **注意**: `file://` で直接開くと fetch が CORS エラーになりますが、
> `main.js` 内のインラインフォールバック譜面が自動的に使われるため
> ゲーム自体は動きます（`file://` でも動作可能）。

### キーボード操作

| キー | レーン |
|------|--------|
| `S`  | 1 (左端) |
| `D`  | 2 |
| `F`  | 3 (中央) |
| `J`  | 4 |
| `K`  | 5 (右端) |
| `Esc` | 一時停止 / 再開 |

---

## GitHub Pages で公開する手順

1. GitHub にリポジトリを作成（または既存リポジトリを使用）

2. コードをプッシュ
   ```bash
   git add .
   git commit -m "Add Rhythm Drop game"
   git push origin main
   ```

3. リポジトリの **Settings → Pages** を開く

4. **Source** を `Deploy from a branch` に設定

5. **Branch** を `main`（または `master`）、フォルダを `/ (root)` にして **Save**

6. 数分後に `https://<username>.github.io/<repo-name>/` で公開される

---

## 判定ウィンドウ

| 判定    | タイミング誤差 | スコア    |
|---------|--------------|-----------|
| PERFECT | ±60ms        | 300 × コンボ倍率 |
| GOOD    | ±120ms       | 100 × コンボ倍率 |
| MISS    | それ以外      | 0         |

### コンボ倍率
| コンボ数 | 倍率 |
|---------|------|
| 100+    | ×2.0 |
| 50+     | ×1.5 |
| 20+     | ×1.2 |
| 0+      | ×1.0 |

---

## 今後の拡張ポイント

### 1. 音楽ファイル対応

`src/main.js` の「File upload」セクション（コメント `// TODO: open file picker`）に実装します。

```js
// 例: ファイル選択 → AudioBuffer をゲームに渡す
const file = await openFilePicker();
const arrayBuffer = await file.arrayBuffer();
await game.audio.loadAudioBuffer(arrayBuffer);  // audio.js に実装済み
game.audio.startAudio(0);                        // startAudio() も実装済み
```

### 2. 譜面JSON読み込み

`src/chart.js` の `loadChart(url)` を呼ぶだけです。

```js
import { loadChart, normalizeChart } from './src/chart.js';
const chart = normalizeChart(await loadChart('./data/my-chart.json'));
```

JSONの形式:
```json
{
  "title": "My Song",
  "bpm": 120,
  "difficulty": "NORMAL",
  "notes": [
    { "time": 1000, "lane": 2 },
    { "time": 1500, "lane": 0 }
  ]
}
```
`time` は曲開始からのミリ秒、`lane` は 0〜4。

### 3. BPM自動譜面生成

`src/chart.js` の `generateBPMChart()` を使います。

```js
import { generateBPMChart } from './src/chart.js';
const chart = generateBPMChart({
  title: 'Auto',
  bpm: 128,
  durationMs: 180000,
  subdivision: 2,   // 1 = 4分音符, 2 = 8分音符
  difficulty: 'NORMAL',
});
```

### 4. 音声解析ベースの自動譜面

`src/chart.js` に `generateAudioChart(audioBuffer, opts)` のスタブがあります。
将来的に [Meyda](https://meyda.js.org/) などのオンセット検出ライブラリと
差し替えることを想定した設計です。

### 5. 譜面エディタモード

ノーツ生成ロジックは `src/chart.js` に分離済みです。
エディタは「時刻・レーン」の配列を編集し、`normalizeChart()` で正規化する
だけで既存のゲームエンジンをそのまま利用できます。

### 6. 難易度の追加

同じ楽曲で複数の難易度を持つには、`demo-chart.json` と同じ形式で
`demo-chart-hard.json` などを用意し、スタート画面のセレクタで切り替えます。

---

## ブラウザ対応

| ブラウザ | 状況 |
|----------|------|
| Chrome / Edge (最新) | ✅ |
| Firefox (最新)       | ✅ |
| Safari (iOS 15+)     | ✅ |
| Samsung Internet     | ✅ |
| IE11                 | ❌ (ES Modules 非対応) |
