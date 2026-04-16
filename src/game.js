/**
 * game.js – Core game logic
 *
 * Manages:
 *  - Game state machine (IDLE → PLAYING → PAUSED → RESULT)
 *  - Note judgment (Perfect / Good / Miss) with timing windows
 *  - Score, combo, gauge
 *  - Input routing (keyboard + touch)
 *  - requestAnimationFrame game loop
 */

import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { Effects } from './effects.js';

// AudioEngine is injected from outside so a single context persists across retries

// ---- Constants ----
const LANE_COUNT = 5;
const JUDGMENT = {
  PERFECT: { label: 'PERFECT', window: 60,  score: 300, color: 'perfect' },
  GOOD:    { label: 'GOOD',    window: 120, score: 100, color: 'good'    },
  MISS:    { label: 'MISS',    window: 200, score: 0,   color: 'miss'    },
};

/** How many pixels a note travels per millisecond (scroll speed). */
const SCROLL_SPEED = 0.35;

/** Gauge: starts at 100, drains on miss, fills on hit. */
const GAUGE_START   = 70;
const GAUGE_PERFECT = 2.5;
const GAUGE_GOOD    = 1.0;
const GAUGE_MISS    = -8;
const GAUGE_MAX     = 100;
const GAUGE_MIN     = 0;

/** Combo multiplier thresholds */
const COMBO_MULTIPLIER = [
  { threshold: 100, multiplier: 2.0 },
  { threshold: 50,  multiplier: 1.5 },
  { threshold: 20,  multiplier: 1.2 },
  { threshold: 0,   multiplier: 1.0 },
];

/** Keys mapped to lane indices */
const LANE_KEYS = { s: 0, d: 1, f: 2, j: 3, k: 4 };

// Game state enum
const STATE = { IDLE: 'IDLE', PLAYING: 'PLAYING', PAUSED: 'PAUSED', RESULT: 'RESULT' };

export class Game {
  /**
   * @param {object} elements - all DOM references
   * @param {HTMLCanvasElement} elements.canvas
   * @param {HTMLElement} elements.scoreDisplay
   * @param {HTMLElement} elements.comboDisplay
   * @param {HTMLElement} elements.comboNumber
   * @param {HTMLElement} elements.judgmentDisplay
   * @param {HTMLElement} elements.gaugeBar  (outer)
   * @param {HTMLElement} elements.gaugeFill (inner)
   * @param {HTMLElement} elements.progressBar
   * @param {HTMLElement} elements.laneOverlay
   * @param {HTMLElement} elements.effectsLayer
   */
  /**
   * @param {object} elements - DOM references (see property list above)
   * @param {AudioEngine} [audioEngine] - shared engine; creates own if omitted
   */
  constructor(elements, audioEngine = null) {
    this.el = elements;
    this.renderer = new Renderer(elements.canvas);
    this.audio = audioEngine || new AudioEngine();
    this.effects = new Effects(elements.effectsLayer, this.renderer);

    this.state = STATE.IDLE;
    this.chart = null;

    // Runtime state
    this._raf = null;
    this._notes = [];       // working copy of chart notes with state flags
    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._gauge = GAUGE_START;
    this._counts = { perfect: 0, good: 0, miss: 0 };
    this._judgedCount = 0;

    // Timing
    this._lastFrameTime = 0;
    this._pressedLanes = new Set();

    // Callbacks (set by main.js)
    this.onResult = null;
    this.onPause = null;
  }

  // ---- Public API ----

  /**
   * Load a chart and prepare for play.
   * @param {object} chart - normalized chart object
   */
  loadChart(chart) {
    this.chart = chart;
    // Deep copy notes and add state fields
    this._notes = chart.notes.map((n, idx) => ({
      ...n,
      id: idx,
      hit: false,
      missed: false,
      hitFlash: 0,
    }));
  }

