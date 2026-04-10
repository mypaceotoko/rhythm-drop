/**
 * audio.js – Web Audio API wrapper
 *
 * Responsibilities:
 *  - Provide an AudioContext with accurate timing (currentTime)
 *  - Generate simple synth sounds for the demo (no audio file needed)
 *  - Play hit sound effect on note hits
 *  - Future: decode and play uploaded audio files
 *
 * Design: All timing is derived from audioCtx.currentTime (seconds).
 * The game loop reads this for frame-accurate sync.
 */

export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;

    /** Timestamp (audioCtx.currentTime) when the song started */
    this.songStartTime = 0;

    /** Whether a song is currently playing */
    this.playing = false;

    /** Stored pause offset in seconds */
    this._pausedAt = 0;

    /** AudioBuffer of the loaded song (null = demo/no audio) */
    this._songBuffer = null;

    /** Currently playing source node */
    this._sourceNode = null;
  }

  /** Must be called after a user gesture to satisfy autoplay policy */
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  /** Resume context if it was suspended (required on mobile) */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * Current song position in milliseconds.
   * Returns 0 if not playing.
   */
  get currentTimeMs() {
    if (!this.ctx || !this.playing) return this._pausedAt * 1000;
    return (this.ctx.currentTime - this.songStartTime) * 1000;
  }

  /**
   * Start demo song (synth beat generated via Web Audio).
   * @param {number} bpm
   * @param {number} startOffsetMs - resume from this position (ms)
   */
  startDemo(bpm, startOffsetMs = 0) {
    if (!this.ctx) this.init();
    this.playing = true;
    this.songStartTime = this.ctx.currentTime - startOffsetMs / 1000;
    this._scheduleDemoBeat(bpm, startOffsetMs);
  }

  /**
   * Load an audio file ArrayBuffer and decode it.
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<void>}
   */
  async loadAudioBuffer(arrayBuffer) {
    if (!this.ctx) this.init();
    this._songBuffer = await this.ctx.decodeAudioData(arrayBuffer);
  }

  /**
   * Start the loaded audio buffer.
   * @param {number} startOffsetMs
   */
  startAudio(startOffsetMs = 0) {
    if (!this.ctx || !this._songBuffer) return;
    this._stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this._songBuffer;
    src.connect(this.ctx.destination);
    src.start(0, startOffsetMs / 1000);
    this._sourceNode = src;
    this.playing = true;
    this.songStartTime = this.ctx.currentTime - startOffsetMs / 1000;
  }

  /** Pause the audio and save position. */
  pause() {
    if (!this.playing) return;
    this._pausedAt = this.ctx.currentTime - this.songStartTime;
    this._stopSource();
    this._stopDemoNodes();
    this.playing = false;
  }

  /** Resume from saved position. */
  resume_song(bpm) {
    if (this.playing) return;
    const offset = this._pausedAt * 1000;
    if (this._songBuffer) {
      this.startAudio(offset);
    } else {
      this.startDemo(bpm, offset);
    }
  }

  /** Stop everything. */
  stop() {
    this._stopSource();
    this._stopDemoNodes();
    this.playing = false;
    this._pausedAt = 0;
    this.songStartTime = 0;
  }

  // ---- Hit sounds ----

  /**
   * Play a short percussive hit sound for note judgment.
   * @param {'perfect'|'good'|'miss'} type
   */
  playHitSound(type) {
    if (!this.ctx) return;
    if (type === 'miss') {
      this._playClick(120, 0.04, 0.1, 'sine');
    } else {
      const freq = type === 'perfect' ? 880 : 660;
      this._playClick(freq, 0.08, 0.08, 'triangle');
    }
  }

  // ---- Internal helpers ----

  /** @type {AudioNode[]} */
  _demoNodes = [];

  /**
   * Schedule a simple kick+hihat pattern for the demo.
   * We schedule 4 bars ahead using setTimeout to avoid too many nodes.
   */
  _scheduleDemoBeat(bpm, startOffsetMs) {
    const beatDur = 60 / bpm; // seconds per beat
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const songPos = startOffsetMs / 1000; // where we are in the song

    // Schedule beats for the next 30 seconds from song position
    const scheduleAhead = 30;
    const songEnd = 25; // demo is ~25 seconds

    for (let beat = 0; beat < scheduleAhead * (bpm / 60); beat++) {
      const beatTime = beat * beatDur; // time in song
      if (beatTime < songPos) continue;
      if (beatTime > songEnd) break;

      const absTime = now + (beatTime - songPos); // absolute audio time

      // Kick on every beat
      this._scheduleKick(absTime);

      // Hihat on every 8th note
      this._scheduleHihat(absTime + beatDur / 2);
    }
  }

  _scheduleKick(time) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.start(time); osc.stop(time + 0.25);
    this._demoNodes.push(osc, gain);
  }

  _scheduleHihat(time) {
    const ctx = this.ctx;
    const bufSize = ctx.sampleRate * 0.05;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.start(time); src.stop(time + 0.05);
    this._demoNodes.push(src, gain, filter);
  }

  _playClick(freq, gainVal, duration, type = 'sine') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(); osc.stop(ctx.currentTime + duration);
  }

  _stopSource() {
    if (this._sourceNode) {
      try { this._sourceNode.stop(); } catch (_) {}
      this._sourceNode = null;
    }
  }

  _stopDemoNodes() {
    // Demo nodes are scheduled ahead; we just disconnect them
    for (const node of this._demoNodes) {
      try { node.disconnect(); } catch (_) {}
    }
    this._demoNodes = [];
  }
}
