/**
 * main.js – Application entry point
 *
 * Wires together:
 *  - Screen transitions (Start → Game → Pause → Result)
 *  - Game instance lifecycle (load, start, pause, resume, retry)
 *  - InputManager lifecycle
 *  - Future: file upload UI, JSON chart loading
 */

import { Game } from './game.js';
import { InputManager } from './input.js';
import { loadChart, normalizeChart } from './chart.js';

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

  // Buttons
  btnStart:        document.getElementById('btn-start'),
  btnPause:        document.getElementById('btn-pause'),
  btnRetry:        document.getElementById('btn-retry'),
  btnResume:       document.getElementById('btn-resume'),
  btnPauseRetry:   document.getElementById('btn-pause-retry'),
  btnPauseQuit:    document.getElementById('btn-pause-quit'),
  btnResultRetry:  document.getElementById('btn-result-retry'),
  btnResultQuit:   document.getElementById('btn-result-quit'),
  btnUpload:       document.getElementById('btn-upload'),

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
let isTransitioning = false; // prevent double-click issues

// ---- Screen helpers ----

/**
 * Show one screen, hide all others.
 * Overlays (pause/result) stack on top of game screen.
 * @param {'start'|'game'|'pause'|'result'} name
 */
function showScreen(name) {
  // Always show/hide game screen independently of overlays
  if (name === 'pause' || name === 'result') {
    screens.game.classList.add('active');
    screens.pause.classList.remove('active');
    screens.result.classList.remove('active');
    screens.start.classList.remove('active');
    screens[name].classList.add('active');
  } else {
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('active', key === name);
    }
  }
}

// ---- Chart loading ----

async function loadDemoChart() {
  // Try loading from file first; fall back to inline data
  try {
    return normalizeChart(await loadChart('./data/demo-chart.json'));
  } catch (e) {
    console.warn('[main] Could not fetch chart JSON, using inline fallback:', e.message);
    return normalizeChart(getFallbackChart());
  }
}

/** Inline fallback so the game works even without a server (file:// protocol). */
function getFallbackChart() {
  const bpm = 140;
  const beat = (60 / bpm) * 1000; // ms per beat ≈ 428ms
  const notes = [];

  // 8 bars × 4 beats × occasional 8ths — hand-crafted pattern
  const pattern = [
  // bar 1
    [0, 2], [1, 2], [2, 0], [2, 4], [3, 2], [3.5, 1], [4, 3],
  // bar 2
    [4, 2], [5, 0], [5, 4], [6, 2], [7, 1], [7, 3],
  // bar 3
    [8, 2], [9, 0], [9, 4], [10, 2], [10.5, 1], [11, 3], [11.5, 2],
  // bar 4
    [12, 0], [12, 4], [13, 2], [14, 1], [14, 3], [15, 2],
  // bar 5 – busier
    [16, 2], [16.5, 0], [17, 1], [17.5, 4], [18, 2], [18.5, 3],
    [19, 0], [19, 4], [19.5, 2],
  // bar 6
    [20, 1], [20, 3], [21, 2], [21.5, 0], [22, 4], [22.5, 2],
    [23, 1], [23.5, 3],
  // bar 7
    [24, 0], [24, 2], [24, 4], [25, 1], [25, 3], [26, 2], [27, 0], [27, 4],
  // bar 8 – finale
    [28, 2], [28.5, 1], [29, 3], [29.5, 0], [29.5, 4],
    [30, 2], [30.5, 1], [30.5, 3], [31, 0], [31, 2], [31, 4],
  ];

  for (const [beatPos, lane] of pattern) {
    notes.push({ time: Math.round(beatPos * beat + beat * 2), lane });
  }

  return {
    id: 'demo_beat',
    title: 'Demo Beat',
    artist: 'Rhythm Drop',
    bpm,
    difficulty: 'EASY',
    totalNotes: notes.length,
    audioFile: null,
    notes,
  };
}

// ---- Game lifecycle ----

async function initGame() {
  if (!currentChart) {
    currentChart = await loadDemoChart();
  }

  // Update start screen info
  document.getElementById('start-song-name').textContent = currentChart.title;
  document.getElementById('start-bpm').textContent = `BPM ${currentChart.bpm}`;
  const diffEl = document.getElementById('start-difficulty');
  diffEl.textContent = currentChart.difficulty;
  diffEl.className = `difficulty ${currentChart.difficulty.toLowerCase()}`;
}

async function startGame() {
  if (isTransitioning) return;
  isTransitioning = true;

  try {
    // Create game instance (fresh each play to reset state)
    if (game) {
      game.audio.stop();
    }

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
    });

    game.onResult = showResult;
    game.onPause  = () => showScreen('pause');

    game.loadChart(currentChart);

    // Update game HUD
    el.hudSongName.textContent   = currentChart.title;
    el.hudDifficulty.textContent = currentChart.difficulty;

    // Destroy previous input manager
    if (input) input.destroy();
    input = new InputManager(
      el.laneOverlay,
      (lane) => game.pressLane(lane),
      (lane) => game.releaseLane(lane),
    );

    showScreen('game');

    // Clear any leftover effects
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
  showScreen('game');
  await startGame();
}

function quitToMenu() {
  if (game) {
    game.audio.stop();
    game = null;
  }
  if (input) {
    input.destroy();
    input = null;
  }
  showScreen('start');
}

// ---- Result screen ----

function showResult({ score, maxCombo, counts, grade, title }) {
  el.resultSongName.textContent = title;
  el.resultScore.textContent   = String(score).padStart(6, '0');
  el.resultCombo.textContent   = maxCombo;
  el.resultPerfect.textContent = counts.perfect;
  el.resultGood.textContent    = counts.good;
  el.resultMiss.textContent    = counts.miss;

  const gradeEl = el.resultGrade;
  gradeEl.textContent  = grade;
  gradeEl.className    = `result-grade ${grade}`;

  el.resultTitle.textContent = grade === 'S' ? 'FULL COMBO!' : grade === 'F' ? 'GAME OVER' : 'RESULT';

  showScreen('result');
}

// ---- File upload (future extension point) ----
// When implemented, this section will:
//  1. Read the selected audio file into an ArrayBuffer
//  2. Call game.audio.loadAudioBuffer(arrayBuffer)
//  3. Run audio analysis (chart.generateAudioChart) or BPM chart
//  4. Replace currentChart and call startGame()
//
// The UI button is already in index.html (disabled for now).

el.btnUpload.addEventListener('click', () => {
  // TODO: open file picker and load audio
  alert('音楽ファイル対応は近日公開予定です！');
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

// Keyboard shortcut: Escape → pause/resume
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (screens.game.classList.contains('active') && screens.pause.classList.contains('active')) {
      resumeGame();
    } else if (screens.game.classList.contains('active')) {
      pauseGame();
    }
  }
});

// Prevent context menu on long-press (mobile)
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- Bootstrap ----

initGame();
