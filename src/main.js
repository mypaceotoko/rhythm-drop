/**
 * main.js – Application entry point
 *
 * iOS Safari 対応の重要ポイント:
 *  1. AudioContext は必ずボタン click / touchstart の同期コード内で init() する
 *  2. touch-action: none を body に設定しない（click が発火しなくなる）
 *  3. 内蔵曲データはインライン定義 → fetch 不要・ネットワーク遅延ゼロ
 *  4. decodeAudioData は callback 形式を使用（古い iOS Safari は Promise 非対応）
 */

import { Game }                                       from './game.js';
import { InputManager }                               from './input.js';
import { AudioEngine }                                from './audio.js';
import { normalizeChart, generateBPMChart,
         buildChartFromAnalysis }                     from './chart.js';
import { analyzeAudio }                               from './analyzer.js';
import { SongStorage }                               from './storage.js';

// ---- Shared audio engine / storage ----
const sharedAudio = new AudioEngine();
const storage     = new SongStorage();

// ---- DOM references ----
const screens = {
  start:  document.getElementById('screen-start'),
  game:   document.getElementById('screen-game'),
  pause:  document.getElementById('screen-pause'),
  result: document.getElementById('screen-result'),
};
const el = {
  canvas:              document.getElementById('game-canvas'),
  scoreDisplay:        document.getElementById('score-display'),
  comboDisplay:        document.getElementById('combo-display'),
  comboNumber:         document.getElementById('combo-number'),
  judgmentDisplay:     document.getElementById('judgment-display'),
  gaugeFill:           document.getElementById('gauge-fill'),
  progressBar:         document.getElementById('progress-bar'),
  laneOverlay:         document.getElementById('lane-overlay'),
  effectsLayer:        document.getElementById('effects-layer'),
  hudSongName:         document.getElementById('hud-song-name'),
  hudDifficulty:       document.getElementById('hud-difficulty'),
  btnStart:            document.getElementById('btn-start'),
  // Upload
  fileInput:           document.getElementById('file-input'),
  dropZone:            document.getElementById('drop-zone'),
  uploadSettings:      document.getElementById('upload-settings'),
  uploadFilename:      document.getElementById('upload-filename'),
  uploadStatus:        document.getElementById('upload-status'),
  inputTitle:          document.getElementById('input-title'),
  inputDifficulty:     document.getElementById('input-difficulty'),
  btnAnalyze:          document.getElementById('btn-analyze'),
  btnCancelUpload:     document.getElementById('btn-cancel-upload'),
  // Analysis progress
  analysisProgress:    document.getElementById('analysis-progress'),
  analysisBarFill:     document.getElementById('analysis-bar-fill'),
  analysisStatusText:  document.getElementById('analysis-status-text'),
  // Post-analysis
  postAnalysisActions: document.getElementById('post-analysis-actions'),
  analysisResultInfo:  document.getElementById('analysis-result-info'),
  btnPlayAnalyzed:     document.getElementById('btn-play-analyzed'),
  btnSaveSong:         document.getElementById('btn-save-song'),
  // Saved songs section
  savedSection:        document.getElementById('saved-section'),
  savedList:           document.getElementById('saved-list'),
  savedCount:          document.getElementById('saved-count'),
  // Game controls
  btnPause:            document.getElementById('btn-pause'),
  btnRetry:            document.getElementById('btn-retry'),
  btnResume:           document.getElementById('btn-resume'),
  btnPauseRetry:       document.getElementById('btn-pause-retry'),
  btnPauseQuit:        document.getElementById('btn-pause-quit'),
  btnResultRetry:      document.getElementById('btn-result-retry'),
  btnResultQuit:       document.getElementById('btn-result-quit'),
  resultTitle:         document.getElementById('result-title'),
  resultGrade:         document.getElementById('result-grade'),
  resultSongName:      document.getElementById('result-song-name'),
  resultScore:         document.getElementById('result-score'),
  resultCombo:         document.getElementById('result-combo'),
  resultPerfect:       document.getElementById('result-perfect'),
  resultGood:          document.getElementById('result-good'),
  resultMiss:          document.getElementById('result-miss'),
  btnUseDemo:          document.getElementById('btn-use-demo'),
};

