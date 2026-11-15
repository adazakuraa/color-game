/**
 * アプリの状態管理（作品データ・選択状態・元に戻す履歴・自動下書き保存）
 */
import { CONFIG } from './config.js';
import { sanitizeWork, saveDraft, newId } from './storage.js';
import { wheelColor, clamp } from './color.js';

const listeners = new Set();

export const state = {
  work: null,
  selectedId: null,
  cvd: 'none',
  /** 保存済み作品との比較用（未保存の変更検出） */
  savedSnapshot: null,
};

const undoStack = [];
const redoStack = [];

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let emitQueued = false;
let pendingReasons = new Set();
export function emit(reason = 'change') {
  pendingReasons.add(reason);
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    const reasons = pendingReasons;
    pendingReasons = new Set();
    for (const fn of listeners) {
      try { fn(reasons); } catch (e) { console.error(e); }
    }
  });
}

/** 同期的に描画したい場合（ドラッグ中など） */
export function emitNow(reason = 'change') {
  for (const fn of listeners) {
    try { fn(new Set([reason])); } catch (e) { console.error(e); }
  }
}

export const serialize = (work) => JSON.stringify({
  name: work.name, background: work.background, aspect: work.aspect, artboard: work.artboard,
  shapes: work.shapes,
});

export function isDirty() {
  if (!state.work) return false;
  return serialize(state.work) !== state.savedSnapshot;
}

/* ---------- 履歴 ---------- */

function snapshot() {
  return JSON.stringify({ work: state.work, selectedId: state.selectedId });
}

/** 変更の直前に呼ぶ。連続操作は1回分として扱うため、ジェスチャ開始時に1度だけ呼ぶ。 */
export function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > CONFIG.HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  emit('history');
}

function restore(snap) {
  const data = JSON.parse(snap);
  const work = sanitizeWork(data.work);
  if (!work) return;
  work.id = data.work.id || null;
  work.favorite = !!data.work.favorite;
  state.work = work;
  state.selectedId = work.shapes.some((s) => s.id === data.selectedId) ? data.selectedId : null;
  changed('restore');
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export function clearHistory() { undoStack.length = 0; redoStack.length = 0; emit('history'); }

/* ---------- 自動下書き保存 ---------- */

let draftTimer = null;
let onDraftError = null;
export function setDraftErrorHandler(fn) { onDraftError = fn; }

export function changed(reason = 'change') {
  emit(reason);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 400);
}

export function flushDraft() {
  clearTimeout(draftTimer);
  if (!state.work) return;
  const res = saveDraft(state.work, state.savedSnapshot);
  if (!res.ok && onDraftError) onDraftError(res.error);
}

/* ---------- 作品・四角形の操作 ---------- */

export function artboardHeightFor(aspect, stageW, stageH) {
  const W = CONFIG.ARTBOARD_WIDTH;
  const ratios = { '1:1': 1, '4:5': 5 / 4, '3:4': 4 / 3, '9:16': 16 / 9, '16:9': 9 / 16 };
  if (ratios[aspect]) return Math.round(W * ratios[aspect]);
  const r = stageW > 0 && stageH > 0 ? stageH / stageW : 1.3;
  return Math.round(clamp(W * r, CONFIG.ARTBOARD_MIN_HEIGHT, CONFIG.ARTBOARD_MAX_HEIGHT));
}

export function createWork(stageW, stageH) {
  const W = CONFIG.ARTBOARD_WIDTH;
  const H = artboardHeightFor('fit', stageW, stageH);
  const size = Math.round(Math.min(W, H) * 0.42);
  return {
    id: null,
    name: '無題の作品',
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    background: '#f4f1ea',
    aspect: 'fit',
    artboard: { w: W, h: H },
    shapes: [{ id: newId(), x: Math.round((W - size) / 2), y: Math.round((H - size) / 2), w: size, h: size, color: wheelColor(18) }],
  };
}

