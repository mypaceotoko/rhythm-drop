/**
 * analyzer.js – Audio analysis for rhythm chart generation
 *
 * Algorithm: IIR band filtering + RMS energy envelope + onset detection
 *
 * Pipeline:
 *  1. Convert AudioBuffer to mono
 *  2. Single-pass IIR filtering: split into low / mid / high bands simultaneously
 *  3. Compute RMS energy envelope per band (non-overlapping windows)
 *  4. Positive-flux onset detection with adaptive threshold
 *  5. Merge onsets from all bands, deduplicating nearby events
 *  6. Estimate BPM via autocorrelation of onset density
 *
 * Memory: O(numFrames) – full filtered audio is NOT stored
 * Time: O(n) where n = audio samples; yields to main thread every ~5000 frames
 *
 * Extension point: replace analyzeAudio() with a higher-quality implementation
 * (e.g. FFT-based spectral flux, neural onset detection) without changing callers.
 */

// ---- Configuration ----
const CUTOFF_LOW = 300;        // Hz: below = bass/kick
const CUTOFF_MID = 3000;       // Hz: below = melody, above = hi-hat/treble
const WIN_SIZE   = 512;        // samples per energy frame (~11.6 ms at 44100 Hz)
const MIN_ONSET_GAP_MS = 60;   // suppress onsets within this window
const FLUX_THRESHOLD   = 1.5;  // adaptive threshold: mean-flux × this multiplier
const YIELD_EVERY      = 200;  // yield to main thread every N energy frames

/**
 * @typedef {Object} Onset
 * @property {number} time   – ms from start
 * @property {number} energy – normalized strength 0..1
 * @property {'low'|'mid'|'high'} band – dominant frequency band at onset
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {number}  bpm
 * @property {Onset[]} onsets
 * @property {number}  durationMs
 */

/**
 * Analyse an AudioBuffer and return onset events with frequency-band tags.
 * Keeps the UI responsive via periodic yields (setTimeout 0 ms).
 *
 * @param {AudioBuffer} buffer
 * @param {function(number): void} [onProgress] – called with progress 0..1
 * @returns {Promise<AnalysisResult>}
 */
export async function analyzeAudio(buffer, onProgress = null) {
  const report = p => onProgress && onProgress(Math.min(1, p));

  const sampleRate = buffer.sampleRate;
  const durationMs = buffer.duration * 1000;

  report(0.02);

  // 1. Mono conversion
  const mono      = toMono(buffer);
  const numFrames = Math.floor(mono.length / WIN_SIZE);

  // 2. IIR filter coefficients (first-order exponential moving average)
  //    y[n] = a·y[n-1] + (1-a)·x[n]   →   -3dB at fc ≈ (1-a)·fs/(2π)
  //    More precisely: a = exp(-2π·fc/fs)
  const aLow = Math.exp(-2 * Math.PI * CUTOFF_LOW / sampleRate);
  const aMid = Math.exp(-2 * Math.PI * CUTOFF_MID / sampleRate);
  const bLow = 1 - aLow;
  const bMid = 1 - aMid;

  // Energy envelope arrays (one value per frame)
  const lowEnv  = new Float32Array(numFrames);
  const midEnv  = new Float32Array(numFrames);
  const highEnv = new Float32Array(numFrames);

  // 3. Single-pass band energy computation
  let yLow = 0, yMid = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * WIN_SIZE;
    let lE = 0, mE = 0, hE = 0;

    for (let i = start, end = start + WIN_SIZE; i < end; i++) {
      const x = mono[i];
      yLow = aLow * yLow + bLow * x;
      yMid = aMid * yMid + bMid * x;

      const low  = yLow;
      const mid  = yMid - yLow;   // bandpass: 300–3000 Hz
      const high = x    - yMid;   // highpass: 3000+ Hz

      lE += low * low;
      mE += mid * mid;
      hE += high * high;
    }

    lowEnv[f]  = Math.sqrt(lE / WIN_SIZE);
    midEnv[f]  = Math.sqrt(mE / WIN_SIZE);
    highEnv[f] = Math.sqrt(hE / WIN_SIZE);

    if (f % YIELD_EVERY === 0) {
      report(0.05 + 0.6 * f / numFrames);
      await yieldToMain();
    }
  }

  report(0.65);
  await yieldToMain();

  // 4. Onset detection per band
  const frameMs      = (WIN_SIZE / sampleRate) * 1000;
  const minGapFrames = Math.ceil(MIN_ONSET_GAP_MS / frameMs);

  const lowOnsets  = pickOnsets(lowEnv,  frameMs, 'low',  minGapFrames);
  const midOnsets  = pickOnsets(midEnv,  frameMs, 'mid',  minGapFrames);
  const highOnsets = pickOnsets(highEnv, frameMs, 'high', minGapFrames);

  report(0.78);
  await yieldToMain();

  // 5. Merge all bands
  const onsets = mergeOnsets([lowOnsets, midOnsets, highOnsets], MIN_ONSET_GAP_MS);

  report(0.88);
  await yieldToMain();

  // 6. BPM estimation
  const bpm = estimateBPM(onsets, durationMs);

  report(1.0);

  return { bpm, onsets, durationMs };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Average multi-channel AudioBuffer to a mono Float32Array. */
