/**
 * storage.js – IndexedDB-based song persistence
 *
 * Schema
 *   database : 'rhythm-drop-songs'  version 1
 *   store    : 'songs'   keyPath: 'id' (auto-increment)
 *   record   : {
 *     id, title, bpm, difficulty, durationMs, totalNotes,
 *     savedAt, fileSizeBytes,
 *     blob  : Blob   (audio file),
 *     chart : object (normalized chart with notes array)
 *   }
 *
 * All public methods are async and throw on unrecoverable error.
 * Callers should try/catch and fall back gracefully.
 */

const DB_NAME        = 'rhythm-drop-songs';
const DB_VERSION     = 1;
const STORE_NAME     = 'songs';
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

export class SongStorage {
  constructor() {
    /** @type {IDBDatabase|null} */
    this._db    = null;
    /** @type {Promise<void>|null} serialise concurrent init() calls */
    this._ready = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Open (or create) the IndexedDB database. Safe to call multiple times. */
  async init() {
    if (this._ready) return this._ready;
    this._ready = this._open();
    return this._ready;
  }

  /**
   * Save a song record.
   * @param {Blob|File} blob  – audio file (File extends Blob)
   * @param {object} meta     – { title, bpm, difficulty, durationMs, totalNotes }
   * @param {object} chart    – normalized chart object (will be deep-cloned)
   * @returns {Promise<number>} new record id
   */
  async save(blob, meta, chart) {
    await this.init();

    if (blob.size > MAX_FILE_BYTES) {
      throw new Error(
        `ファイルが大きすぎます (${(blob.size / 1024 / 1024).toFixed(1)} MB)。` +
        `${MAX_FILE_BYTES / 1024 / 1024} MB 以下にしてください。`
      );
    }

    const record = {
      ...meta,
      blob,
      chart:         JSON.parse(JSON.stringify(chart)), // deep clone
      savedAt:       Date.now(),
      fileSizeBytes: blob.size,
    };

    return idbRequest(
      this._db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(record),
      '保存に失敗しました'
    );
  }

  /**
   * Return metadata for all saved songs (blob and chart are excluded to save memory).
   * @returns {Promise<object[]>}
   */
  async list() {
    await this.init();
    const all = await idbRequest(
      this._db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
      '一覧の取得に失敗しました'
    );
    // Strip blob/chart – callers use load() for those
    return (all || []).map(({ blob: _b, chart: _c, ...meta }) => meta);
  }

  /**
   * Load a full song record (including blob and chart).
   * @param {number} id
   * @returns {Promise<object>}
   */
  async load(id) {
    await this.init();
    const rec = await idbRequest(
      this._db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id),
      '読み込みに失敗しました'
    );
    if (!rec) throw new Error(`ID ${id} の曲が見つかりません`);
    return rec;
  }

  /**
   * Delete a song by id.
   * @param {number} id
   */
  async delete(id) {
    await this.init();
    return idbRequest(
      this._db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id),
      '削除に失敗しました'
    );
  }

  /**
   * Get rough storage usage estimate (may return null if API unavailable).
   * @returns {Promise<{usageMB: string, quotaMB: string}|null>}
   */
  async estimateUsage() {
    try {
      if (!navigator.storage?.estimate) return null;
      const { usage, quota } = await navigator.storage.estimate();
      return {
        usageMB: (usage / 1024 / 1024).toFixed(1),
        quotaMB: (quota  / 1024 / 1024).toFixed(0),
      };
    } catch (_) { return null; }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('このブラウザは IndexedDB に対応していません'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = e => { this._db = e.target.result; resolve(); };
      req.onerror   = e => reject(new Error(`IndexedDB 初期化エラー: ${e.target.error?.message}`));
    });
  }
}

/** Promisify an IDBRequest. Rejects with a prefixed Error on failure. */
function idbRequest(req, errorPrefix) {
  return new Promise((resolve, reject) => {
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(new Error(`${errorPrefix}: ${e.target.error?.message}`));
  });
}
