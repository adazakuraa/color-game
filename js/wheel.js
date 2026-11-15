/**
 * 色相環＋彩度・明度スクエアのコンポーネント
 * - 外側の円周：色相（タップ/ドラッグ）
 * - 内側の四角：横方向＝彩度（左0%→右100%）、縦方向＝明度（下0%→上100%）
 * - 操作中に画面がスクロールしないよう touch-action: none + preventDefault
 */
import { CONFIG } from './config.js';
import { hsvToHex, clamp } from './color.js';

export class HueWheel {
  constructor(root, { onStart, onInput, onCommit } = {}) {
    this.root = root;
    this.hue = 0;
    this.sat = CONFIG.WHEEL_SATURATION;
    this.val = CONFIG.WHEEL_VALUE;
    this.markers = [];
    this.handlers = { onStart, onInput, onCommit };
    root.classList.add('wheel');
    root.innerHTML = `
      <canvas class="wheel-ring" aria-hidden="true"></canvas>
      <div class="wheel-markers" aria-hidden="true"></div>
      <div class="wheel-hit" role="slider" tabindex="0" aria-label="色相" aria-valuemin="0" aria-valuemax="359"></div>
      <div class="wheel-knob" aria-hidden="true"></div>
      <div class="sv-square" role="slider" tabindex="0" aria-label="彩度と明度（左右で彩度、上下で明度）">
        <div class="sv-sat"></div><div class="sv-val"></div>
        <div class="sv-knob" aria-hidden="true"></div>
      </div>`;
    this.canvas = root.querySelector('canvas');
    this.knob = root.querySelector('.wheel-knob');
    this.markerLayer = root.querySelector('.wheel-markers');
    this.hit = root.querySelector('.wheel-hit');
    this.square = root.querySelector('.sv-square');
    this.svKnob = root.querySelector('.sv-knob');
    this.size = 0;
    this.pointerId = null;
    this.mode = null; // 'hue' | 'sv'

    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.hit.addEventListener('keydown', (e) => this.keyHue(e));
    this.square.addEventListener('keydown', (e) => this.keySV(e));
    new ResizeObserver(() => this.layout()).observe(root);
  }

  get ringWidth() { return Math.max(18, this.size * 0.11); }
  /** 内側の四角の一辺（リング内側の円に内接） */
  get squareSize() {
    const inner = this.size / 2 - this.ringWidth - 6;
    return Math.max(40, Math.floor(inner * Math.SQRT2));
  }

  get hex() { return hsvToHex(this.hue, this.sat, this.val); }

  layout() {
    const size = Math.round(this.root.clientWidth);
    if (!size || size === this.size) { this.place(); return; }
    this.size = size;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    const ctx = this.canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const c = size / 2, rw = this.ringWidth, r = c - rw / 2 - 2;
    ctx.lineWidth = rw;
    // 色相リングは常に鮮やかな色で表示（色相の位置が分かりやすいように）
    for (let h = 0; h < 360; h += 1) {
      const a0 = ((h - 90 - 0.5) * Math.PI) / 180, a1 = ((h - 90 + 1.1) * Math.PI) / 180;
      ctx.beginPath();
      ctx.strokeStyle = hsvToHex(h, 0.85, 0.95);
      ctx.arc(c, c, r, a0, a1);
      ctx.stroke();
    }
    const sq = this.squareSize;
    Object.assign(this.square.style, { width: `${sq}px`, height: `${sq}px`, left: `${(size - sq) / 2}px`, top: `${(size - sq) / 2}px` });
    this.root.style.setProperty('--ring', `${rw}px`);
    this.place();
    this.placeMarkers();
  }

  polar(hue, inset = 0) {
    const c = this.size / 2, r = c - this.ringWidth / 2 - 2 - inset;
    const a = ((hue - 90) * Math.PI) / 180;
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  }