function toMono(buffer) {
  if (buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }
  const ch0  = buffer.getChannelData(0);
  const ch1  = buffer.getChannelData(1);
  const mono = new Float32Array(ch0.length);
  for (let i = 0; i < mono.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  return mono;
}

/** Yield to the browser event loop (keeps UI responsive). */
function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Detect onsets in an energy envelope using positive flux + adaptive threshold.
 *
 * @param {Float32Array} env        – RMS energy per frame
 * @param {number}       frameMs    – ms per frame
 * @param {string}       band       – 'low' | 'mid' | 'high'
 * @param {number}       minGap     – minimum gap between onsets (in frames)
 * @returns {Onset[]}
 */
function pickOnsets(env, frameMs, band, minGap) {
  const n = env.length;
  if (n < 3) return [];

  // Positive flux: energy increase from the previous frame
  const flux = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    flux[i] = Math.max(0, env[i] - env[i - 1]);
  }

  // Adaptive threshold = mean(non-zero flux) × FLUX_THRESHOLD
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) { if (flux[i] > 0) { sum += flux[i]; cnt++; } }
  if (cnt === 0) return [];
  const threshold = (sum / cnt) * FLUX_THRESHOLD;

  // Normalize for energy field
  let maxFlux = 0;
  for (let i = 0; i < n; i++) if (flux[i] > maxFlux) maxFlux = flux[i];
  if (maxFlux === 0) return [];

  // Local-peak picking above threshold, respecting minimum gap
  const onsets       = [];
  let lastOnsetFrame = -minGap;

  for (let i = 1; i < n - 1; i++) {
    if (flux[i] < threshold) continue;
    // Must be a local maximum
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;

    if (i - lastOnsetFrame < minGap) {
      // Replace previous onset if this one is stronger
      if (onsets.length > 0 && flux[i] > onsets[onsets.length - 1]._flux) {
        onsets.pop();
      } else {
        continue;
      }
    }

    onsets.push({
      time:   Math.round(i * frameMs),
      energy: flux[i] / maxFlux,
      band,
      _flux:  flux[i],   // internal; removed after merge
    });
    lastOnsetFrame = i;
  }

  return onsets;
}

/**
 * Merge onset lists from multiple bands.
 * Onsets within minGapMs of each other → keep the stronger one.
 * Returns sorted, deduplicated onset array (internal _flux field removed).
 */
function mergeOnsets(lists, minGapMs) {
  const all = lists.flat().sort((a, b) => a.time - b.time);
  const merged = [];

  for (const onset of all) {
    if (!merged.length) {
      merged.push({ ...onset });
      continue;
    }
    const last = merged[merged.length - 1];
    if (onset.time - last.time < minGapMs) {
      if (onset.energy > last.energy) merged[merged.length - 1] = { ...onset };
    } else {
      merged.push({ ...onset });
    }
  }

  // Remove internal field
  for (const o of merged) delete o._flux;
  return merged;
}

/**
 * Estimate BPM via autocorrelation of the onset density function.
 * Search range: 60–200 BPM (lag 300–1000 ms).
 * Returns the peak BPM, or 120 as fallback.
 */
function estimateBPM(onsets, durationMs) {
  if (onsets.length < 4) return 120;

  const RES   = 10; // ms per density bin
  const bins  = Math.ceil(durationMs / RES);
  const dens  = new Float32Array(bins);

  for (const { time, energy } of onsets) {
    const b = Math.floor(time / RES);
    if (b < bins) dens[b] = Math.max(dens[b], energy);
  }

  const minLag = Math.round(300  / RES); // 60000/200/RES
  const maxLag = Math.round(1000 / RES); // 60000/60/RES
  let bestCorr = -Infinity, bestLag = 50;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i + lag < bins; i++) corr += dens[i] * dens[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }

  const bpm = Math.round(60000 / (bestLag * RES));
  return (bpm >= 60 && bpm <= 220) ? bpm : 120;
}