  /** Start (or restart) the game. */
  async start() {
    if (!this.chart) throw new Error('No chart loaded');

    this.audio.init();
    await this.audio.resume();

    // Reset state
    this._score = 0;
    this._combo = 0;
    this._maxCombo = 0;
    this._gauge = GAUGE_START;
    this._counts = { perfect: 0, good: 0, miss: 0 };
    this._judgedCount = 0;
    this._pressedLanes = new Set();
    this.renderer.pressedLanes = this._pressedLanes;

    // Reset notes
    this._notes = this.chart.notes.map((n, idx) => ({
      ...n,
      id: idx,
      hit: false,
      missed: false,
      hitFlash: 0,
    }));

    this._updateScore();
    this._updateCombo(0, false);
    this._updateGauge(GAUGE_START);

    // Start audio: use uploaded file if available, otherwise synth demo
    this.audio.stop();
    if (this.audio.hasUploadedAudio) {
      this.audio.startAudio(0);
    } else {
      this.audio.startDemo(this.chart.bpm);
    }

    this.state = STATE.PLAYING;
    this._loop();
  }

  /** Pause the game. */
  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.audio.pause();
    cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this.onPause) this.onPause();
  }

  /** Resume from pause. */
  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.audio.resume_song(this.chart.bpm);
    this.state = STATE.PLAYING;
    this._loop();
  }

  /** Trigger a note hit on a lane (from keyboard or touch). */
  pressLane(lane) {
    if (this.state !== STATE.PLAYING) return;
    this._pressedLanes.add(lane);
    this._judgeHit(lane);
    this.effects.spawnHitEffect(lane, null); // position computed inside effects
  }

  /** Release a lane key. */
  releaseLane(lane) {
    this._pressedLanes.delete(lane);
  }

  // ---- Game Loop ----

  _loop() {
    this._raf = requestAnimationFrame((ts) => {
      this._tick(ts);
      if (this.state === STATE.PLAYING) {
        this._loop();
      }
    });
  }

  _tick(_ts) {
    const songTime = this.audio.currentTimeMs;

    // Auto-miss notes that have passed too far
    this._checkMisses(songTime);

    // Update progress bar
    const duration = this._estimateDuration();
    const progress = Math.min(1, songTime / duration);
    this.el.progressBar.style.width = `${progress * 100}%`;

    // Draw
    this.renderer.draw(this._notes, songTime, SCROLL_SPEED);

    // Check if all notes are judged
    if (this._judgedCount >= this.chart.totalNotes && songTime > 1000) {
      // For uploaded audio, wait until near the end of the track before ending
      if (!this.chart.audioDurationMs || songTime >= duration - 2000) {
        this._endGame();
      }
    }
  }

  // ---- Judgment ----

  _judgeHit(lane) {
    const songTime = this.audio.currentTimeMs;

    // Find the closest unjudged note in this lane
    let closest = null;
    let closestDiff = Infinity;

    for (const note of this._notes) {
      if (note.lane !== lane || note.hit || note.missed) continue;
      const diff = Math.abs(note.time - songTime);
      if (diff < closestDiff && diff <= JUDGMENT.MISS.window) {
        closestDiff = diff;
        closest = note;
      }
    }

    if (!closest) return; // no note in range

    // Determine judgment
    let judgment;
    if (closestDiff <= JUDGMENT.PERFECT.window) {
      judgment = JUDGMENT.PERFECT;
    } else if (closestDiff <= JUDGMENT.GOOD.window) {
      judgment = JUDGMENT.GOOD;
    } else {
      judgment = JUDGMENT.MISS;
    }

    this._applyJudgment(closest, judgment);
  }

  _checkMisses(songTime) {
    for (const note of this._notes) {
      if (note.hit || note.missed) continue;
      if (songTime - note.time > JUDGMENT.MISS.window) {
        this._applyJudgment(note, JUDGMENT.MISS);
      }
    }
  }

  _applyJudgment(note, judgment) {
    note.hit = judgment !== JUDGMENT.MISS;
    note.missed = judgment === JUDGMENT.MISS;
    note.hitFlash = note.hit ? 8 : 0;
    this._judgedCount++;

    const isMiss = judgment === JUDGMENT.MISS;
    const newCombo = isMiss ? 0 : this._combo + 1;
    const multiplier = this._getMultiplier(newCombo);
    const points = Math.round(judgment.score * multiplier);

    this._score += points;
    this._combo = newCombo;
    if (this._combo > this._maxCombo) this._maxCombo = this._combo;

    const gaugeChange = isMiss
      ? GAUGE_MISS
      : judgment === JUDGMENT.PERFECT
        ? GAUGE_PERFECT
        : GAUGE_GOOD;
    this._gauge = Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, this._gauge + gaugeChange));

    // Update judgement count
    if (judgment === JUDGMENT.PERFECT) this._counts.perfect++;
    else if (judgment === JUDGMENT.GOOD) this._counts.good++;
    else this._counts.miss++;

    // Update UI
    this._updateScore();
    this._updateCombo(newCombo, !isMiss);
    this._updateGauge(this._gauge);
    this._showJudgment(judgment.label, judgment.color, isMiss);

    // Hit sound
    const soundType = isMiss ? 'miss' : judgment === JUDGMENT.PERFECT ? 'perfect' : 'good';
    this.audio.playHitSound(soundType);

    // Spawn particles on hit
    if (!isMiss) {
      this.effects.spawnParticles(note.lane);
    }
  }

  _getMultiplier(combo) {
    for (const { threshold, multiplier } of COMBO_MULTIPLIER) {
      if (combo >= threshold) return multiplier;
    }
    return 1;
  }

  // ---- End Game ----

  _endGame() {
    this.state = STATE.RESULT;
    this.audio.stop();
    cancelAnimationFrame(this._raf);
    this._raf = null;

    const grade = this._calcGrade();
    if (this.onResult) {
      this.onResult({
        score: this._score,
        maxCombo: this._maxCombo,
        counts: { ...this._counts },
        grade,
        title: this.chart.title,
      });
    }
  }

  _calcGrade() {
    const total = this.chart.totalNotes;
    const perfRate = this._counts.perfect / total;
    if (this._counts.miss === 0 && perfRate >= 0.95) return 'S';
    if (perfRate >= 0.8) return 'A';
    if (perfRate >= 0.6) return 'B';
    if (this._counts.miss < total * 0.2) return 'C';
    return 'F';
  }

  _estimateDuration() {
    // Use actual audio duration when available (uploaded file)
    if (this.chart && this.chart.audioDurationMs) return this.chart.audioDurationMs;
    if (!this.chart || !this.chart.notes.length) return 30000;
    const lastNote = this.chart.notes[this.chart.notes.length - 1];
    return lastNote.time + 3000; // 3s padding after last note
  }

  // ---- UI Helpers ----

  _updateScore() {
    this.el.scoreDisplay.textContent = String(this._score).padStart(6, '0');
    // Trigger pop animation
    this.el.scoreDisplay.classList.remove('score-pop');
    void this.el.scoreDisplay.offsetWidth; // reflow
    this.el.scoreDisplay.classList.add('score-pop');
  }

  _updateCombo(combo, show) {
    this.el.comboNumber.textContent = combo;
    if (show && combo > 1) {
      this.el.comboDisplay.classList.add('visible', 'combo-pop');
      this.el.comboDisplay.addEventListener('animationend', () => {
        this.el.comboDisplay.classList.remove('combo-pop');
      }, { once: true });
    } else if (!show || combo === 0) {
      this.el.comboDisplay.classList.remove('visible');
    }
  }

  _showJudgment(label, color, isMiss) {
    const el = this.el.judgmentDisplay;
    el.textContent = label;
    el.className = color;

    if (isMiss) {
      this.el.canvas.classList.add('shake');
      this.el.canvas.addEventListener('animationend', () => {
        this.el.canvas.classList.remove('shake');
      }, { once: true });
    }

    clearTimeout(this._judgeTimer);
    this._judgeTimer = setTimeout(() => {
      el.textContent = '';
      el.className = '';
    }, 600);
  }

  _updateGauge(value) {
    const pct = Math.max(0, Math.min(100, value));
    this.el.gaugeFill.style.width = `${pct}%`;
    if (pct < 30) {
      this.el.gaugeFill.classList.add('danger');
    } else {
      this.el.gaugeFill.classList.remove('danger');
    }
  }
}
