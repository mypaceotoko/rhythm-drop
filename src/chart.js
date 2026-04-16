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

// ── Analysis-based chart generation ──────────────────────────────────────────

/**
 * Build a chart from the output of analyzeAudio().
 * Pure function – separated so the algorithm can be improved independently.
 *
 * @param {{ bpm: number, onsets: Array, durationMs: number }} analysis
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.difficulty] – 'EASY'|'NORMAL'|'HARD'
 * @returns {object} chart (call normalizeChart() afterwards)
 */
export function buildChartFromAnalysis(analysis, opts = {}) {
  const { title = 'Analyzed Chart', difficulty = 'NORMAL' } = opts;
  const { onsets, bpm, durationMs } = analysis;

  // Difficulty → density parameters
  const CFG = {
    EASY:   { minGap: 220, energyMin: 0.45, dualRate: 0.00 },
    NORMAL: { minGap: 120, energyMin: 0.28, dualRate: 0.06 },
    HARD:   { minGap:  80, energyMin: 0.15, dualRate: 0.16 },
  };
  const cfg = CFG[difficulty] || CFG.NORMAL;

  // Frequency band → preferred lane order
  // low  (kick/bass)    → outer lanes first
  // mid  (snare/melody) → centre then inner
  // high (hi-hat)       → inner then centre
  const BAND_LANES = {
    low:  [0, 4, 2, 1, 3],
    mid:  [2, 1, 3, 0, 4],
    high: [1, 3, 2, 0, 4],
  };

  // Rotation index per band to cycle lane assignments
  const rot    = { low: 0, mid: 0, high: 0 };
  const notes  = [];
  let lastTime = -Infinity;
  let lastLane = -1;

  for (const onset of onsets) {
    if (onset.energy < cfg.energyMin)       continue;
    if (onset.time - lastTime < cfg.minGap) continue;

    const prefs = BAND_LANES[onset.band] ?? BAND_LANES.mid;
    const idx   = rot[onset.band] ?? 0;
    let lane    = prefs[idx % prefs.length];

    // Avoid immediate same-lane repeat
    if (lane === lastLane && prefs.length > 1) lane = prefs[(idx + 1) % prefs.length];

    rot[onset.band] = (rot[onset.band] ?? 0) + 1;
    notes.push({ time: onset.time, lane });
    lastTime = onset.time;
    lastLane = lane;

    // Dual note for very strong beats (NORMAL / HARD only)
    if (difficulty !== 'EASY' && onset.energy > 0.70 && Math.random() < cfg.dualRate) {
      const DUAL    = [4, 3, 4, 1, 0]; // symmetric partners
      const partner = DUAL[lane];
      if (partner !== lane) notes.push({ time: onset.time, lane: partner });
    }
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);

  return {
    id:             `analyzed_${Date.now()}`,
    title,
    artist:         'Auto Generated',
    bpm,
    difficulty,
    totalNotes:     notes.length,
    audioFile:      'uploaded',
    audioDurationMs: durationMs,
    notes,
  };
}

/**
 * Legacy stub – kept so old imports don't break.
 * @deprecated  Use analyzeAudio() + buildChartFromAnalysis() instead.
 */
export function generateAudioChart(audioBuffer, opts = {}) {
  console.warn('[chart] generateAudioChart is deprecated. Use buildChartFromAnalysis.');
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
