/**
 * キャンバス（アートボード）の描画とタッチ／マウス操作
 * - タップで選択、ドラッグで移動、ハンドルでサイズ変更、2本指ピンチで拡大縮小
 * - 重なった場所で選択中の四角形を再タップすると、下にある四角形へ順に切り替え
 */
import { CONFIG } from './config.js';
import { state, subscribe, select, selectedShape, checkpoint, changed, clampShape, getShape } from './store.js';
import { simulateCVD, clamp } from './color.js';

const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

let els = null;
let layout = { scale: 1, left: 0, top: 0, width: 0, height: 0 };
const nodes = new Map();
let hooks = {};

export function initCanvas({ stage, artboard, overlay }, opts = {}) {
  els = { stage, artboard, overlay };
  hooks = opts;
  overlay.innerHTML = `<div class="sel-outline"></div>${HANDLE_DIRS.map((d) => `<div class="handle handle-${d}" data-dir="${d}"><i></i></div>`).join('')}`;

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onCancel);
  stage.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) onCancel(e); });
  // iOS Safari のページ拡大・スクロールを防ぐ
  stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  stage.addEventListener('gesturestart', (e) => e.preventDefault());
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  new ResizeObserver(() => { computeLayout(); render(); }).observe(stage);
  subscribe(() => { computeLayout(); render(); });
}

export function getLayout() { return layout; }

export function stageSize() {
  return { w: els.stage.clientWidth, h: els.stage.clientHeight };
}

function computeLayout() {
  if (!state.work) return;
  const sw = els.stage.clientWidth, sh = els.stage.clientHeight;
  const pad = sw >= 700 ? 36 : 16;
  const { w: W, h: H } = state.work.artboard;
  const scale = Math.max(0.05, Math.min((sw - pad * 2) / W, (sh - pad * 2) / H));
  const width = W * scale, height = H * scale;
  layout = { scale, width, height, left: (sw - width) / 2, top: (sh - height) / 2 };
}

export function render() {
  if (!state.work || !els) return;
  const { artboard, overlay } = els;
  const { work, cvd } = state;
  const { scale, left, top, width, height } = layout;
  Object.assign(artboard.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  const transparent = work.background === 'transparent';
  artboard.classList.toggle('is-transparent', transparent);
  artboard.style.backgroundColor = transparent ? '' : simulateCVD(work.background, cvd);

  const alive = new Set();
  work.shapes.forEach((s, i) => {
    alive.add(s.id);
    let el = nodes.get(s.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'shape';
      el.dataset.id = s.id;
      nodes.set(s.id, el);
    }
    if (artboard.children[i] !== el) artboard.insertBefore(el, artboard.children[i] || null);
    // 小数ピクセルによる隙間を避けるため丸める
    const x0 = Math.round(s.x * scale), y0 = Math.round(s.y * scale);
    const x1 = Math.round((s.x + s.w) * scale), y1 = Math.round((s.y + s.h) * scale);
    el.style.transform = `translate(${x0}px, ${y0}px)`;
    el.style.width = `${x1 - x0}px`;
    el.style.height = `${y1 - y0}px`;
    el.style.backgroundColor = simulateCVD(s.color, cvd);
    el.classList.toggle('is-selected', s.id === state.selectedId);
  });
  for (const [id, el] of nodes) {
    if (!alive.has(id)) { el.remove(); nodes.delete(id); }
  }

  const sel = selectedShape();
  if (!sel) { overlay.hidden = true; return; }
  overlay.hidden = false;
  const ox = left + Math.round(sel.x * scale), oy = top + Math.round(sel.y * scale);
  const ow = Math.round((sel.x + sel.w) * scale) - Math.round(sel.x * scale);
  const oh = Math.round((sel.y + sel.h) * scale) - Math.round(sel.y * scale);
  Object.assign(overlay.style, { transform: `translate(${ox}px, ${oy}px)`, width: `${ow}px`, height: `${oh}px` });
  // 小さい四角形では辺ハンドルを隠し、角ハンドルを優先
  overlay.classList.toggle('is-small', Math.min(ow, oh) < 72);
  overlay.classList.toggle('is-active', !!gesture && gesture.moved);
}

/* ---------- 入力処理 ---------- */

const pointers = new Map();
let gesture = null;

function toLogical(clientX, clientY) {
  const r = els.stage.getBoundingClientRect();
  return { x: (clientX - r.left - layout.left) / layout.scale, y: (clientY - r.top - layout.top) / layout.scale };
}

function insideArtboard(p) {
  return p.x >= 0 && p.y >= 0 && p.x <= state.work.artboard.w && p.y <= state.work.artboard.h;
}

/** 指定位置にある四角形（上にあるものから順） */
export function shapesAt(p) {
  const out = [];
  const { shapes } = state.work;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) out.push(s);
  }
  return out;
}