// ---- App state ----
let game            = null;
let input           = null;
let currentChart    = null;
let isTransitioning = false;
let _pendingFile    = null;  // File オブジェクト（解析済み・保存用に保持）
let _builtinCharts  = null;  // initApp() で設定 → デモ曲リセットに使用
let _isAnalyzing   = false; // 重複解析ガード

// =========================================================
// 内蔵曲データ（インライン定義 = fetch 不要・即時利用可能）
// =========================================================

function getDemoBeatChart() {
  const bpm = 140;
  const beat = (60 / bpm) * 1000;
  const pattern = [
    [0,2],[1,2],[2,0],[2,4],[3,2],[3.5,1],[4,3],
    [4,2],[5,0],[5,4],[6,2],[7,1],[7,3],
    [8,2],[9,0],[9,4],[10,2],[10.5,1],[11,3],[11.5,2],
    [12,0],[12,4],[13,2],[14,1],[14,3],[15,2],
    [16,2],[16.5,0],[17,1],[17.5,4],[18,2],[18.5,3],
    [19,0],[19,4],[19.5,2],
    [20,1],[20,3],[21,2],[21.5,0],[22,4],[22.5,2],
    [23,1],[23.5,3],
    [24,0],[24,2],[24,4],[25,1],[25,3],[26,2],[27,0],[27,4],
    [28,2],[28.5,1],[29,3],[29.5,0],[29.5,4],
    [30,2],[30.5,1],[30.5,3],[31,0],[31,2],[31,4],
  ];
  const notes = pattern.map(([b, lane]) => ({
    time: Math.round(b * beat + beat * 2), lane,
  }));
  return {
    id: 'demo_beat', title: 'Demo Beat', artist: 'Rhythm Drop',
    bpm, difficulty: 'EASY', totalNotes: notes.length, audioFile: null, notes,
  };
}

function getNeonCityChart() {
  const notes = [
    {time:469,lane:2},{time:938,lane:0},{time:938,lane:4},{time:1172,lane:2},
    {time:1406,lane:1},{time:1641,lane:3},{time:1875,lane:2},{time:2109,lane:0},
    {time:2344,lane:4},{time:2578,lane:2},{time:2813,lane:1},{time:2813,lane:3},
    {time:3047,lane:2},{time:3281,lane:0},{time:3516,lane:4},{time:3750,lane:2},
    {time:3984,lane:1},{time:4219,lane:3},{time:4453,lane:0},{time:4453,lane:4},
    {time:4688,lane:2},{time:4922,lane:1},{time:5156,lane:3},{time:5391,lane:2},
    {time:5625,lane:0},{time:5859,lane:4},{time:6094,lane:2},{time:6328,lane:1},
    {time:6328,lane:3},{time:6563,lane:0},{time:6797,lane:2},{time:7031,lane:4},
    {time:7266,lane:1},{time:7500,lane:3},{time:7500,lane:2},{time:7734,lane:0},
    {time:7969,lane:4},{time:8203,lane:2},{time:8438,lane:1},{time:8672,lane:3},
    {time:8906,lane:0},{time:8906,lane:4},{time:9141,lane:2},{time:9375,lane:1},
    {time:9609,lane:3},{time:9844,lane:2},{time:10078,lane:0},{time:10313,lane:4},
    {time:10547,lane:2},{time:10781,lane:1},{time:10781,lane:3},{time:11016,lane:0},
    {time:11250,lane:2},{time:11484,lane:4},{time:11719,lane:1},{time:11953,lane:3},
    {time:12188,lane:2},{time:12422,lane:0},{time:12422,lane:4},{time:12656,lane:2},
    {time:12891,lane:1},{time:13125,lane:3},{time:13359,lane:2},{time:13594,lane:0},
    {time:13828,lane:4},{time:14063,lane:2},{time:14297,lane:1},{time:14297,lane:3},
    {time:14531,lane:0},{time:14766,lane:2},{time:15000,lane:4},{time:15234,lane:1},
    {time:15469,lane:3},{time:15703,lane:0},{time:15703,lane:4},{time:15938,lane:2},
    {time:16172,lane:1},{time:16406,lane:3},{time:16641,lane:2},
  ];
  return {
    id: 'neon_city', title: 'Neon City', artist: 'Rhythm Drop',
    bpm: 128, difficulty: 'NORMAL', totalNotes: notes.length, audioFile: null, notes,
  };
}

