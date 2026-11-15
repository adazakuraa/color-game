/**
 * 円形の色相環コンポーネント
 * - 円周上をタップ/ドラッグして色相を選ぶ
 * - 操作中に画面がスクロールしないよう touch-action: none + preventDefault
 */
import { CONFIG } from './config.js';
import { hsvToHex } from './color.js';

export class HueWheel {
  constructor(root, { onStart, onInput, onCommit } = {}) {
    this.root = root;
    this.hue = 0;
    this.markers = [];
    this.handlers = { onStart, onInput, onCommit };
    root.classList.add('wheel');
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', '色相環');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '359');
    root.tabIndex = 0;
    root.innerHTML = `
      <canvas class="wheel-ring" aria-hidden="true"></canvas>
      <div class="wheel-markers" aria-hidden="true"></div>
      <div class="wheel-knob" aria-hidden="true"></div>
      <div class="wheel-center"><div class="wheel-swatch"></div></div>`;
    this.canvas = root.querySelector('canvas');
    this.knob = root.querySelector('.wheel-knob');
    this.markerLayer = root.querySelector('.wheel-markers');
    this.swatch = root.querySelector('.wheel-swatch');
    this.size = 0;
    this.pointerId = null;

    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    root.addEventListener('keydown', (e) => this.key(e));
    new ResizeObserver(() => this.layout()).observe(root);
  }

  get ringWidth() { return Math.max(22, this.size * 0.13); }

  layout() {
    const size = Math.round(this.root.clientWidth);
    if (!size || size === this.size) { this.placeKnob(); return; }
    this.size = size;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    const ctx = this.canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const c = size / 2, rw = this.ringWidth, r = c - rw / 2 - 2;
    ctx.lineWidth = rw;
    const step = 1;
    for (let h = 0; h < 360; h += step) {
      const a0 = ((h - 90 - step / 2) * Math.PI) / 180, a1 = ((h - 90 + step / 2 + 0.6) * Math.PI) / 180;
      ctx.beginPath();
      ctx.strokeStyle = hsvToHex(h, CONFIG.WHEEL_SATURATION, CONFIG.WHEEL_VALUE);
      ctx.arc(c, c, r, a0, a1);
      ctx.stroke();
    }
    this.root.style.setProperty('--ring', `${rw}px`);
    this.placeKnob();
    this.placeMarkers();
  }

  polar(hue, inset = 0) {
    const c = this.size / 2, r = c - this.ringWidth / 2 - 2 - inset;
    const a = ((hue - 90) * Math.PI) / 180;
    return { x: c + Math.cos(a) * r, y: c + Math.sin(a) * r };
  }

  placeKnob() {
    if (!this.size) return;
    const p = this.polar(this.hue);
    this.knob.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    this.knob.style.background = hsvToHex(this.hue, CONFIG.WHEEL_SATURATION, CONFIG.WHEEL_VALUE);
    this.knob.style.setProperty('--knob', `${this.ringWidth + 10}px`);
  }

  placeMarkers() {
    if (!this.size) return;
    this.markerLayer.innerHTML = '';
    for (const m of this.markers) {
      const p = this.polar(m.hue, this.ringWidth / 2 + 9);
      const dot = document.createElement('span');
      dot.className = 'wheel-marker';
      dot.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      dot.style.background = m.color;
      this.markerLayer.appendChild(dot);
    }
  }

  setHue(h, { silent = true } = {}) {
    this.hue = ((Math.round(h) % 360) + 360) % 360;
    this.root.setAttribute('aria-valuenow', String(this.hue));
    this.root.setAttribute('aria-valuetext', `色相 ${this.hue}度`);
    this.placeKnob();
    if (!silent && this.handlers.onInput) this.handlers.onInput(this.hue);
  }

  /** 中央に表示する色（実際に四角形へ適用されている色） */
  setPreview(hex) { this.swatch.style.background = hex; }

  /** 他の四角形の色相の位置を示す小さな点 */
  setMarkers(markers) {
    const sig = JSON.stringify(markers);
    if (sig === this._markerSig) return;
    this._markerSig = sig;
    this.markers = markers;
    this.placeMarkers();
  }

  hueFromEvent(e) {
    const rect = this.root.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2), dy = e.clientY - (rect.top + rect.height / 2);
    return { hue: ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360, dist: Math.hypot(dx, dy), radius: rect.width / 2 };
  }

  down(e) {
    if (this.pointerId !== null) return;
    const { hue, dist, radius } = this.hueFromEvent(e);
    // 中央のプレビュー部分は操作対象外（誤操作防止）
    if (dist < (radius - this.ringWidth) * 0.55) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.root.setPointerCapture(e.pointerId); } catch { /* noop */ }
    this.root.classList.add('is-active');
    if (this.handlers.onStart) this.handlers.onStart();
    this.setHue(hue, { silent: false });
  }

  move(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.setHue(this.hueFromEvent(e).hue, { silent: false });
  }

  up(e) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.root.classList.remove('is-active');
    if (this.handlers.onCommit) this.handlers.onCommit(this.hue);
  }

  key(e) {
    const step = e.shiftKey ? 10 : 1;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else if (e.key === 'PageUp') d = 30;
    else if (e.key === 'PageDown') d = -30;
    if (!d) return;
    e.preventDefault();
    if (!this._keyActive && this.handlers.onStart) this.handlers.onStart();
    this._keyActive = true;
    this.setHue(this.hue + d, { silent: false });
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => { this._keyActive = false; if (this.handlers.onCommit) this.handlers.onCommit(this.hue); }, 500);
  }
}
