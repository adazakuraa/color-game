/**
 * いろあわせ — エントリーポイント
 */
import { CONFIG } from './config.js';
import {
  state, subscribe, emit, changed, setWork, createWork, select, selectedShape, addShape, duplicateShape,
  deleteShape, reorder, undo, redo, canUndo, canRedo, isDirty, flushDraft, setDraftErrorHandler, checkpoint, clampShape,
} from './store.js';
import { loadDraft, loadSettings, saveSettings, storageAvailable } from './storage.js';
import { initCanvas, stageSize } from './canvas.js';
import { wheelColor, describeColor, isAchromatic, CVD_TYPES } from './color.js';
import { hydrateIcons, icon } from './icons.js';
import { toast } from './ui.js';
import { createColorPanel } from './panels/color.js';
import { createInsightPanel } from './panels/insight.js';
import { createWorksPanel } from './panels/works.js';
import { createExtractPanel } from './panels/extract.js';
import { createExportPanel, createCanvasPanel, createHelpPanel } from './panels/misc.js';

const $ = (sel) => document.querySelector(sel);
const app = $('#app');
const settings = loadSettings();

/* ---------- 予期しないエラーでもアプリを止めない ---------- */
let lastErrorToast = 0;
function reportError(err) {
  console.error(err);
  if (Date.now() - lastErrorToast > 4000) {
    lastErrorToast = Date.now();
    toast('予期しないエラーが発生しました。操作を続けられない場合はページを再読み込みしてください。', { type: 'error', duration: 4000 });
  }
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

/* ---------- テーマ ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  btn.setAttribute('aria-label', theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', theme === 'dark' ? '#121214' : '#f3f1ec'));
}
function persistSettings() {
  const res = saveSettings(settings);
  if (!res.ok) toast('設定を保存できませんでした', { type: 'error' });
}
applyTheme(settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#themeBtn').addEventListener('click', () => {
  settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(settings.theme);
  persistSettings();
});

hydrateIcons();

/* ---------- 作品の初期化（下書きがあれば復元） ---------- */
const stage = $('#stage');
const draft = loadDraft();
if (draft) {
  setWork(draft.work, { savedSnapshot: draft.savedSnapshot ?? '' });
  state.selectedId = null;
} else {
  setWork(createWork(stage.clientWidth, stage.clientHeight));
}
if (!storageAvailable()) setTimeout(() => toast('このブラウザでは保存機能が制限されています（プライベートモードなど）。', { type: 'error', duration: 5000 }), 500);

setDraftErrorHandler((err) => {
  if (err === 'quota') toast('ブラウザの保存容量が不足しています。不要な作品を削除してください。', { type: 'error', duration: 4500 });
});

/* ---------- キャンバス ---------- */
const hint = (key, msg) => {
  if (settings.hintsShown[key]) return;
  settings.hintsShown[key] = true;
  persistSettings();
  toast(msg, { duration: 4200 });
};
initCanvas({ stage, artboard: $('#artboard'), overlay: $('#selection') }, {
  onOverlapHint: () => hint('overlap', '重なった場所で再度タップすると、下の四角形を選択できます'),
  onCycle: (s, n) => toast(`下の四角形を選択（${n}枚重なっています）`, { duration: 1400 }),
});

/* ---------- パネル（シート） ---------- */
const ctx = {
  extracted: [],
  openPanel,
  closeSheet,
  stageSize,
  syncName,
  setCvd,
  newWork: () => panels.works.newWork(),
};
const panelRoot = (name) => document.querySelector(`.panel[data-panel="${name}"]`);
const panels = {
  color: createColorPanel(panelRoot('color'), ctx),
  insight: createInsightPanel(panelRoot('insight'), ctx),
  extract: createExtractPanel(panelRoot('extract'), ctx),
  works: createWorksPanel(panelRoot('works'), ctx),
  export: createExportPanel(panelRoot('export'), ctx),
  canvas: createCanvasPanel(panelRoot('canvas'), ctx),
  help: createHelpPanel(panelRoot('help')),
};
hydrateIcons();

let current = null;
const sheet = $('#sheet');

function openPanel(name, opts) {
  const p = panels[name];
  if (!p) return;
  if (current === name && !opts) { closeSheet(); return; }
  current = name;
  document.querySelectorAll('.panel').forEach((el) => el.classList.toggle('is-active', el.dataset.panel === name));
  document.querySelectorAll('[data-open]').forEach((el) => el.classList.toggle('is-on', el.dataset.open === name));
  $('#sheetTitle').textContent = p.title;
  app.style.setProperty('--sheet-h', p.height || '52dvh');
  sheet.hidden = false;
  app.classList.add('sheet-open');
  $('#sheetBody').scrollTop = 0;
  try { p.onOpen(opts || {}); } catch (e) { reportError(e); }
}

function closeSheet() {
  current = null;
  sheet.hidden = true;
  app.classList.remove('sheet-open');
  document.querySelectorAll('[data-open]').forEach((el) => el.classList.remove('is-on'));
  if (state.cvd !== 'none') setCvd('none');
}

document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) openPanel(opener.dataset.open);
});
$('#sheetClose').addEventListener('click', closeSheet);