// =========================================================
// 起動処理
// =========================================================

function initApp() {
  _builtinCharts = [
    normalizeChart(getDemoBeatChart()),
    normalizeChart(getNeonCityChart()),
  ];
  const builtinCharts = _builtinCharts;

  const container = document.getElementById('song-selector');
  container.innerHTML = '';
  builtinCharts.forEach((chart, idx) => {
    const tab = document.createElement('button');
    tab.className = 'song-tab';
    tab.dataset.idx = idx;
    tab.innerHTML = `
      <span class="song-tab-title">${chart.title}</span>
      <span class="song-tab-meta">BPM ${chart.bpm} · ${chart.difficulty}</span>
    `;
    tab.addEventListener('touchstart', (e) => {
      e.preventDefault();
      selectSong(chart, idx, container);
    }, { passive: false });
    tab.addEventListener('click', () => selectSong(chart, idx, container));
    container.appendChild(tab);
  });

  selectSong(builtinCharts[0], 0, container);

  // 保存済み曲を非同期で読み込む（失敗してもゲームは動く）
  loadSavedSongs().catch(err => console.warn('[initApp] loadSavedSongs:', err));
}

function selectSong(chart, idx, container) {
  container = container || document.getElementById('song-selector');
  container.querySelectorAll('.song-tab').forEach((t, i) => {
    t.classList.toggle('active', i === idx);
  });
  currentChart = chart;
  sharedAudio.clearUploadedAudio();
  updateStartScreenInfo(chart);
}

function updateStartScreenInfo(chart) {
  document.getElementById('start-song-name').textContent = chart.title;
  document.getElementById('start-bpm').textContent = `BPM ${chart.bpm}`;
  const diffEl = document.getElementById('start-difficulty');
  diffEl.textContent = chart.difficulty;
  diffEl.className = `difficulty ${chart.difficulty.toLowerCase()}`;
}

// =========================================================
// ゲームライフサイクル
// =========================================================

async function startGame() {
  if (isTransitioning) return;
  if (!currentChart) {
    console.warn('[startGame] currentChart is null, falling back to demo');
    currentChart = normalizeChart(getDemoBeatChart());
  }
  isTransitioning = true;
  try {
    if (game) game.audio.stop();

    game = new Game({
      canvas:          el.canvas,
      scoreDisplay:    el.scoreDisplay,
      comboDisplay:    el.comboDisplay,
      comboNumber:     el.comboNumber,
      judgmentDisplay: el.judgmentDisplay,
      gaugeFill:       el.gaugeFill,
      progressBar:     el.progressBar,
      laneOverlay:     el.laneOverlay,
      effectsLayer:    el.effectsLayer,
    }, sharedAudio);

    game.onResult = showResult;
    game.onPause  = () => showScreen('pause');
    game.loadChart(currentChart);

    el.hudSongName.textContent   = currentChart.title;
    el.hudDifficulty.textContent = currentChart.difficulty;

    if (input) input.destroy();
    input = new InputManager(
      el.laneOverlay,
      (lane) => game.pressLane(lane),
      (lane) => game.releaseLane(lane),
    );

    showScreen('game');
    game.effects.clearAll();
    await game.start();
  } catch (err) {
    console.error('[startGame]', err);
    showScreen('start');
    alert(`ゲームの起動に失敗しました。\n${err.message}`);
  } finally {
    isTransitioning = false;
  }
}

