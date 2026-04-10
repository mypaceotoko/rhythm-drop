/**
 * main.js – Application entry point
 *
 * Wires together:
 *  - Screen transitions (Start → Game → Pause → Result)
 *  - Game instance lifecycle (load, start, pause, resume, retry)
 *  - InputManager lifecycle
 *  - Music file upload (file picker + drag-and-drop)
 *  - BPM-based auto chart generation from uploaded audio
 */

import { Game } from './game.js';
import { InputManager } from './input.js';
import { AudioEngine } from './audio.js';
import { loadChart, normalizeChart, generateBPMChart } from './chart.js';

// ---- Shared audio engine (persists across game instances / retries) ----
const sharedAudio = new AudioEngine();

// ---- DOM references ----

const screens = {
  start:  document.getElementById('screen-start'),
  game:   document.getElementById('screen-game'),
  pause:  document.getElementById('screen-pause'),
  result: document.getElementById('screen-result'),
};

const el = {
  // Game screen
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

  // Start screen buttons
  btnStart:        document.getElementById('btn-start'),
  btnUpload:       document.getElementById('btn-upload'),

  // Upload UI
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

  // Game screen buttons
  btnPause:        document.getElementById('btn-pause'),
  btnRetry:        document.getElementById('btn-retry'),
  btnResume:       document.getElementById('btn-resume'),
  btnPauseRetry:   document.getElementById('btn-pause-retry'),
  btnPauseQuit:    document.getElementById('btn-pause-quit'),
  btnResultRetry:  document.getElementById('btn-result-retry'),
  btnResultQuit:   document.getElementById('btn-result-quit'),

  // Result screen
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

// ---- Screen helpers ----

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

// ---- Built-in song list ----

const BUILTIN_SONGS = [
  { file: './data/demo-chart.json',  label: 'Demo Beat',  bpm: 140, difficulty: 'EASY'   },
  { file: './data/neon-city.json',   label: 'Neon City',  bpm: 128, difficulty: 'NORMAL' },
];

let builtinCharts = []; // loaded chart objects in order

// ---- Chart loading ----

async function loadDemoChart() {
  try {
    return normalizeChart(await loadChart('./data/demo-chart.json'));
  } catch (e) {
    console.warn('[main] Chart JSON fetch failed, using fallback:', e.message);
    return normalizeChart(getFallbackChart());
  }
}

function getFallbackChart() {
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
    time: Math.round(b * beat + beat * 2), lane
  }));
  return {
    id: 'demo_beat', title: 'Demo Beat', artist: 'Rhythm Drop',
    bpm, difficulty: 'EASY', totalNotes: notes.length, audioFile: null, notes,
  };
}

// ---- Start screen init ----

function updateStartScreenInfo(chart) {
  document.getElementById('start-song-name').textContent = chart.title;
  document.getElementById('start-bpm').textContent = `BPM ${chart.bpm}`;
  const diffEl = document.getElementById('start-difficulty');
  diffEl.textContent = chart.difficulty;
  diffEl.className = `difficulty ${chart.difficulty.toLowerCase()}`;
}

async function initApp() {
  // Load all built-in charts (best-effort; fallback on error)
  builtinCharts = await Promise.all(
    BUILTIN_SONGS.map(async (song) => {
      try {
        return normalizeChart(await loadChart(song.file));
      } catch (_) {
        return null;
      }
    })
  );
  // Filter out failed loads; guarantee at least the fallback demo
  if (!builtinCharts[0]) builtinCharts[0] = normalizeChart(getFallbackChart());
  builtinCharts = builtinCharts.filter(Boolean);

  buildSongSelector();
  selectBuiltinSong(0);
}

/** Render the horizontal song-tab strip. */
function buildSongSelector() {
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
    tab.addEventListener('click', () => selectBuiltinSong(idx));
    container.appendChild(tab);
  });
}

/** Select a built-in chart by index and update the start screen. */
function selectBuiltinSong(idx) {
  builtinCharts.forEach((_, i) => {
    const tab = document.querySelector(`.song-tab[data-idx="${i}"]`);
    if (tab) tab.classList.toggle('active', i === idx);
  });
  currentChart = builtinCharts[idx];
  // Clear any uploaded audio so we use the synth demo
  sharedAudio.clearUploadedAudio();
  updateStartScreenInfo(currentChart);
}

// ---- Game lifecycle ----

async function startGame() {
  if (isTransitioning) return;
  isTransitioning = true;

  try {
    if (game) game.audio.stop();

    // Create a fresh Game that uses the shared AudioEngine
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
    }, sharedAudio); // inject shared engine

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
  } finally {
    isTransitioning = false;
  }
}

