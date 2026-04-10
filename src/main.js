/**
 * main.js – Application entry point
 *
 * iOS Safari 対応の重要ポイント:
 *  1. AudioContext は必ずボタン click の同期コード内で init() する
 *  2. 内蔵曲データはインライン定義 → fetch 不要・ネットワーク遅延ゼロ
 *  3. touch-action: manipulation で誤ダブルタップズームを防止
 */

import { Game } from './game.js';
import { InputManager } from './input.js';
import { AudioEngine } from './audio.js';
import { normalizeChart, generateBPMChart } from './chart.js';

// ---- Shared audio engine ----
const sharedAudio = new AudioEngine();

// ---- DOM references ----
const screens = {
  start:  document.getElementById('screen-start'),
  game:   document.getElementById('screen-game'),
  pause:  document.getElementById('screen-pause'),
  result: document.getElementById('screen-result'),
};
const el = {
  canvas:          document.getElementById('game-canvas'),
  scoreDisplay:    document.getElementById('score-display'),
  comboDisplay:    document.getElementById('combo-display'),
  comboNumber:     document.getElementById('combo-number'),
  judgmentDisplay: document.getElementById('judgment-display'),
  gaugeFill:       document.getElementById('gauge-fill'),
  progressBar:     document.getElementById('progress-bar'),
  laneOverlay:     document.getElementById('lane-overlay'),
  effectsLayer:    document.getElementById('effects-layer'),
  hudSongName:     document.getElementById('hud-song-name'),
  hudDifficulty:   document.getElementById('hud-difficulty'),
  btnStart:        document.getElementById('btn-start'),
  btnUpload:       document.getElementById('btn-upload'),
  fileInput:       document.getElementById('file-input'),
  dropZone:        document.getElementById('drop-zone'),
  uploadSettings:  document.getElementById('upload-settings'),
  uploadFilename:  document.getElementById('upload-filename'),
  inputTitle:      document.getElementById('input-title'),
  inputBpm:        document.getElementById('input-bpm'),
  inputBpmRange:   document.getElementById('input-bpm-range'),
  inputDifficulty: document.getElementById('input-difficulty'),
  btnPlayUpload:   document.getElementById('btn-play-upload'),
  btnCancelUpload: document.getElementById('btn-cancel-upload'),
  btnPause:        document.getElementById('btn-pause'),
  btnRetry:        document.getElementById('btn-retry'),
  btnResume:       document.getElementById('btn-resume'),
  btnPauseRetry:   document.getElementById('btn-pause-retry'),
  btnPauseQuit:    document.getElementById('btn-pause-quit'),
  btnResultRetry:  document.getElementById('btn-result-retry'),
  btnResultQuit:   document.getElementById('btn-result-quit'),
  resultTitle:     document.getElementById('result-title'),
  resultGrade:     document.getElementById('result-grade'),
  resultSongName:  document.getElementById('result-song-name'),
  resultScore:     document.getElementById('result-score'),
  resultCombo:     document.getElementById('result-combo'),
  resultPerfect:   document.getElementById('result-perfect'),
  resultGood:      document.getElementById('result-good'),
  resultMiss:      document.getElementById('result-miss'),
};

// ---- App state ----
let game = null;
let input = null;
let currentChart = null;
let isTransitioning = false;

// =========================================================
// 内蔵曲データ（インライン定義 = fetch 不要・即時利用可能）
// =========================================================

function getDemoBeatChart() {
  const bpm = 140;
  const beat = (60 / bpm) * 1000; // ≈ 428ms
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
  return { id:'demo_beat', title:'Demo Beat', artist:'Rhythm Drop',
           bpm, difficulty:'EASY', totalNotes:notes.length, audioFile:null, notes };
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
  return { id:'neon_city', title:'Neon City', artist:'Rhythm Drop',
           bpm:128, difficulty:'NORMAL', totalNotes:notes.length, audioFile:null, notes };
}

// =========================================================
// 起動処理（同期・即時）
// =========================================================