function pauseGame()  { if (!game) return; game.pause(); if (input) input.reset(); showScreen('pause'); }
function resumeGame() { if (!game) return; showScreen('game'); game.resume(); }
async function retryGame() {
  if (isTransitioning) return;
  sharedAudio.init();
  await startGame();
}
function quitToMenu() {
  if (game)  { game.audio.stop(); game = null; }
  if (input) { input.destroy();   input = null; }
  showScreen('start');
}

// =========================================================
// 画面切替
// =========================================================

function showScreen(name) {
  if (name === 'pause' || name === 'result') {
    screens.game.classList.add('active');
    screens.pause.classList.remove('active');
    screens.result.classList.remove('active');
    screens.start.classList.remove('active');
    screens[name].classList.add('active');
  } else {
    for (const [key, scr] of Object.entries(screens)) {
      scr.classList.toggle('active', key === name);
    }
  }
}

// =========================================================
// リザルト画面
// =========================================================

function showResult({ score, maxCombo, counts, grade, title }) {
  el.resultSongName.textContent = title;
  el.resultScore.textContent    = String(score).padStart(6, '0');
  el.resultCombo.textContent    = maxCombo;
  el.resultPerfect.textContent  = counts.perfect;
  el.resultGood.textContent     = counts.good;
  el.resultMiss.textContent     = counts.miss;
  el.resultGrade.textContent    = grade;
  el.resultGrade.className      = `result-grade ${grade}`;
  el.resultTitle.textContent    =
    grade === 'S' ? 'FULL COMBO!' : grade === 'F' ? 'GAME OVER' : 'RESULT';
  showScreen('result');
}

// =========================================================
// アップロード UI ヘルパー
// =========================================================

function setUploadStatus(type, message) {
  if (!el.uploadStatus) return;
  el.uploadStatus.textContent = message;
  el.uploadStatus.className   = type ? `upload-status ${type}` : 'upload-status';
  el.uploadStatus.style.display = message ? '' : 'none';
}

function showDropZone() {
  el.dropZone.style.display            = '';
  el.uploadSettings.style.display      = 'none';
  el.analysisProgress.style.display    = 'none';
  el.postAnalysisActions.style.display = 'none';
  setUploadStatus('', '');
  _pendingFile = null;
}

function showUploadSettings(file) {
  _pendingFile                        = file;
  el.uploadFilename.textContent       = file.name;
  el.inputTitle.value                 = file.name.replace(/\.[^/.]+$/, '');
  el.dropZone.style.display           = 'none';
  el.uploadSettings.style.display     = 'flex';
  el.analysisProgress.style.display   = 'none';
  el.postAnalysisActions.style.display = 'none';
  el.btnAnalyze.disabled              = false;
  el.btnAnalyze.textContent           = '🎵 解析して譜面作成';
  setUploadStatus('', '');
}

// 解析進捗バーを更新（0..1）
function setAnalysisProgress(ratio, statusText) {
  el.analysisBarFill.style.width      = `${Math.round(ratio * 100)}%`;
  el.analysisStatusText.textContent   = statusText;
}

// =========================================================
// IndexedDB 保存済み曲（Step 2）
// =========================================================

/** HTML エスケープ（innerHTML インジェクション防止） */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** IndexedDB から保存済み曲一覧を読み込み、画面に描画する */
async function loadSavedSongs() {
  try {
    await storage.init();
    const songs = await storage.list();
    renderSavedSongs(songs);
  } catch (err) {
    console.warn('[loadSavedSongs]', err.message);
    // IndexedDB が使えないブラウザ等 → 非表示のままにする
  }
}

/**
 * 保存済み曲一覧を #saved-list に描画する。
 * 0件のときはセクション全体を非表示。
 */