function pauseGame() {
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
  await startGame();
}

function quitToMenu() {
  if (game) { game.audio.stop(); game = null; }
  if (input) { input.destroy(); input = null; }
  showScreen('start');
}

// ---- Result screen ----

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

// ---- File upload ----

/** Show the drop zone, hide the settings panel. */
function showDropZone() {
  el.dropZone.style.display      = '';   // CSS の display:flex に戻す
  el.uploadSettings.style.display = 'none';
}

/** Show the settings panel with the selected file info. */
function showUploadSettings(file) {
  const rawName = file.name.replace(/\.[^/.]+$/, ''); // strip extension
  el.uploadFilename.textContent   = file.name;
  el.inputTitle.value             = rawName;
  el.dropZone.style.display       = 'none';
  el.uploadSettings.style.display = 'flex';
}

/** File picked via dialog (label[for=file-input] handles opening natively). */
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files[0];
  if (file) showUploadSettings(file);
});

/** Cancel upload → back to drop zone. */
el.btnCancelUpload.addEventListener('click', () => {
  el.fileInput.value = '';
  sharedAudio.clearUploadedAudio();
  showDropZone();
});

// ---- Drag & Drop ----
el.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropZone.classList.add('drag-over');
});
el.dropZone.addEventListener('dragleave', () => {
  el.dropZone.classList.remove('drag-over');
});
el.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) {
    // Sync the file to the hidden input so we can read it later
    const dt = new DataTransfer();
    dt.items.add(file);
    el.fileInput.files = dt.files;
    showUploadSettings(file);
  } else if (file) {
    alert('対応しているファイル形式は MP3 / WAV / OGG / AAC です。');
  }
});

// ---- BPM slider ↔ number input sync ----
el.inputBpmRange.addEventListener('input', () => {
  el.inputBpm.value = el.inputBpmRange.value;
});
el.inputBpm.addEventListener('input', () => {
  const v = Math.max(60, Math.min(240, parseInt(el.inputBpm.value) || 120));
  el.inputBpmRange.value = v;
});

// ---- Play uploaded file ----
el.btnPlayUpload.addEventListener('click', async () => {
  const file = el.fileInput.files[0];
  if (!file) return;

  const title      = el.inputTitle.value.trim() || file.name.replace(/\.[^/.]+$/, '');
  const bpm        = Math.max(60, Math.min(240, parseInt(el.inputBpm.value) || 120));
  const difficulty = el.inputDifficulty.value;

  // Show loading state
  el.btnPlayUpload.disabled = true;
  el.btnPlayUpload.classList.add('btn-loading');
  el.btnPlayUpload.textContent = '読み込み中';

  try {
    // Init AudioContext in this user-gesture handler (required by browsers)
    sharedAudio.init();
    await sharedAudio.resume();

    // Decode the audio file
    const arrayBuffer = await file.arrayBuffer();
    await sharedAudio.loadAudioBuffer(arrayBuffer);

    const durationMs = sharedAudio._songBuffer.duration * 1000;

    // Generate BPM chart for this duration
    const rawChart = generateBPMChart({ title, bpm, durationMs, difficulty });
    currentChart = normalizeChart(rawChart);

    // Update start screen info
    updateStartScreenInfo(currentChart);

    // Reset upload UI
    showDropZone();
    el.fileInput.value = '';

    // Launch the game immediately
    await startGame();

  } catch (err) {
    console.error('[upload] Failed:', err);
    alert(
      '音楽ファイルの読み込みに失敗しました。\n' +
      '対応形式: MP3 / WAV / OGG / AAC\n\n' +
      `詳細: ${err.message}`
    );
  } finally {
    el.btnPlayUpload.disabled = false;
    el.btnPlayUpload.classList.remove('btn-loading');
    el.btnPlayUpload.textContent = 'この曲でプレイ';
  }
});

// ---- Button wiring ----

el.btnStart.addEventListener('click', startGame);
el.btnPause.addEventListener('click', pauseGame);
el.btnRetry.addEventListener('click', retryGame);
el.btnResume.addEventListener('click', resumeGame);
el.btnPauseRetry.addEventListener('click', retryGame);
el.btnPauseQuit.addEventListener('click', quitToMenu);
el.btnResultRetry.addEventListener('click', retryGame);
el.btnResultQuit.addEventListener('click', quitToMenu);

// Escape key → pause / resume
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (screens.game.classList.contains('active') &&
      screens.pause.classList.contains('active')) {
    resumeGame();
  } else if (screens.game.classList.contains('active')) {
    pauseGame();
  }
});

// Prevent context menu on long-press (mobile)
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- Bootstrap ----
initApp();
