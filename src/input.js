/**
 * input.js – Keyboard and touch input manager
 *
 * Abstracts keyboard (S D F J K) and touch (lane tap) into a unified
 * "lane pressed / released" event stream consumed by the Game class.
 *
 * Design principles:
 *  - No game logic here; only translates raw events → lane numbers
 *  - Supports multi-touch (multiple simultaneous lane presses)
 *  - Prevents default touch behaviour to avoid scroll/zoom interference
 *  - Cleans up all listeners on destroy()
 */

/** Keyboard key → lane index mapping */
const KEY_MAP = { s: 0, d: 1, f: 2, j: 3, k: 4 };

export class InputManager {
  /**
   * @param {HTMLElement} laneOverlay  - #lane-overlay container
   * @param {(lane: number) => void} onPress   - called when a lane is pressed
   * @param {(lane: number) => void} onRelease - called when a lane is released
   */
  constructor(laneOverlay, onPress, onRelease) {
    this.laneOverlay = laneOverlay;
    this.onPress = onPress;
    this.onRelease = onRelease;

    /** Track which keys are currently held to avoid repeat events */
    this._heldKeys = new Set();

    /** Map from touch identifier → lane index */
    this._activeTouches = new Map();

    // Bind methods so we can remove them later
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onTouchCancel = this._onTouchCancel.bind(this);

    this._attach();
  }

  // ---- Public API ----

  /** Remove all event listeners. Call when leaving the game screen. */
  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.laneOverlay.removeEventListener('touchstart', this._onTouchStart);
    this.laneOverlay.removeEventListener('touchend', this._onTouchEnd);
    this.laneOverlay.removeEventListener('touchcancel', this._onTouchCancel);
  }

  /** Reset held state (e.g. when pausing so keys don't get "stuck"). */
  reset() {
    for (const lane of this._heldKeys) {
      this.onRelease(lane);
    }
    this._heldKeys.clear();

    for (const [, lane] of this._activeTouches) {
      this.onRelease(lane);
    }
    this._activeTouches.clear();
  }

  // ---- Private ----

  _attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    // Use passive:false so we can call preventDefault on touch events
    this.laneOverlay.addEventListener('touchstart', this._onTouchStart, { passive: false });
    this.laneOverlay.addEventListener('touchend', this._onTouchEnd, { passive: false });
    this.laneOverlay.addEventListener('touchcancel', this._onTouchCancel, { passive: false });
  }

  // ---- Keyboard ----

  _onKeyDown(e) {
    if (e.repeat) return; // ignore key-repeat
    const key = e.key.toLowerCase();
    const lane = KEY_MAP[key];
    if (lane === undefined) return;
    if (this._heldKeys.has(key)) return;
    this._heldKeys.add(key);
    this.onPress(lane);
  }

  _onKeyUp(e) {
    const key = e.key.toLowerCase();
    const lane = KEY_MAP[key];
    if (lane === undefined) return;
    this._heldKeys.delete(key);
    this.onRelease(lane);
  }

  // ---- Touch ----

  _onTouchStart(e) {
    e.preventDefault(); // prevent scroll and double-tap zoom
    for (const touch of e.changedTouches) {
      const lane = this._laneFromTouch(touch);
      if (lane === null) continue;
      this._activeTouches.set(touch.identifier, lane);
      this.onPress(lane);
    }
  }

  _onTouchEnd(e) {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const lane = this._activeTouches.get(touch.identifier);
      if (lane === undefined) continue;
      this._activeTouches.delete(touch.identifier);
      this.onRelease(lane);
    }
  }

  _onTouchCancel(e) {
    e.preventDefault();
    this._onTouchEnd(e);
  }

  /**
   * Determine which lane a touch belongs to by reading the data-lane
   * attribute of the element under the touch point.
   * @param {Touch} touch
   * @returns {number|null}
   */
  _laneFromTouch(touch) {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return null;

    // Walk up the DOM to find a .lane-btn
    let target = el;
    while (target && target !== document.body) {
      if (target.dataset && target.dataset.lane !== undefined) {
        return parseInt(target.dataset.lane, 10);
      }
      target = target.parentElement;
    }
    return null;
  }
}