function renderSavedSongs(songs) {
  if (!songs || songs.length === 0) {
    el.savedSection.style.display = 'none';
    return;
  }

  el.savedSection.style.display = '';
  el.savedCount.textContent = `${songs.length}曲`;
  el.savedList.innerHTML = '';

  for (const song of songs) {
    const durMin = String(Math.floor((song.durationMs || 0) / 60000)).padStart(2, '0');
    const durSec = String(Math.floor(((song.durationMs || 0) % 60000) / 1000)).padStart(2, '0');
    const sizeMB = ((song.fileSizeBytes || 0) / 1024 / 1024).toFixed(1);
    const date   = new Date(song.savedAt || 0).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
    const diff   = (song.difficulty || 'NORMAL').toLowerCase();

    const item = document.createElement('div');
    item.className = 'saved-item';
    item.dataset.id = song.id;
    item.innerHTML = `
      <div class="saved-item-info">
        <div class="saved-item-name">${escapeHtml(song.title)}</div>
        <div class="saved-item-meta">
          BPM ${song.bpm} &middot;
          <span class="difficulty ${diff}" style="padding:1px 6px;font-size:0.6rem">${escapeHtml(song.difficulty)}</span>
          &middot; ${durMin}:${durSec} &middot; ${sizeMB}MB &middot; ${date}
        </div>
      </div>
      <div class="saved-item-actions">
        <button class="btn btn-xs btn-primary saved-play-btn"
                data-id="${song.id}"
                style="touch-action:manipulation">▶</button>
        <button class="btn btn-xs btn-ghost saved-delete-btn"
                data-id="${song.id}"
                data-title="${escapeHtml(song.title)}"
                style="touch-action:manipulation">✕</button>
      </div>
    `;
    el.savedList.appendChild(item);
  }

  // PLAY ボタン: touchstart で即レスポンス（iOS 0ms レイテンシ）
  el.savedList.querySelectorAll('.saved-play-btn').forEach(btn => {
    const id = Number(btn.dataset.id);
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      sharedAudio.init(); // AudioContext は同期コード内で unlock（iOS 必須）
      playSavedSong(id, btn);
    }, { passive: false });
    btn.addEventListener('click', () => {
      sharedAudio.init();
      playSavedSong(id, btn);
    });
  });

  // DELETE ボタン
  el.savedList.querySelectorAll('.saved-delete-btn').forEach(btn => {
    const id    = Number(btn.dataset.id);
    const title = btn.dataset.title;
    btn.addEventListener('click', () => deleteSavedSong(id, title));
  });
}

/**
 * 保存済み曲を再生する。
 * IndexedDB から Blob を取得 → デコード → ゲーム開始。
 * 失敗してもクラッシュしない。
 */
async function playSavedSong(id, triggerBtn = null) {
  if (isTransitioning) return;
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '…'; }

  try {
    const record = await storage.load(id);
    if (!record || !record.blob) throw new Error('データが見つかりません');

    await sharedAudio.resume();
    const arrayBuffer = await record.blob.arrayBuffer();
    await sharedAudio.loadAudioBuffer(arrayBuffer);

    // 保存済みチャートをそのまま使う（再解析不要）
    currentChart = normalizeChart(record.chart);
    updateStartScreenInfo(currentChart);
    await startGame();

  } catch (err) {
    console.error('[playSavedSong]', err);
    sharedAudio.clearUploadedAudio();
    if (!currentChart) currentChart = normalizeChart(getDemoBeatChart());
    alert(`曲の読み込みに失敗しました。\n${err.message}`);
  } finally {
    if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = '▶'; }
  }
}

/**
 * 保存済み曲を削除して一覧を再描画する。
 */
async function deleteSavedSong(id, title) {
  if (!confirm(`「${title}」を削除しますか？`)) return;
  try {
    await storage.delete(id);
    await loadSavedSongs(); // 一覧を再描画
  } catch (err) {
    console.error('[deleteSavedSong]', err);
    alert(`削除に失敗しました。\n${err.message}`);
  }
}

// =========================================================
// 音声解析フロー（Step 1 メイン実装）
// =========================================================

