/**
 * LocalStorage を用いた保存・読み込み。
 * 容量超過・データ破損・LocalStorage が使えない環境でもアプリが停止しないようにする。
 */
import { CONFIG } from './config.js';
import { normalizeHex, clamp } from './color.js';

export const KEYS = Object.freeze({
  works: 'iroawase:works:v1',
  draft: 'iroawase:draft:v1',
  settings: 'iroawase:settings:v1',
  backup: 'iroawase:corrupt-backup',
});

const memory = new Map();
let available = null;

export function storageAvailable() {
  if (available !== null) return available;
  try {
    const k = '__iroawase_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function rawGet(key) {
  if (!storageAvailable()) return memory.has(key) ? memory.get(key) : null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** @returns {{ok: boolean, error?: 'quota'|'unavailable'|'unknown'}} */
function rawSet(key, value) {
  if (!storageAvailable()) { memory.set(key, value); return { ok: true, memoryOnly: true }; }
  try {
    window.localStorage.setItem(key, value);
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
    return { ok: false, error: quota ? 'quota' : 'unknown' };
  }
}

function rawRemove(key) {
  if (!storageAvailable()) { memory.delete(key); return; }
  try { window.localStorage.removeItem(key); } catch { /* noop */ }
}

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const newId = uid;

/** 不正なデータを可能な限り修復し、修復不能なら null を返す */
export function sanitizeWork(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const W = CONFIG.ARTBOARD_WIDTH;
  const h = clamp(num(raw.artboard && raw.artboard.h, W), 200, 4000);
  const bg = raw.background === 'transparent' ? 'transparent' : (normalizeHex(raw.background) || '#f4f1ea');
  const shapes = [];
  const seen = new Set();
  if (Array.isArray(raw.shapes)) {
    for (const s of raw.shapes) {
      if (!s || typeof s !== 'object') continue;
      const color = normalizeHex(s.color);
      if (!color) continue;
      const w = clamp(num(s.w, NaN), CONFIG.MIN_SHAPE_SIZE, W * 4);
      const hh = clamp(num(s.h, NaN), CONFIG.MIN_SHAPE_SIZE, h * 4);
      const x = num(s.x, NaN), y = num(s.y, NaN);
      if (![w, hh, x, y].every(Number.isFinite)) continue;
      let id = typeof s.id === 'string' && s.id ? s.id.slice(0, 64) : uid();
      if (seen.has(id)) id = uid();
      seen.add(id);
      shapes.push({ id, x: clamp(x, -w * 2, W * 2), y: clamp(y, -hh * 2, h * 2), w, h: hh, color });
      if (shapes.length >= CONFIG.MAX_SHAPES) break;
    }
  }
  const aspect = ['fit', '1:1', '4:5', '3:4', '9:16', '16:9'].includes(raw.aspect) ? raw.aspect : 'fit';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : null,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : '無題の作品',
    favorite: raw.favorite === true,
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
    background: bg,
    aspect,
    artboard: { w: W, h },
    shapes,
  };
}

/** 作品一覧を読み込む。破損していた場合はバックアップを残して空から始める。 */
export function loadWorks() {
  const raw = rawGet(KEYS.works);
  if (raw == null) return { works: [], warning: null };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  if (!Array.isArray(parsed)) {
    rawSet(KEYS.backup, raw.slice(0, 200000));
    rawRemove(KEYS.works);
    return { works: [], warning: '保存データが破損していたため、作品一覧を初期化しました（破損データは退避しました）。' };
  }
  const works = [];
  let dropped = 0;
  for (const item of parsed) {
    const w = sanitizeWork(item);
    if (w && w.id) works.push(w); else dropped++;
  }
  return { works, warning: dropped ? `読み込めない作品データが${dropped}件あったため、スキップしました。` : null };
}

export function saveWorks(works) {
  return rawSet(KEYS.works, JSON.stringify(works));
}

export function loadDraft() {
  const raw = rawGet(KEYS.draft);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const work = sanitizeWork(parsed && parsed.work);
    if (!work) return null;
    return { work, savedSnapshot: typeof parsed.savedSnapshot === 'string' ? parsed.savedSnapshot : null };
  } catch {
    rawRemove(KEYS.draft);
    return null;
  }
}

export function saveDraft(work, savedSnapshot) {
  return rawSet(KEYS.draft, JSON.stringify({ work, savedSnapshot }));
}

export function loadSettings() {
  const raw = rawGet(KEYS.settings);
  const defaults = { theme: null, hintsShown: {} };
  if (!raw) return defaults;
  try {
    const s = JSON.parse(raw);
    return {
      theme: s.theme === 'dark' || s.theme === 'light' ? s.theme : null,
      hintsShown: s.hintsShown && typeof s.hintsShown === 'object' ? s.hintsShown : {},
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  return rawSet(KEYS.settings, JSON.stringify(settings));
}