  place() {
    const hex = this.hex;
    this.hit.setAttribute('aria-valuenow', String(Math.round(this.hue)));
    this.hit.setAttribute('aria-valuetext', `色相 ${Math.round(this.hue)}度`);
    this.square.setAttribute('aria-valuetext', `彩度 ${Math.round(this.sat * 100)}%、明度 ${Math.round(this.val * 100)}%`);
    this.square.style.setProperty('--hue-color', hsvToHex(this.hue, 1, 1));
    if (!this.size) return;
    const p = this.polar(this.hue);
    this.knob.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    this.knob.style.background = hex;
    this.knob.style.setProperty('--knob', `${this.ringWidth + 10}px`);
    const sq = this.squareSize;
    this.svKnob.style.transform = `translate(${this.sat * sq}px, ${(1 - this.val) * sq}px) translate(-50%, -50%)`;
    this.svKnob.style.background = hex;
  }

  placeMarkers() {
    if (!this.size) return;
    this.markerLayer.innerHTML = '';
    for (const m of this.markers) {
      const p = this.polar(m.hue, this.ringWidth / 2 + 7);
      const dot = document.createElement('span');
      dot.className = 'wheel-marker';
      dot.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      dot.style.background = m.color;
      this.markerLayer.appendChild(dot);
    }
  }

  /** 外部から現在の色を設定（通知なし） */
  setHSV(h, s, v) {
    if (h != null) this.hue = ((h % 360) + 360) % 360;
    if (s != null) this.sat = clamp(s, 0, 1);
    if (v != null) this.val = clamp(v, 0, 1);
    this.place();
  }

  setHue(h) { this.setHSV(h, null, null); }

  /** 他の四角形の色相の位置を示す小さな点 */
  setMarkers(markers) {
    const sig = JSON.stringify(markers);
    if (sig === this._markerSig) return;
    this._markerSig = sig;
    this.markers = markers;
    this.placeMarkers();
  }

  emit() { if (this.handlers.onInput) this.handlers.onInput(this.hue, this.sat, this.val); }

  updateFromEvent(e) {
    if (this.mode === 'hue') {
      const rect = this.root.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2), dy = e.clientY - (rect.top + rect.height / 2);
      this.hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    } else {
      const r = this.square.getBoundingClientRect();
      this.sat = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.val = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    }
    this.place();
    this.emit();
  }

  down(e) {
    if (this.pointerId !== null) return;
    const rect = this.root.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2), dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy), radius = rect.width / 2;
    const sq = this.square.getBoundingClientRect();
    const pad = 10; // 四角の端を少し外れても操作できるように
    if (e.clientX >= sq.left - pad && e.clientX <= sq.right + pad && e.clientY >= sq.top - pad && e.clientY <= sq.bottom + pad) this.mode = 'sv';
    else if (dist >= radius - this.ringWidth - 14) this.mode = 'hue';
    else return; // 四角とリングの間の隙間は操作対象外（誤操作防止）
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.root.setPointerCapture(e.pointerId); } catch { /* noop */ }
    this.root.classList.add('is-active', `is-${this.mode}`);
    if (this.handlers.onStart) this.handlers.onStart(this.mode);
    this.updateFromEvent(e);
  }

  move(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.updateFromEvent(e);
  }

  up(e) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.root.classList.remove('is-active', 'is-hue', 'is-sv');
    if (this.handlers.onCommit) this.handlers.onCommit(this.hue, this.sat, this.val);
  }

  keyStep(e, apply) {
    e.preventDefault();
    if (!this._keyActive && this.handlers.onStart) this.handlers.onStart('key');
    this._keyActive = true;
    apply();
    this.place();
    this.emit();
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => { this._keyActive = false; if (this.handlers.onCommit) this.handlers.onCommit(this.hue, this.sat, this.val); }, 500);
  }

  keyHue(e) {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 30, PageDown: -30 }[e.key];
    if (!d) return;
    this.keyStep(e, () => { this.hue = (this.hue + d + 360) % 360; });
  }

  keySV(e) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const map = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = map[e.key];
    if (!d) return;
    this.keyStep(e, () => { this.sat = clamp(this.sat + d[0], 0, 1); this.val = clamp(this.val + d[1], 0, 1); });
  }
}