async function handleAnalyze() {
  if (_isAnalyzing) return;
  const file = _pendingFile || el.fileInput.files[0];
  if (!file) return;

  // ★ iOS Safari 必須: AudioContext を click の同期コード内で init
  sharedAudio.init();

  const title      = el.inputTitle.value.trim() || file.name.replace(/\.[^/.]+$/, '');
  const difficulty = el.inputDifficulty.value;

  // UI: 解析開始
  _isAnalyzing                         = true;
  el.btnAnalyze.disabled               = true;
  el.btnAnalyze.textContent            = '解析中...';
  el.analysisProgress.style.display    = '';
  el.postAnalysisActions.style.display = 'none';
  setAnalysisProgress(0, 'ファイルを読み込んでいます...');
  setUploadStatus('', '');

  try {
    // 1. AudioContext を resume（iOS ではユーザー操作後に resume が必要）
    await sharedAudio.resume();

    // 2. ファイルを ArrayBuffer として読み込む
    setAnalysisProgress(0.03, 'デコード中...');
    const arrayBuffer = await file.arrayBuffer();

    // 3. Web Audio API でデコード（callback 形式 → iOS Safari 互換）
    await sharedAudio.loadAudioBuffer(arrayBuffer);
    const audioBuffer = sharedAudio.audioBuffer;
    if (!audioBuffer) throw new Error('音声のデコードに失敗しました');

    const durationSec = audioBuffer.duration;
    if (durationSec < 0.5) throw new Error('音声ファイルが短すぎます');

    // 4. 音声解析（進捗コールバック付き）
    setAnalysisProgress(0.05, `解析中... (${Math.round(durationSec)}秒の曲)`);

    const analysis = await analyzeAudio(audioBuffer, (p) => {
      // analyzeAudio の進捗は 0..1 → UI は 5%〜90% にマッピング
      const mapped = 0.05 + p * 0.85;
      const pct    = Math.round(p * 100);
      let label    = '解析中...';
      if (p < 0.10) label = 'フィルタリング中...';
      else if (p < 0.65) label = `エネルギー解析中... ${pct}%`;
      else if (p < 0.78) label = `オンセット検出中... ${pct}%`;
      else if (p < 0.88) label = 'マージ処理中...';
      else               label = 'BPM推定中...';
      setAnalysisProgress(mapped, label);
    });

    // 5. 解析結果から譜面生成
    setAnalysisProgress(0.92, '譜面を生成中...');
    const rawChart  = buildChartFromAnalysis(analysis, { title, difficulty });
    currentChart    = normalizeChart(rawChart);
    updateStartScreenInfo(currentChart);

    // 6. 完了表示
    setAnalysisProgress(1.0, '完了');
    const durMin  = Math.floor(durationSec / 60);
    const durSec2 = Math.floor(durationSec % 60);
    el.analysisResultInfo.textContent =
      `✓ 解析完了\n` +
      `BPM ${analysis.bpm}  /  ${String(durMin).padStart(2,'0')}:${String(durSec2).padStart(2,'0')}` +
      `  /  ${currentChart.totalNotes} ノーツ (${difficulty})`;
    el.postAnalysisActions.style.display = '';

  } catch (err) {
    console.error('[analyze] error:', err);
    const msg = err.message || '不明なエラー';
    setUploadStatus('error', `解析失敗: ${msg}\n対応形式: MP3 / WAV / OGG / AAC`);
    el.analysisProgress.style.display = 'none';

    // フォールバック: デモ曲
    sharedAudio.clearUploadedAudio();
    if (!currentChart) currentChart = normalizeChart(getDemoBeatChart());

  } finally {
    _isAnalyzing            = false;
    el.btnAnalyze.disabled  = false;
    el.btnAnalyze.textContent = '🎵 解析して譜面作成';
  }
}

// =========================================================
// ファイルアップロード
// =========================================================

el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files[0];
  if (file) showUploadSettings(file);
});

el.btnCancelUpload.addEventListener('click', () => {
  el.fileInput.value = '';
  sharedAudio.clearUploadedAudio();
  _pendingFile = null;
  showDropZone();
});

