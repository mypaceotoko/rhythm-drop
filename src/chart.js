/**
 * chart.js – Chart (譜面) loading and generation utilities
 *
 * A "chart" object has the shape:
 * {
 *   id: string,
 *   title: string,
 *   artist: string,
 *   bpm: number,
 *   difficulty: string,
 *   totalNotes: number,
 *   audioFile: string|null,
 *   notes: Array<{ time: number, lane: number }>
 *   //   time: ms from song start
 *   //   lane: 0-4
 * }
 *
 * Future extension points:
 *  - loadFromJSON(url)          – already implemented
 *  - generateFromBPM(bpm, ...)  – simple auto-chart (stub)
 *  - generateFromAudio(...)     – audio-analysis chart (stub)
 */

const LANE_COUNT = 5;

/**
 * Load a chart from a JSON URL or object.
 * @param {string|object} source - URL string or already-parsed object
 * @returns {Promise<object>} chart object
 */
export async function loadChart(source) {
  if (typeof source === 'string') {
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`Failed to load chart: ${resp.status}`);
    return await resp.json();
  }
  return source;
}

/**
 * Generate a musical BPM-based chart.
 *
 * Design philosophy:
 *  - Notes follow repeating 8-step phrases that feel natural to tap
 *  - Difficulty controls note density and simultaneous hits
 *  - A 2-beat intro gives players time to prepare
 *  - Future: replace with audio-analysis onsets for true beat tracking
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {number} opts.bpm
 * @param {number} opts.durationMs   - total chart duration in ms
 * @param {string} [opts.difficulty] - 'EASY'|'NORMAL'|'HARD'
 * @returns {object} chart
 */
export function generateBPMChart({
  title = 'Auto Chart',
  bpm = 120,
  durationMs = 30000,
  difficulty = 'NORMAL',
}) {
  const beatMs = (60 / bpm) * 1000;

  // Per-difficulty settings
  const DIFF = {
    EASY:   { step: 1.0,  restRate: 0.25, dualRate: 0.00, patterns: EASY_PATTERNS },
    NORMAL: { step: 0.5,  restRate: 0.20, dualRate: 0.08, patterns: NORMAL_PATTERNS },
    HARD:   { step: 0.25, restRate: 0.12, dualRate: 0.18, patterns: HARD_PATTERNS },
  };
  const cfg = DIFF[difficulty] || DIFF.NORMAL;
  const stepMs = beatMs * cfg.step;

  // 2-beat intro (let song establish itself before notes start)
  const startOffset = beatMs * 2;
  const notes = [];

  let phraseStep = 0;   // position within 8-step phrase
  let phraseIdx  = 0;   // which pattern we're on
  let prevLane   = -1;  // avoid same-lane repeats at HARD

  for (let t = startOffset; t < durationMs - beatMs * 2; t += stepMs) {
    // Rest: skip this step
    if (Math.random() < cfg.restRate) {
      phraseStep++;
      if (phraseStep >= 8) { phraseStep = 0; phraseIdx++; }
      continue;
    }

    // Pick lane from pattern
    const pats = cfg.patterns;
    const pat  = pats[phraseIdx % pats.length];
    let lane   = pat[phraseStep % pat.length];

    // At HARD, avoid triple consecutive same-lane
    if (difficulty === 'HARD' && lane === prevLane && Math.random() < 0.6) {
      lane = (lane + 2) % LANE_COUNT;
    }

    notes.push({ time: Math.round(t), lane });
    prevLane = lane;

    // Dual-note (simultaneous hit on a different lane)
    if (Math.random() < cfg.dualRate) {
      const other = DUAL_PARTNER[lane];
      notes.push({ time: Math.round(t), lane: other });
    }

    phraseStep++;
    if (phraseStep >= 8) { phraseStep = 0; phraseIdx++; }
  }

  // Sort by time then lane
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);

  return {
    id: `auto_${Date.now()}`,
    title,
    artist: 'Auto Generated',
    bpm,
    difficulty,
    totalNotes: notes.length,
    audioFile: 'uploaded',
    audioDurationMs: durationMs,
    notes,
  };
}

// ---- Lane pattern tables ----

const LANE_COUNT = 5;

// Symmetric partner for dual-note hits
const DUAL_PARTNER = [4, 3, 0, 1, 0]; // lane → paired lane

// Each pattern is a sequence of lane indices for one 8-step phrase
const EASY_PATTERNS = [
  [2, 0, 2, 4, 2, 0, 2, 4],   // center + alternating edges
  [0, 2, 4, 2, 0, 2, 4, 2],   // sweep
  [2, 1, 2, 3, 2, 1, 2, 3],   // center + inner
  [0, 1, 2, 3, 4, 3, 2, 1],   // staircase
];

const NORMAL_PATTERNS = [
  [2, 0, 1, 2, 4, 2, 3, 2],   // hub-and-spoke
  [0, 2, 4, 2, 1, 2, 3, 2],
  [1, 3, 0, 4, 2, 0, 4, 2],   // criss-cross
  [2, 0, 2, 4, 1, 3, 2, 0],
  [0, 1, 2, 1, 4, 3, 2, 3],   // wave
  [2, 4, 2, 0, 3, 1, 2, 4],
];

const HARD_PATTERNS = [
  [0, 2, 1, 3, 2, 4, 3, 2],   // dense weave
  [2, 0, 4, 1, 3, 0, 4, 2],
  [1, 2, 3, 2, 1, 0, 2, 4],
  [4, 2, 0, 1, 3, 2, 4, 0],
  [0, 1, 2, 3, 4, 2, 1, 0],   // fast staircase
  [2, 1, 0, 2, 4, 3, 2, 1],
  [3, 1, 4, 0, 2, 4, 1, 3],   // random-feeling but predictable
];

/**
 * Stub for future audio-analysis-based chart generation.
 * When implemented, this should:
 *  1. Run onset detection on the audio buffer
 *  2. Map detected onsets to lanes (e.g., frequency band → lane)
 *  3. Return a chart object
 *
 * @param {AudioBuffer} audioBuffer
 * @param {object} opts
 * @returns {object} chart (stub: falls back to BPM generation)
 */
export function generateAudioChart(audioBuffer, opts = {}) {
  console.warn('[chart] Audio analysis not yet implemented. Using BPM fallback.');
  const durationMs = audioBuffer.duration * 1000;
  return generateBPMChart({ ...opts, durationMs });
}

/**
 * Validate and normalize a chart object.
 * Sorts notes by time, clamps lanes, removes duplicates.
 * @param {object} chart
 * @returns {object} normalized chart
 */
export function normalizeChart(chart) {
  const notes = (chart.notes || [])
    .map(n => ({
      time: Math.max(0, Number(n.time) || 0),
      lane: Math.max(0, Math.min(LANE_COUNT - 1, Number(n.lane) || 0)),
    }))
    .sort((a, b) => a.time - b.time);

  return {
    ...chart,
    totalNotes: notes.length,
    notes,
  };
}