// シートの上端をドラッグして高さ調整／下にスワイプして閉じる（スマートフォン）
(function sheetDrag() {
  const head = $('#sheetHead');
  let start = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || window.innerWidth >= 900) return;
    start = { y: e.clientY, h: sheet.getBoundingClientRect().height, id: e.pointerId };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const vh = window.innerHeight;
    const h = Math.min(vh * 0.86, Math.max(vh * 0.16, start.h - (e.clientY - start.y)));
    app.style.setProperty('--sheet-h', `${Math.round(h)}px`);
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const moved = start.y - e.clientY;
    start = null;
    if (sheet.getBoundingClientRect().height < window.innerHeight * 0.24 && moved < 0) closeSheet();
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
})();

/* ---------- 色覚シミュレーション ---------- */
function setCvd(type) {
  state.cvd = CVD_TYPES[type] ? type : 'none';
  const badge = $('#cvdBadge');
  badge.hidden = state.cvd === 'none';
  badge.textContent = state.cvd === 'none' ? '' : `${CVD_TYPES[state.cvd].label} シミュレーション表示`;
  emit('cvd');
}

/* ---------- ツール・編集バー ---------- */
function nextColor() {
  const sel = selectedShape() || state.work.shapes[state.work.shapes.length - 1];
  if (!sel || isAchromatic(sel.color)) return wheelColor(Math.round(Math.random() * 360));
  return wheelColor(describeColor(sel.color).hsv.h + 40);
}
$('#addBtn').addEventListener('click', () => {
  if (!addShape(nextColor())) toast(`四角形は最大${CONFIG.MAX_SHAPES}個までです`, { type: 'error' });
});

$('#selActions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || !selectedShape()) return;
  const id = state.selectedId;
  switch (b.dataset.act) {
    case 'duplicate': if (!duplicateShape(id)) toast(`四角形は最大${CONFIG.MAX_SHAPES}個までです`, { type: 'error' }); break;
    case 'front': if (!reorder(id, 'front')) toast('すでに最前面です', { duration: 1200 }); break;
    case 'back': if (!reorder(id, 'back')) toast('すでに最背面です', { duration: 1200 }); break;
    case 'delete': deleteShape(id); break;
    default:
  }
});

$('#undoBtn').addEventListener('click', () => undo());
$('#redoBtn').addEventListener('click', () => redo());

/* ---------- 作品名 ---------- */
const nameInput = $('#workName');
function syncName() { if (document.activeElement !== nameInput) nameInput.value = state.work.name; }
nameInput.addEventListener('change', () => {
  const v = nameInput.value.trim().slice(0, 60) || '無題の作品';
  nameInput.value = v;
  if (v !== state.work.name) { state.work.name = v; changed('name'); }
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
syncName();

/* ---------- 状態の反映 ---------- */
subscribe((reasons) => {
  const sel = selectedShape();
  $('#selHint').hidden = !!sel;
  $('#selActions').hidden = !sel;
  if (sel) $('#selSwatch span').style.background = sel.color;
  $('#undoBtn').disabled = !canUndo();
  $('#redoBtn').disabled = !canRedo();
  $('#dirtyDot').hidden = !isDirty();
  if (reasons.has('work') || reasons.has('restore') || reasons.has('saved')) syncName();
  if (current && panels[current].update) {
    try { panels[current].update(reasons); } catch (e) { reportError(e); }
  }
});
emit('init');

/* ---------- キーボード操作（PC） ---------- */
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  if (e.target.closest && e.target.closest('.wheel')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  const sel = selectedShape();
  if (e.key === 'Escape') { if (current) closeSheet(); else select(null); return; }
  if (!sel) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteShape(sel.id); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateShape(sel.id); return; }
  const step = e.shiftKey ? 20 : 2;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) {
    e.preventDefault();
    if (!e.repeat) checkpoint();
    sel.x += moves[e.key][0];
    sel.y += moves[e.key][1];
    clampShape(sel);
    changed('move');
  }
});

/* ---------- 終了時に下書きを確実に保存 ---------- */
window.addEventListener('pagehide', flushDraft);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });

// テストやデバッグ用の読み取り専用フック
window.__iroawase = { state, openPanel, closeSheet, select };