// Drag & Drop（デスクトップ向け）
el.dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); el.dropZone.classList.add('drag-over'); });
el.dropZone.addEventListener('dragleave', ()  => { el.dropZone.classList.remove('drag-over'); });
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) {
    try { const dt = new DataTransfer(); dt.items.add(file); el.fileInput.files = dt.files; } catch (_) {}
    showUploadSettings(file);
  }
});

// =========================================================
// ボタン配線
// =========================================================

// 解析ボタン
el.btnAnalyze.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleAnalyze();
}, { passive: false });
el.btnAnalyze.addEventListener('click', handleAnalyze);

// 解析後: プレイボタン
el.btnPlayAnalyzed.addEventListener('touchstart', (e) => {
  e.preventDefault();
  sharedAudio.init();
  showDropZone();
  el.fileInput.value = '';
  startGame();
}, { passive: false });
el.btnPlayAnalyzed.addEventListener('click', () => {
  sharedAudio.init();
  showDropZone();
  el.fileInput.value = '';
  startGame();
});

// 解析後: 保存ボタン
el.btnSaveSong.addEventListener('click', async () => {
  if (!currentChart || !_pendingFile) {
    setUploadStatus('error', '保存する曲がありません。先に解析してください。');
    return;
  }

  const btn = el.btnSaveSong;
  btn.disabled    = true;
  btn.textContent = '保存中...';
  setUploadStatus('loading', '保存中...');

  try {
    await storage.init();

    // 容量見積もりをチェックして大きすぎる場合は早期エラー
    const usage = await storage.estimateUsage();
    if (usage) console.log(`[storage] ${usage.usageMB} MB / ${usage.quotaMB} MB used`);

    await storage.save(
      _pendingFile,
      {
        title:       currentChart.title,
        bpm:         currentChart.bpm,
        difficulty:  currentChart.difficulty,
        durationMs:  currentChart.audioDurationMs || sharedAudio.songDurationMs,
        totalNotes:  currentChart.totalNotes,
      },
      currentChart
    );

    setUploadStatus('success', `保存しました ✓\n「${currentChart.title}」を一覧に追加`);

    // 保存済み曲一覧を更新
    await loadSavedSongs();

    // 少し待ってからパネルを閉じる
    await new Promise(r => setTimeout(r, 1600));
    showDropZone();
    el.fileInput.value = '';
    _pendingFile = null;

  } catch (err) {
    console.error('[save]', err);
    setUploadStatus('error', `保存失敗: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = '💾 保存';
  }
});

// デモ曲に戻す
el.btnUseDemo.addEventListener('click', () => {
  if (!_builtinCharts) return;
  // アップロード状態をすべてリセット
  sharedAudio.clearUploadedAudio();
  _pendingFile = null;
  el.fileInput.value = '';
  showDropZone();
  // 最初の内蔵曲（Demo Beat）を選択
  const container = document.getElementById('song-selector');
  selectSong(_builtinCharts[0], 0, container);
});

// PLAY ボタン（内蔵曲 or 既に解析済みの曲）
el.btnStart.addEventListener('touchstart', (e) => {
  e.preventDefault();
  sharedAudio.init();
  startGame();
}, { passive: false });
el.btnStart.addEventListener('click', () => {
  sharedAudio.init();
  startGame();
});

// ゲーム操作
el.btnPause.addEventListener('click',       pauseGame);
el.btnRetry.addEventListener('click',       retryGame);
el.btnResume.addEventListener('click',      resumeGame);
el.btnPauseRetry.addEventListener('click',  retryGame);
el.btnPauseQuit.addEventListener('click',   quitToMenu);
el.btnResultRetry.addEventListener('click', retryGame);
el.btnResultQuit.addEventListener('click',  quitToMenu);

// Escape キー
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (screens.game.classList.contains('active') && screens.pause.classList.contains('active')) {
    resumeGame();
  } else if (screens.game.classList.contains('active')) {
    pauseGame();
  }
});

// 長押しコンテキストメニューを防止
window.addEventListener('contextmenu', (e) => e.preventDefault());

// =========================================================
// 起動
// =========================================================
initApp(); // 同期実行 — fetch なし・即時完了