/** savedSnapshot を省略すると、現在の内容を「変更なし」の基準にする */
export function setWork(work, { savedSnapshot, keepHistory = false } = {}) {
  state.work = work;
  state.selectedId = work.shapes.length ? work.shapes[work.shapes.length - 1].id : null;
  state.savedSnapshot = savedSnapshot == null ? serialize(work) : savedSnapshot;
  if (!keepHistory) clearHistory();
  changed('work');
}

export const getShape = (id) => (state.work ? state.work.shapes.find((s) => s.id === id) : null);
export const selectedShape = () => getShape(state.selectedId);

export function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  emit('selection');
}

export function addShape(color) {
  const { work } = state;
  if (work.shapes.length >= CONFIG.MAX_SHAPES) return null;
  checkpoint();
  const W = work.artboard.w, H = work.artboard.h;
  const size = Math.round(Math.min(CONFIG.DEFAULT_SHAPE_SIZE, Math.min(W, H) * 0.4));
  // 少しずつずらして配置し、重なりを見やすくする
  const n = work.shapes.length;
  const offset = ((n % 6) - 2.5) * 46;
  const x = Math.round(clamp((W - size) / 2 + offset, 0, W - size));
  const y = Math.round(clamp((H - size) / 2 + offset * 0.8, 0, H - size));
  const shape = { id: newId(), x, y, w: size, h: size, color };
  work.shapes.push(shape);
  state.selectedId = shape.id;
  changed('shapes');
  return shape;
}

export function duplicateShape(id = state.selectedId) {
  const { work } = state;
  const s = getShape(id);
  if (!s || work.shapes.length >= CONFIG.MAX_SHAPES) return null;
  checkpoint();
  const d = 36;
  const W = work.artboard.w, H = work.artboard.h;
  const copy = { ...s, id: newId(), x: s.x + d + s.w > W + s.w * 0.5 ? s.x - d : s.x + d, y: s.y + d + s.h > H + s.h * 0.5 ? s.y - d : s.y + d };
  const idx = work.shapes.indexOf(s);
  work.shapes.splice(idx + 1, 0, copy);
  state.selectedId = copy.id;
  changed('shapes');
  return copy;
}

export function deleteShape(id = state.selectedId) {
  const { work } = state;
  const idx = work.shapes.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  checkpoint();
  work.shapes.splice(idx, 1);
  state.selectedId = null;
  changed('shapes');
  return true;
}

/** 重なり順の変更: 'front' | 'back' | 'forward' | 'backward' */
export function reorder(id, where) {
  const { shapes } = state.work;
  const idx = shapes.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  let to = idx;
  if (where === 'front') to = shapes.length - 1;
  else if (where === 'back') to = 0;
  else if (where === 'forward') to = Math.min(shapes.length - 1, idx + 1);
  else if (where === 'backward') to = Math.max(0, idx - 1);
  if (to === idx) return false;
  checkpoint();
  const [s] = shapes.splice(idx, 1);
  shapes.splice(to, 0, s);
  changed('shapes');
  return true;
}

/** 色の設定。live=true のときは履歴を積まない（ドラッグ中） */
export function setShapeColor(id, color) {
  const s = getShape(id);
  if (!s || s.color === color) return;
  s.color = color;
  changed('color');
}

export function setBackground(color) {
  if (state.work.background === color) return;
  state.work.background = color;
  changed('background');
}

export function setAspect(aspect, stageW, stageH) {
  const { work } = state;
  const oldH = work.artboard.h;
  const newH = artboardHeightFor(aspect, stageW, stageH);
  checkpoint();
  work.aspect = aspect;
  if (newH !== oldH) {
    // 中心位置の比率を保って再配置（四角形の形は変えない）
    for (const s of work.shapes) {
      const cy = (s.y + s.h / 2) / oldH;
      s.y = Math.round(cy * newH - s.h / 2);
    }
    work.artboard.h = newH;
  }
  changed('work');
}

export function clampShape(s) {
  const { w: W, h: H } = state.work.artboard;
  const keepX = Math.min(CONFIG.KEEP_VISIBLE, s.w), keepY = Math.min(CONFIG.KEEP_VISIBLE, s.h);
  s.x = clamp(s.x, keepX - s.w, W - keepX);
  s.y = clamp(s.y, keepY - s.h, H - keepY);
}
