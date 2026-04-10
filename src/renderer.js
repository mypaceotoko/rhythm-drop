/**
 * renderer.js – Canvas rendering engine
 *
 * Draws the 5-lane playfield including:
 *  - Background gradient
 *  - Lane separators
 *  - Hit line
 *  - Notes (falling bars)
 *  - Lane highlight when pressed
 *  - "Danger" flash when gauge is low
 */

const LANE_COUNT = 5;

// Colors per lane (index 0–4)
const LANE_COLORS = [
  '#7c3aed', // purple
  '#06b6d4', // cyan
  '#facc15', // yellow (center)
  '#06b6d4', // cyan
  '#7c3aed', // purple
];

const NOTE_COLORS = LANE_COLORS;
const NOTE_HIT_COLORS = ['#a78bfa', '#67e8f9', '#fde68a', '#67e8f9', '#a78bfa'];

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    /** Set externally: which lanes are currently pressed */
    this.pressedLanes = new Set();

    /** Hit line position as fraction from top (0–1) */
    this.hitLineRatio = 0.82;

    // Computed layout (updated on resize)
    this.layout = this._computeLayout();

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas);
    this._onResize();
  }

  /** Call this when the renderer is no longer needed. */
  destroy() {
    this._resizeObserver.disconnect();
  }

  // ---- Layout ----

  _onResize() {
    // Match canvas pixel size to CSS display size (for sharp rendering)
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
    this.layout = this._computeLayout();
  }

  _computeLayout() {
    const w = this.displayWidth || this.canvas.clientWidth || 300;
    const h = this.displayHeight || this.canvas.clientHeight || 500;

    // Total lane area: up to 90% of width, centred
    const totalLaneW = Math.min(w * 0.95, 500);
    const laneW = totalLaneW / LANE_COUNT;
    const startX = (w - totalLaneW) / 2;
    const hitY = h * this.hitLineRatio;
    const noteH = Math.max(14, Math.min(22, h * 0.035));

    return { w, h, laneW, startX, hitY, noteH, totalLaneW };
  }

  /**
   * Get the X position and width of a lane (for touch overlay alignment).
   * @param {number} lane 0-4
   * @returns {{ x: number, w: number }}
   */
  getLaneRect(lane) {
    const { startX, laneW } = this.layout;
    return { x: startX + lane * laneW, w: laneW };
  }

  // ---- Main draw ----

  /**
   * Render one frame.
   * @param {object[]} notes - all notes (active + hit)
   * @param {number} songTimeMs - current song position in ms
   * @param {number} scrollSpeed - pixels per ms
   */
  draw(notes, songTimeMs, scrollSpeed) {
    const { ctx } = this;
    const { w, h, laneW, startX, hitY, noteH, totalLaneW } = this.layout;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a0a14');
    bg.addColorStop(1, '#12121e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Scanline effect (subtle horizontal lines)
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
    }

    // Lane backgrounds + separators
    for (let i = 0; i < LANE_COUNT; i++) {
      const x = startX + i * laneW;

      // Lane bg (alternating subtle tint)
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(x, 0, laneW, h);

      // Press highlight
      if (this.pressedLanes.has(i)) {
        const grd = ctx.createLinearGradient(x, hitY, x, hitY - 120);
        grd.addColorStop(0, `${LANE_COLORS[i]}55`);
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.fillRect(x, hitY - 120, laneW, 120);
      }

      // Lane separator
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Right separator
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX + totalLaneW, 0);
    ctx.lineTo(startX + totalLaneW, h);
    ctx.stroke();

    // Hit line (double line with glow)
    this._drawHitLine(startX, hitY, totalLaneW);

    // Notes
    for (const note of notes) {
      if (note.hit || note.missed) continue; // already judged
      this._drawNote(note, songTimeMs, scrollSpeed);
    }

    // "Ghost" hit flash (brief glow when note just hit)
    for (const note of notes) {
      if (note.hitFlash && note.hitFlash > 0) {
        this._drawHitFlash(note);
        note.hitFlash -= 1;
      }
    }
  }

  _drawHitLine(startX, hitY, totalLaneW) {
    const { ctx } = this;

    // Glow beneath the hit line
    const grd = ctx.createLinearGradient(0, hitY, 0, hitY + 40);
    grd.addColorStop(0, 'rgba(124,58,237,0.3)');
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(startX, hitY, totalLaneW, 40);

    // Main hit line
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#7c3aed';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(startX, hitY);
    ctx.lineTo(startX + totalLaneW, hitY);
    ctx.stroke();

    // Thin accent line below
    ctx.strokeStyle = 'rgba(124,58,237,0.6)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(startX, hitY + 3);
    ctx.lineTo(startX + totalLaneW, hitY + 3);
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  _drawNote(note, songTimeMs, scrollSpeed) {
    const { ctx } = this;
    const { laneW, startX, hitY, noteH } = this.layout;

    // Position: how far before the hit line is this note?
    const timeDiff = note.time - songTimeMs; // ms until note reaches hit line
    const y = hitY - timeDiff * scrollSpeed;

    // Only draw if visible
    if (y + noteH < 0 || y - noteH > this.layout.h) return;

    const x = startX + note.lane * laneW;
    const noteW = laneW - 4;
    const noteX = x + 2;
    const noteY = y - noteH / 2;
    const radius = 4;

    const color = NOTE_COLORS[note.lane];

    // Shadow/glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    // Note body
    const noteGrd = ctx.createLinearGradient(noteX, noteY, noteX, noteY + noteH);
    noteGrd.addColorStop(0, NOTE_HIT_COLORS[note.lane]);
    noteGrd.addColorStop(1, color);
    ctx.fillStyle = noteGrd;
    this._roundRect(ctx, noteX, noteY, noteW, noteH, radius);
    ctx.fill();

    // Top highlight stripe
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this._roundRect(ctx, noteX + 2, noteY + 2, noteW - 4, 3, 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  _drawHitFlash(note) {
    const { ctx } = this;
    const { laneW, startX, hitY } = this.layout;
    const x = startX + note.lane * laneW + laneW / 2;
    const color = NOTE_COLORS[note.lane];
    const alpha = note.hitFlash / 8; // fade out

    const grd = ctx.createRadialGradient(x, hitY, 0, x, hitY, laneW * 0.8);
    grd.addColorStop(0, `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(startX + note.lane * laneW, hitY - 60, laneW, 80);
  }

  // ---- Utility ----

  /** Draw a rounded rectangle path */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