function initApp() {
  // 内蔵曲をインラインデータから即時ロード（fetch なし）
  const builtinCharts = [
    normalizeChart(getDemoBeatChart()),
    normalizeChart(getNeonCityChart()),
  ];

  // 曲タブを描画
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
    tab.addEventListener('click', () => selectSong(chart, idx, container));
    container.appendChild(tab);
  });

  // 最初の曲を選択
  selectSong(builtinCharts[0], 0, container);
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
    alert('曲データが読み込まれていません。ページを再読み込みしてください。');
    return;
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

function pauseGame()  {
  if (!game) return;
  game.pause();
  if (input) input.reset();
  showScreen('pause');
}
function resumeGame() {
  if (!game) return;
  showScreen('game');
  game.resume();
}
async function retryGame() {
  if (isTransitioning) return;
  // AudioContext はここで同期 init（再起動でも必要）
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
// ファイルアップロード
// =========================================================

function showDropZone() {
  el.dropZone.style.display       = '';
  el.uploadSettings.style.display = 'none';
}
function showUploadSettings(file) {
  el.uploadFilename.textContent   = file.name;
  el.inputTitle.value             = file.name.replace(/\.[^/.]+$/, '');
  el.dropZone.style.display       = 'none';
  el.uploadSettings.style.display = 'flex';
}

el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files[0];
  if (file) showUploadSettings(file);
});
el.btnCancelUpload.addEventListener('click', () => {
  el.fileInput.value = '';
  sharedAudio.clearUploadedAudio();
  showDropZone();
});

// Drag & Drop
el.dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); el.dropZone.classList.add('drag-over'); });
el.dropZone.addEventListener('dragleave', ()  => { el.dropZone.classList.remove('drag-over'); });
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) {
    const dt = new DataTransfer();
    dt.items.add(file);
    el.fileInput.files = dt.files;
    showUploadSettings(file);
  }
});

// BPM スライダー ↔ 数値入力 連動
el.inputBpmRange.addEventListener('input', () => { el.inputBpm.value = el.inputBpmRange.value; });
el.inputBpm.addEventListener('input', () => {
  el.inputBpmRange.value = Math.max(60, Math.min(240, parseInt(el.inputBpm.value) || 120));
});

// アップロード曲でプレイ
el.btnPlayUpload.addEventListener('click', async () => {
  const file = el.fileInput.files[0];
  if (!file) return;

  // ★ iOS Safari 対策: AudioContext を click の同期コードで必ず init
  sharedAudio.init();

  const title      = el.inputTitle.value.trim() || file.name.replace(/\.[^/.]+$/, '');
  const bpm        = Math.max(60, Math.min(240, parseInt(el.inputBpm.value) || 120));
  const difficulty = el.inputDifficulty.value;

  el.btnPlayUpload.disabled = true;
  el.btnPlayUpload.classList.add('btn-loading');
  el.btnPlayUpload.textContent = '読み込み中';

  try {
    await sharedAudio.resume();
    const arrayBuffer = await file.arrayBuffer();
    await sharedAudio.loadAudioBuffer(arrayBuffer);

    const durationMs = sharedAudio._songBuffer.duration * 1000;
    currentChart = normalizeChart(generateBPMChart({ title, bpm, durationMs, difficulty }));
    updateStartScreenInfo(currentChart);
    showDropZone();
    el.fileInput.value = '';
    await startGame();
  } catch (err) {
    console.error('[upload]', err);
    alert(`音楽ファイルの読み込みに失敗しました。\n対応形式: MP3 / WAV / OGG / AAC\n\n${err.message}`);
  } finally {
    el.btnPlayUpload.disabled = false;
    el.btnPlayUpload.classList.remove('btn-loading');
    el.btnPlayUpload.textContent = 'この曲でプレイ';
  }
});

// =========================================================
// ボタン配線
// =========================================================

// ★ PLAY ボタン: AudioContext を click の同期コードで init してから startGame
el.btnStart.addEventListener('click', () => {
  sharedAudio.init(); // 必ず同期で呼ぶ（iOS Safari 対策）
  startGame();
});

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
initApp(); // 同期実行 — fetch なし