function onDown(e) {
  if (!state.work) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // 最初の指（primary）は新しい操作の開始。取りこぼした pointerup があっても状態をリセットする
  if (e.isPrimary) { pointers.clear(); gesture = null; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { els.stage.setPointerCapture(e.pointerId); } catch { /* noop */ }
  e.preventDefault();

  if (pointers.size === 2) {
    const sel = selectedShape();
    if (!sel) return;
    const [a, b] = [...pointers.values()];
    gesture = {
      type: 'pinch', shapeId: sel.id, orig: { ...sel },
      startDist: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)),
      checkpointed: gesture ? gesture.checkpointed : false, moved: true,
    };
    if (!gesture.checkpointed) { checkpoint(); gesture.checkpointed = true; }
    return;
  }
  if (pointers.size > 2) return;

  const handle = e.target.closest && e.target.closest('.handle');
  const sel = selectedShape();
  const base = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, checkpointed: false };
  if (handle && sel) {
    gesture = { ...base, type: 'resize', dir: handle.dataset.dir, shapeId: sel.id, orig: { ...sel } };
    return;
  }
  const p = toLogical(e.clientX, e.clientY);
  const hits = insideArtboard(p) ? shapesAt(p) : [];
  if (sel && hits.includes(sel)) {
    gesture = { ...base, type: 'move', shapeId: sel.id, orig: { ...sel }, hits, cycle: hits.length > 1 };
  } else if (hits.length) {
    select(hits[0].id);
    gesture = { ...base, type: 'move', shapeId: hits[0].id, orig: { ...hits[0] }, hits, cycle: false };
    if (hits.length > 1 && hooks.onOverlapHint) hooks.onOverlapHint();
  } else {
    gesture = { ...base, type: 'empty' };
  }
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  e.preventDefault();

  if (gesture.type === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const ratio = Math.hypot(a.x - b.x, a.y - b.y) / gesture.startDist;
    const s = getShape(gesture.shapeId);
    if (!s) return;
    const o = gesture.orig, min = CONFIG.MIN_SHAPE_SIZE;
    const maxW = state.work.artboard.w * 3, maxH = state.work.artboard.h * 3;
    const r = clamp(ratio, Math.max(min / o.w, min / o.h), Math.min(maxW / o.w, maxH / o.h));
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    s.w = Math.round(o.w * r); s.h = Math.round(o.h * r);
    s.x = Math.round(cx - s.w / 2); s.y = Math.round(cy - s.h / 2);
    clampShape(s);
    changed('drag');
    return;
  }
  if (e.pointerId !== gesture.pointerId || gesture.type === 'empty') return;

  const dxPx = e.clientX - gesture.startX, dyPx = e.clientY - gesture.startY;
  if (!gesture.moved) {
    if (Math.hypot(dxPx, dyPx) < CONFIG.DRAG_THRESHOLD) return;
    gesture.moved = true;
    if (!gesture.checkpointed) { checkpoint(); gesture.checkpointed = true; }
  }
  const s = getShape(gesture.shapeId);
  if (!s) return;
  const dx = dxPx / layout.scale, dy = dyPx / layout.scale;
  const o = gesture.orig;

  if (gesture.type === 'move') {
    s.x = Math.round(o.x + dx);
    s.y = Math.round(o.y + dy);
    clampShape(s);
  } else if (gesture.type === 'resize') {
    const min = CONFIG.MIN_SHAPE_SIZE, d = gesture.dir;
    let { x, y, w, h } = o;
    if (d.includes('e')) w = Math.max(min, o.w + dx);
    if (d.includes('w')) { w = Math.max(min, o.w - dx); x = o.x + o.w - w; }
    if (d.includes('s')) h = Math.max(min, o.h + dy);
    if (d.includes('n')) { h = Math.max(min, o.h - dy); y = o.y + o.h - h; }
    Object.assign(s, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    clampShape(s);
  }
  changed('drag');
}

function onUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.type === 'pinch') {
    if (pointers.size < 2) { gesture = null; changed('dragend'); }
    return;
  }
  if (e.pointerId !== gesture.pointerId) return;
  const g = gesture;
  gesture = null;
  if (!g.moved) {
    if (g.type === 'empty') select(null);
    else if (g.type === 'move' && g.cycle) {
      // 重なっている場合は、下にある四角形へ順に切り替える
      const idx = g.hits.findIndex((s) => s.id === state.selectedId);
      const next = g.hits[(idx + 1) % g.hits.length];
      select(next.id);
      if (hooks.onCycle) hooks.onCycle(next, g.hits.length);
    }
  }
  changed(g.moved ? 'dragend' : 'tap');
}

function onCancel(e) {
  pointers.delete(e.pointerId);
  if (gesture && (gesture.pointerId === e.pointerId || gesture.type === 'pinch')) {
    const moved = gesture.moved;
    gesture = null;
    if (moved) changed('dragend');
  }
}

export const isGesturing = () => !!gesture && gesture.moved;
