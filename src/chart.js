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
 * Generate a simple BPM-based chart with notes at regular intervals.
 * Every beat or subdivision gets a note on a pseudo-random lane.
 *
 * This is intentionally simple — it's the "entry point" for auto-generation.
 * In a future version, replace or augment with audio-analysis results.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {number} opts.bpm
 * @param {number} opts.durationMs   - total chart duration in ms
 * @param {number} [opts.subdivision] - notes per beat (default: 2)
 * @param {string} [opts.difficulty] - 'EASY'|'NORMAL'|'HARD'
 * @returns {object} chart
 */
export function generateBPMChart({
  title = 'Auto Chart',
  bpm = 120,
  durationMs = 30000,
  subdivision = 2,
  difficulty = 'NORMAL',
}) {
  const beatMs = (60 / bpm) * 1000;
  const stepMs = beatMs / subdivision;

  // Skip first 2 beats (countdown)
  const startOffset = beatMs * 2;
  const notes = [];

  // Simple pattern: cycle through lanes with slight randomness
  const pattern = [2, 0, 4, 1, 3, 2, 3, 1, 4, 0]; // base lane pattern
  let patternIdx = 0;

  for (let t = startOffset; t < durationMs - beatMs; t += stepMs) {
    const lane = pattern[patternIdx % pattern.length];
    patternIdx++;
    notes.push({ time: Math.round(t), lane });
  }

  return {
    id: `auto_${Date.now()}`,
    title,
    artist: 'Auto Generated',
    bpm,
    difficulty,
    totalNotes: notes.length,
    audioFile: null,
    notes,
  };
}

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
