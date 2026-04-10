/**
 * effects.js – DOM-based visual effects layer
 *
 * Responsibilities:
 *  - Spawn hit flash elements at the correct lane position
 *  - Spawn particle bursts on Perfect/Good hits
 *  - Clean up expired elements to avoid memory leaks
 *
 * Effects are rendered as absolutely positioned DOM elements on top of
 * the canvas so we don't need to re-draw them every frame.
 */

// Colors per lane (index 0–4) — must match renderer.js
const LANE_COLORS = ['#7c3aed', '#06b6d4', '#facc15', '#06b6d4', '#7c3aed'];
const PARTICLE_COUNTS = { perfect: 12, good: 7 };

export class Effects {
  /**
   * @param {HTMLElement} layer  - #effects-layer element
   * @param {import('./renderer.js').Renderer} renderer - for layout info
   */
  constructor(layer, renderer) {
    this.layer = layer;
    this.renderer = renderer;
  }

  /**
   * Spawn a vertical flash glow at the hit line for the given lane.
   * @param {number} lane 0-4
   * @param {'perfect'|'good'|null} type
   */
  spawnHitEffect(lane, type) {
    const { x, w } = this.renderer.getLaneRect(lane);
    const color = LANE_COLORS[lane];

    const el = document.createElement('div');
    el.className = 'hit-flash';
    el.style.cssText = `
      left: ${x + 2}px;
      width: ${w - 4}px;
      background: linear-gradient(to top, ${color}cc, transparent);
    `;
    this.layer.appendChild(el);

    // Remove after animation ends
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  /**
   * Spawn a burst of particles around the hit point of a lane.
   * @param {number} lane 0-4
   * @param {'perfect'|'good'} [type='good']
   */
  spawnParticles(lane, type = 'good') {
    const { x, w } = this.renderer.getLaneRect(lane);
    const color = LANE_COLORS[lane];
    const count = PARTICLE_COUNTS[type] ?? PARTICLE_COUNTS.good;

    // Hit line Y: use renderer's hitLineRatio relative to the layer height
    const hitY = this.layer.clientHeight * this.renderer.hitLineRatio;
    const centerX = x + w / 2;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 30 + Math.random() * 50;
      const tx = Math.cos(angle) * speed;
      const ty = Math.sin(angle) * speed - 30; // bias upward
      const size = 4 + Math.random() * 5;

      const el = document.createElement('div');
      el.className = 'particle';
      el.style.cssText = `
        left: ${centerX - size / 2}px;
        top: ${hitY - size / 2}px;
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        --tx: ${tx}px;
        --ty: ${ty}px;
        animation-duration: ${0.35 + Math.random() * 0.25}s;
        animation-delay: ${Math.random() * 0.05}s;
        box-shadow: 0 0 4px ${color};
      `;
      this.layer.appendChild(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  }

  /** Remove all active effects immediately (e.g. on restart). */
  clearAll() {
    this.layer.innerHTML = '';
  }
}
